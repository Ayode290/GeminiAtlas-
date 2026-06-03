/**
 * Specs Inc. 2026
 * World Mesh Fallback for the Crop Spectacles lens.
 *
 * Decides which surface the ping scan draws on. When real-world scene
 * reconstruction (World Mesh) is producing geometry, the ping shader renders on
 * the live World Mesh. When it is not (in the editor, on unsupported hardware,
 * or before the first scan generates faces), a flat ground-plane quad is enabled
 * instead so the ping still has a surface, positioned at the detected (or
 * default) floor height.
 *
 * World units in Lens Studio are centimeters.
 */
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";
import { bindStartEvent } from "SnapDecorators.lspkg/decorators";

@component
export class WorldMeshFallback extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">WorldMeshFallback – chooses World Mesh vs ground-plane surface</span><br/><span style="color: #94A3B8; font-size: 11px;">Enables the World Mesh visual when reconstruction has faces; otherwise shows a ground quad placed at the detected (or default) floor height.</span>')
  @ui.separator

  @ui.label('<span style="color: #60A5FA;">References</span>')
  @input
  @hint("World Mesh RenderMeshVisual (driven by WorldRenderObjectProvider)")
  @allowUndefined
  worldMeshVisual: RenderMeshVisual

  @input
  @hint("Ground-plane quad used as the fallback ping surface")
  @allowUndefined
  groundPlane: SceneObject

  @input
  @hint("Scene object used as the head/camera reference for floor detection")
  @allowUndefined
  headObject: SceneObject

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Tuning</span>')
  @input
  @hint("Fallback floor offset below the head (cm, negative = below). Used when no floor hit is found.")
  defaultFloorOffset: number = -120

  @input
  @hint("Keep the ground plane enabled even when the World Mesh is available (covers mesh holes)")
  keepGroundWithMesh: boolean = false

  @input
  @hint("How often (seconds) to re-evaluate World Mesh availability and floor height")
  checkIntervalSec: number = 1.0

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging</span>')
  @input
  @hint("Enable general logging")
  enableLogging: boolean = false;

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy)")
  enableLoggingLifecycle: boolean = false;

  private logger: Logger;

  private isEditor = global.deviceInfoSystem.isEditor()
  private worldQueryModule = require("LensStudio:WorldQueryModule")
  private hitTestSession = null

  onAwake() {
    this.logger = new Logger("WorldMeshFallback", this.enableLogging || this.enableLoggingLifecycle, true);
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onAwake()");
  }

  @bindStartEvent
  start() {
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onStart()");

    if (!this.isEditor) {
      this.hitTestSession = this.createHitTestSession()
    }

    // Place the ground at a sensible default immediately, then refine.
    this.positionGroundAtDefault()
    this.updateSurfaceState()
    this.scheduleRecheck()
  }

  private createHitTestSession() {
    try {
      const options = HitTestSessionOptions.create()
      options.filter = true
      return this.worldQueryModule.createHitTestSessionWithOptions(options)
    } catch (e) {
      this.logger.warn("Could not create hit test session: " + e)
      return null
    }
  }

  // Re-evaluates availability and floor height on a fixed cadence. World Mesh
  // refreshes slowly (~5Hz) and fills in over time, so a periodic check lets us
  // switch from the fallback ground to the real mesh once it has geometry.
  private scheduleRecheck(): void {
    const delayed = this.createEvent("DelayedCallbackEvent")
    delayed.bind(() => {
      this.updateSurfaceState()
      this.scheduleRecheck()
    })
    delayed.reset(Math.max(0.1, this.checkIntervalSec))
  }

  private updateSurfaceState(): void {
    const meshAvailable = this.isMeshAvailable()

    if (this.worldMeshVisual) {
      this.worldMeshVisual.enabled = meshAvailable
    }
    if (this.groundPlane) {
      this.groundPlane.enabled = !meshAvailable || this.keepGroundWithMesh
    }

    // Only bother updating the floor when the ground plane is actually shown.
    if (!meshAvailable || this.keepGroundWithMesh) {
      this.updateFloorHeight()
    }
  }

  private isMeshAvailable(): boolean {
    if (this.isEditor) {
      return false
    }
    return this.getMeshFaceCount() > 0
  }

  private getMeshFaceCount(): number {
    if (!this.worldMeshVisual) {
      return 0
    }
    try {
      const provider = this.worldMeshVisual.mesh.control as WorldRenderObjectProvider
      return provider ? provider.faceCount : 0
    } catch (e) {
      return 0
    }
  }

  private updateFloorHeight(): void {
    if (!this.groundPlane) {
      return
    }
    if (this.isEditor || !this.hitTestSession || !this.headObject) {
      this.positionGroundAtDefault()
      return
    }

    const headPos = this.headObject.getTransform().getWorldPosition()
    const rayEnd = headPos.add(new vec3(0, -1000, 0))

    this.hitTestSession.hitTest(headPos, rayEnd, (result) => {
      const transform = this.groundPlane.getTransform()
      const current = transform.getWorldPosition()
      if (result) {
        transform.setWorldPosition(new vec3(current.x, result.position.y, current.z))
      } else {
        transform.setWorldPosition(new vec3(current.x, headPos.y + this.defaultFloorOffset, current.z))
      }
    })
  }

  private positionGroundAtDefault(): void {
    if (!this.groundPlane) {
      return
    }
    const transform = this.groundPlane.getTransform()
    const current = transform.getWorldPosition()
    const baseY = this.headObject
      ? this.headObject.getTransform().getWorldPosition().y + this.defaultFloorOffset
      : this.defaultFloorOffset
    transform.setWorldPosition(new vec3(current.x, baseY, current.z))
  }
}
