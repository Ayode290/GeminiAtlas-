/**
 * Specs Inc. 2026
 * GlobeView – the overview/approach Earth globe.
 *
 * Owns a low/moderate-poly sphere with an UNLIT equirectangular base texture.
 * It is moved by TRADITIONAL rotate-to-aim + scale-to-zoom (the interaction
 * model never changes with depth). During the dock handoff the controller tweens
 * the globe to a footprint that matches the table's L0 (via dockScaleForSpan),
 * then crossfades it OUT; the globe stays HIDDEN for the whole DOCKED phase and
 * fades back IN on the way out.
 *
 * Fading is done on a CLONED material's baseColor alpha (clone-before-modify, so
 * the shared asset is never mutated — same pattern as PictureBehavior /
 * PingController). Aim/zoom/alpha are tweened in a single UpdateEvent.
 */
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";
import { LatLng, aimEuler, dockScaleForSpan, easeInOutCubic, clamp01, lerp } from "./GeoMath";

interface GlobeTween {
  fromRot: quat;
  toRot: quat;
  fromScale: number;
  toScale: number;
  fromAlpha: number;
  toAlpha: number;
  duration: number;
  elapsed: number;
  onDone: (() => void) | null;
}

@component
export class GlobeView extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">GlobeView – rotate-to-aim + scale-to-zoom Earth globe</span><br/><span style="color: #94A3B8; font-size: 11px;">Hidden while the holodeck table is up. Aim/zoom/fade are math-driven so the dock handoff lines up by construction.</span>')
  @ui.separator

  @ui.label('<span style="color: #60A5FA;">References</span>')
  @input
  @hint("RenderMeshVisual of the sphere. Its material is cloned so fading never mutates the shared asset.")
  globeVisual: RenderMeshVisual

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Footprint matching</span>')
  @input
  @hint("Sphere radius in cm at scale = 1. Leave at 0 to AUTO-DETECT from the mesh bounding box (recommended). Set > 0 to override.")
  globeRadiusCm: number = 0

  @input
  @hint("On-screen size in cm of the holodeck table. dockScaleForSpan scales the globe so its L0 footprint roughly matches the table.")
  tableSizeCm: number = 60

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging</span>')
  @input
  @hint("Enable general logging")
  enableLogging: boolean = false

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy)")
  enableLoggingLifecycle: boolean = false

  private logger: Logger
  private transform: Transform
  private material: Material = null
  private baseScale: vec3 = vec3.one()
  // Resolved sphere radius (cm) at scale = 1; auto-detected from the mesh AABB
  // when globeRadiusCm <= 0, otherwise the override value.
  private resolvedRadiusCm: number = 0
  private currentScale: number = 1
  private currentAlpha: number = 1
  private tween: GlobeTween | null = null

  onAwake() {
    this.logger = new Logger("GlobeView", this.enableLogging || this.enableLoggingLifecycle, true)
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onAwake()")

    this.transform = this.getSceneObject().getTransform()
    this.baseScale = this.transform.getLocalScale()
    this.cloneMaterial()

    this.createEvent("UpdateEvent").bind(() => this.update(getDeltaTime()))
  }

  // --- Public API ------------------------------------------------------------

  /** The globe scale whose footprint matches the table showing `spanDeg`. */
  dockScaleForSpan(spanDeg: number): number {
    return dockScaleForSpan(spanDeg, this.getRadiusCm(), this.tableSizeCm)
  }

  /**
   * The sphere radius in cm at scale = 1. Uses the override when set, otherwise
   * auto-detects (once) from the mesh's local AABB scaled by the authored base
   * scale, so the footprint match needs no hand-measured radius.
   */
  getRadiusCm(): number {
    if (this.globeRadiusCm > 0) return this.globeRadiusCm
    if (this.resolvedRadiusCm > 0) return this.resolvedRadiusCm
    this.resolvedRadiusCm = this.detectRadiusCm()
    return this.resolvedRadiusCm
  }

  /**
   * Local-space sphere radius (half the largest AABB axis), in the globe's own
   * coordinate space. Use this to place children (e.g. city markers) on the
   * surface so they ride along with the globe's rotation/scale.
   */
  getLocalRadiusCm(): number {
    if (!this.globeVisual) return 0
    const min = this.globeVisual.localAabbMin()
    const max = this.globeVisual.localAabbMax()
    return Math.max(max.x - min.x, max.y - min.y, max.z - min.z) / 2
  }

  /** Manually rotates the globe by yaw/pitch deltas (radians) in local space. */
  rotateBy(yawRad: number, pitchRad: number): void {
    const delta = quat.angleAxis(yawRad, vec3.up()).multiply(quat.angleAxis(pitchRad, vec3.right()))
    this.transform.setLocalRotation(delta.multiply(this.transform.getLocalRotation()))
  }

  // Local-space half-extent (largest axis) times the authored base scale gives
  // the world radius at scale = 1, independent of any runtime zoom we apply.
  private detectRadiusCm(): number {
    const fallback = 30
    if (!this.globeVisual) {
      this.logger.warn("Cannot auto-detect globe radius (no globeVisual); using " + fallback + " cm.")
      return fallback
    }
    const min = this.globeVisual.localAabbMin()
    const max = this.globeVisual.localAabbMax()
    const localR = Math.max(max.x - min.x, max.y - min.y, max.z - min.z) / 2
    const s = this.baseScale
    const worldR = localR * Math.max(s.x, s.y, s.z)
    if (!(worldR > 0)) {
      this.logger.warn("Auto-detected non-positive globe radius; using " + fallback + " cm.")
      return fallback
    }
    this.logger.info("Auto-detected globe radius: " + worldR.toFixed(1) + " cm")
    return worldR
  }

  /** Instantly rotates the globe so `latLng` faces the viewer (front-center). */
  aimAt(latLng: LatLng): void {
    this.transform.setLocalRotation(this.rotationFor(latLng))
  }

  /** Instantly sets the zoom scale (multiplier on the authored base scale). */
  zoomTo(scale: number): void {
    this.currentScale = Math.max(1e-3, scale)
    this.applyScale()
  }

  /** Sets the globe opacity (0..1) on the cloned material's baseColor alpha. */
  setAlpha(alpha: number): void {
    this.currentAlpha = clamp01(alpha)
    this.applyAlpha()
  }

  /**
   * Tweens aim + zoom + alpha together over `duration` seconds. Used both for
   * the OVERVIEW->dock approach (aim to the city, zoom to dock scale) and for the
   * crossfade (alpha to 0). Calls `onDone` when finished.
   */
  animate(
    targetLatLng: LatLng | null,
    targetScale: number,
    targetAlpha: number,
    duration: number,
    onDone?: () => void
  ): void {
    const toRot = targetLatLng ? this.rotationFor(targetLatLng) : this.transform.getLocalRotation()
    this.tween = {
      fromRot: this.transform.getLocalRotation(),
      toRot,
      fromScale: this.currentScale,
      toScale: Math.max(1e-3, targetScale),
      fromAlpha: this.currentAlpha,
      toAlpha: clamp01(targetAlpha),
      duration: Math.max(0.0001, duration),
      elapsed: 0,
      onDone: onDone ?? null,
    }
    if (duration <= 0) this.finishTween()
  }

  /** Fades the globe in (and enables it) over `duration` seconds. */
  show(duration: number = 0.6, onDone?: () => void): void {
    this.getSceneObject().enabled = true
    this.animate(null, this.currentScale, 1, duration, onDone)
  }

  /** Fades the globe out over `duration` seconds, then disables the object. */
  hide(duration: number = 0.6, onDone?: () => void): void {
    this.animate(null, this.currentScale, 0, duration, () => {
      this.getSceneObject().enabled = false
      if (onDone) onDone()
    })
  }

  // --- Internal --------------------------------------------------------------

  private rotationFor(latLng: LatLng): quat {
    const e = aimEuler(latLng.lng, latLng.lat)
    return quat.fromEulerAngles(e.x, e.y, e.z)
  }

  private cloneMaterial(): void {
    if (!this.globeVisual) {
      this.logger.warn("No globeVisual assigned; globe will not render or fade.")
      return
    }
    // Clone-before-modify so the shared base material asset is never mutated.
    this.material = this.globeVisual.mainMaterial.clone()
    this.globeVisual.mainMaterial = this.material
    this.applyAlpha()
  }

  private applyScale(): void {
    this.transform.setLocalScale(this.baseScale.uniformScale(this.currentScale))
  }

  private applyAlpha(): void {
    if (!this.material) return
    const pass = this.material.mainPass as any
    const c = pass.baseColor as vec4
    if (c) {
      pass.baseColor = new vec4(c.r, c.g, c.b, this.currentAlpha)
    }
  }

  private update(dt: number): void {
    if (!this.tween) return
    const t = this.tween
    t.elapsed += dt
    const k = easeInOutCubic(clamp01(t.elapsed / t.duration))

    this.transform.setLocalRotation(quat.slerp(t.fromRot, t.toRot, k))
    this.currentScale = lerp(t.fromScale, t.toScale, k)
    this.applyScale()
    this.currentAlpha = lerp(t.fromAlpha, t.toAlpha, k)
    this.applyAlpha()

    if (t.elapsed >= t.duration) this.finishTween()
  }

  private finishTween(): void {
    if (!this.tween) return
    const t = this.tween
    this.transform.setLocalRotation(t.toRot)
    this.currentScale = t.toScale
    this.applyScale()
    this.currentAlpha = t.toAlpha
    this.applyAlpha()
    const done = t.onDone
    this.tween = null
    if (done) done()
  }
}
