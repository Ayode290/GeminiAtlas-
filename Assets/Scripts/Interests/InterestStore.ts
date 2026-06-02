/**
 * Specs Inc. 2026
 * Interest Store for the Crop Spectacles lens.
 * Session-scoped singleton that holds the user's selected topics of interest.
 * Registered on `global.cropInterestStore` so it can be read across prefab
 * boundaries (e.g. by the runtime-instantiated Scanner prefab).
 *
 * future: integrate Lens Studio voice input and optional on-device persistence.
 */
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";

@component
export class InterestStore extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">InterestStore – holds selected topics for the session</span><br/><span style="color: #94A3B8; font-size: 11px;">Registered on global.cropInterestStore and read by ChatGPT when building the factoid prompt.</span>')
  @ui.separator

  @ui.label('<span style="color: #60A5FA;">Logging</span>')
  @input
  @hint("Enable general logging")
  enableLogging: boolean = false;

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy)")
  enableLoggingLifecycle: boolean = false;

  private logger: Logger;

  // Stored selections. Never mutated in place; replaced with new arrays.
  private interests: string[] = []

  // True once the user has confirmed their topic selection.
  private ready: boolean = false

  onAwake() {
    this.logger = new Logger("InterestStore", this.enableLogging || this.enableLoggingLifecycle, true);
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onAwake()");
    (global as any).cropInterestStore = this
  }

  /**
   * Replaces the stored interests with a sanitized copy of the provided list.
   * Empty and whitespace-only entries are dropped; never mutates the input.
   */
  setInterests(list: string[]) {
    const cleaned = (list ?? [])
      .filter((topic) => typeof topic === "string" && topic.trim().length > 0)
      .map((topic) => topic.trim())
    this.interests = cleaned
    this.logger.info("Interests set: " + (cleaned.length > 0 ? cleaned.join(", ") : "(none)"))
  }

  /**
   * Returns a copy of the stored interests so callers cannot mutate internal state.
   */
  getInterests(): string[] {
    return this.interests.slice()
  }

  hasInterests(): boolean {
    return this.interests.length > 0
  }

  get isReady(): boolean {
    return this.ready
  }

  markReady() {
    this.ready = true
    this.logger.debug("InterestStore marked ready.")
  }
}
