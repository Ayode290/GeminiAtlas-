/**
 * Specs Inc. 2026
 * CityMarker – a light selection affordance pinned at a city on the globe.
 *
 * Holds the city name and exposes a highlight toggle (a small scale pop) so the
 * controller can show which marker the user is gazing at before they pinch to
 * select. Selection itself (gaze + pinch) is handled by GlobeController, which
 * owns the input; this component is intentionally minimal.
 */
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";

@component
export class CityMarker extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">CityMarker – tappable pin marking a city on the globe</span><br/><span style="color: #94A3B8; font-size: 11px;">Name must match a city in cityBounds.ts (Tokyo / Seattle / Los Angeles). Highlight is driven by the controller on gaze.</span>')
  @ui.separator

  @input
  @hint("City name; must match a city in cityBounds.ts exactly (e.g. \"Tokyo\", \"Seattle\", \"Los Angeles\").")
  cityName: string = "Tokyo"

  @input
  @hint("Scale multiplier applied when this marker is highlighted (gazed at).")
  highlightScale: number = 1.4

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
  private baseScale: vec3 = vec3.one()
  private highlighted: boolean = false

  onAwake() {
    this.logger = new Logger("CityMarker", this.enableLogging || this.enableLoggingLifecycle, true)
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onAwake()")
    this.transform = this.getSceneObject().getTransform()
    this.baseScale = this.transform.getLocalScale()
  }

  /** The city this marker selects. */
  getCityName(): string {
    return this.cityName
  }

  /** Sets the city this marker selects (used by code-created markers). */
  setCityName(name: string): void {
    this.cityName = name
  }

  /**
   * Re-reads the current local scale as the highlight base. Call this after a
   * code-created marker has been (re)scaled so the highlight pop is relative to
   * the final size, not whatever scale existed at onAwake.
   */
  refreshBaseScale(): void {
    if (this.transform) this.baseScale = this.transform.getLocalScale()
  }

  /** This marker's world position (the point the controller aims toward). */
  getWorldPosition(): vec3 {
    return this.getSceneObject().getTransform().getWorldPosition()
  }

  /** Pops the marker up/down to show gaze focus (no mutation of base scale). */
  setHighlighted(on: boolean): void {
    if (on === this.highlighted) return
    this.highlighted = on
    const s = on ? Math.max(0.01, this.highlightScale) : 1
    this.transform.setLocalScale(this.baseScale.uniformScale(s))
  }

  /** Shows/hides the marker (used when leaving OVERVIEW). */
  setVisible(visible: boolean): void {
    this.getSceneObject().enabled = visible
  }
}
