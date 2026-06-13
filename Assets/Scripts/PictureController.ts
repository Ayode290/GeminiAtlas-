/**
 * Specs Inc. 2026
 * Picture Controller for the Crop Spectacles lens experience.
 */
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";
import {SIK} from "SpectaclesInteractionKit.lspkg/SIK"
import {PictureBehavior} from "./PictureBehavior"

@component
export class PictureController extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">PictureController – spawns crop scanner on dual pinch</span><br/><span style="color: #94A3B8; font-size: 11px;">Detects simultaneous close pinch from both hands to instantiate the scanner prefab.</span>')
  @ui.separator

  @ui.label('<span style="color: #60A5FA;">References</span>')
  @input
  @hint("Prefab instantiated when both hands pinch close together")
  scannerPrefab: ObjectPrefab

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Demo Mode (no AI)</span>')
  @input
  @hint("Demo-only: skip the ChatGPT vision call. Capture + display work exactly the same, but each crop loads the next pre-written caption below instead of analyzing the image. The backdrop color, action buttons, storage, and voice agent all behave identically.")
  demoMode: boolean = false

  @input
  @hint("Pre-written captions, one per capture IN ORDER (crop 0 -> entry 0, crop 1 -> entry 1, ...). END EACH with a hashtag line, e.g. '#Space #Saturn #Astronomy'. The FIRST hashtag must match a preset topic (Art History, Chemistry, Biology, Botany, Physics, Space, Music, History, Food, Design, Trains, Aviation, XR) so the backdrop picks the right color. Once the list runs out, further crops reuse the last entry.")
  demoCaptions: string[]

  @input
  @hint("OPTIONAL parallel list of voice-agent opener prompts (same index as the caption above). Controls what the AI says when it comes over to comment on that card. Use {caption} and {interests} as placeholders. Leave an entry blank to use the default opener.")
  demoAgentPrompts: string[]

  @input
  @hint("Demo-only: seconds to show the loading indicator before the caption appears, mimicking the AI 'thinking' delay.")
  demoLoadingSeconds: number = 1.2

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

  private rightHand = SIK.HandInputData.getHand("right")
  private leftHand = SIK.HandInputData.getHand("left")

  private leftDown = false
  private rightDown = false

  // Demo mode: which pre-written caption the NEXT real capture consumes. Advanced
  // only when a scanner actually pulls its content (so a too-small crop that
  // destroys itself never skips an entry), and clamped so it reuses the last one.
  private demoIndex = 0

  onAwake() {
    this.logger = new Logger("PictureController", this.enableLogging || this.enableLoggingLifecycle, true);
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onAwake()");
    this.rightHand.onPinchUp.add(this.rightPinchUp)
    this.rightHand.onPinchDown.add(this.rightPinchDown)
    this.leftHand.onPinchUp.add(this.leftPinchUp)
    this.leftHand.onPinchDown.add(this.leftPinchDown)
    if (this.isEditor) {
      this.createEvent("TouchStartEvent").bind(this.editorTest.bind(this))
    } else {
      const obj = this.getSceneObject()
      if (obj.getChildrenCount() > 0) {
        obj.getChild(0).destroy()
      }
    }
  }

  editorTest() {
    this.logger.info("Creating Editor Scanner...")
    this.createScanner()
  }

  private leftPinchDown = () => {
    this.logger.debug("LEFT Pinch down")
    this.leftDown = true
    if (this.rightDown && this.isPinchClose()) {
      this.createScanner()
    }
  }

  private leftPinchUp = () => {
    this.logger.debug("LEFT Pinch up")
    this.leftDown = false
  }

  private rightPinchDown = () => {
    this.logger.debug("RIGHT Pinch down")
    this.rightDown = true
    if (this.leftDown && this.isPinchClose()) {
      this.createScanner()
    }
  }

  private rightPinchUp = () => {
    this.logger.debug("RIGHT Pinch up")
    this.rightDown = false
  }

  isPinchClose() {
    return this.leftHand.thumbTip.position.distance(this.rightHand.thumbTip.position) < 10
  }

  createScanner() {
    // Gate scanning until the user has confirmed their interests at launch.
    // If no store is present, scanning is allowed (graceful fallback).
    if (!this.isEditor) {
      const store = (global as any).cropInterestStore
      if (store && !store.isReady) {
        this.logger.debug("Interests not confirmed yet; ignoring scan trigger.")
        return
      }
    }
    const scanner = this.scannerPrefab.instantiate(this.getSceneObject())
    if (this.demoMode) {
      this.configureDemoScanner(scanner)
    }
  }

  /**
   * Wires a freshly instantiated scanner into demo mode: instead of calling
   * ChatGPT, its capture will pull the next pre-written caption (and optional
   * agent opener prompt) from this controller. Done right after instantiate so
   * the provider is set before any capture completes (the editor preview path in
   * PictureBehavior fires on a short delay; device captures wait for pinch-up).
   */
  private configureDemoScanner(scanner: SceneObject): void {
    if (!this.demoCaptions || this.demoCaptions.length === 0) {
      this.logger.warn("Demo mode is on but no demoCaptions are set; falling back to live AI.")
      return
    }
    const pb = (scanner as any).getComponent(PictureBehavior.getTypeName()) as PictureBehavior
    if (!pb || typeof pb.enableDemo !== "function") {
      this.logger.warn("Scanner has no PictureBehavior; cannot enable demo mode, using live AI.")
      return
    }
    pb.enableDemo(Math.max(0, this.demoLoadingSeconds), () => this.takeNextDemoContent())
  }

  /**
   * Hands out the caption + opener prompt for the next real capture and advances
   * the index (clamped to the last entry, which then repeats). Called by the
   * scanner at the moment it commits to a capture, so indices stay in lockstep
   * with cards that actually appear.
   */
  private takeNextDemoContent(): {caption: string; agentPrompt: string} {
    const captions = this.demoCaptions ?? []
    const i = Math.min(this.demoIndex, captions.length - 1)
    const caption = captions[i] ?? ""
    const prompts = this.demoAgentPrompts ?? []
    const agentPrompt = i < prompts.length ? prompts[i] ?? "" : ""
    if (this.demoIndex < captions.length) {
      this.demoIndex++
    }
    this.logger.debug("Demo caption " + i + " of " + captions.length)
    return {caption, agentPrompt}
  }
}
