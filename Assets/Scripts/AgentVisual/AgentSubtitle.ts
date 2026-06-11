/**
 * Specs Inc. 2026
 * AgentSubtitle — the live caption of whatever the voice agent is saying.
 *
 * A single world-space Text that the AgentSphere positions every frame (right of
 * the orb in its home corner, or below the active card) and the voice scripts feed
 * spoken text into. The text TYPES OUT in sync with the voice: agents push the
 * incremental output-transcription fragments as they arrive (interleaved with the
 * audio frames), and the reveal is paced against the orb's audio schedule so the
 * characters finish exactly when the buffered speech finishes.
 *
 * Layout rules (driven by AgentSphere via place()):
 *   - one rendered line (incl. padding) = HALF the orb's height, so a full 2-line
 *     block equals the orb's height.
 *   - at most 2 lines, rolling: as new words type in at the end, the oldest words
 *     scroll off the front (live-caption style).
 *   - wraps to a caller-supplied width (FOV-bounded in home, card-width on a card).
 *
 * Pattern mirrors CaptionBehavior's world-space wrap (worldSpaceRect in local units,
 * converted through the text's world scale) and the global-registration used by
 * AgentSphere / cardVoiceAgent. Registered at global.agentSubtitle.
 */
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";

type HAlign = "left" | "center";
type VAlign = "center" | "top";

// Internal point size used only to lay the text out for measurement. It has NO
// effect on the on-screen size — the text is rescaled to the orb-height law every
// frame, so this value cancels out. The visible size knob is `heightScale`.
const MEASURE_FONT_SIZE = 36;

interface SubtitlePose {
  pos: vec3;
  rot: quat;
  lineHeightCm: number; // half the orb height (one line slot)
  widthCm: number;
  hAlign: HAlign;
  vAlign: VAlign;
}

@component
export class AgentSubtitle extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">AgentSubtitle – the voice agent\'s live caption</span><br/><span style="color: #94A3B8; font-size: 11px;">A world-space Text positioned by AgentSphere and fed by the voice scripts (global.agentSubtitle.pushText). Types out in sync with the voice, max 2 rolling lines.</span>')
  @ui.separator

  @ui.label('<span style="color: #60A5FA;">References</span>')
  @input
  @hint("Text component to drive. Leave empty to auto-create one on a child object.")
  @allowUndefined
  subtitleText: Text

  @input
  @hint("Font for the auto-created Text (ignored if a Text is assigned above with its own font).")
  @allowUndefined
  font: Font

  @input
  @hint("Text color.")
  color: vec4 = new vec4(1, 1, 1, 1)

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Layout</span>')
  @input
  @hint("THE text size knob. Fraction of the orb height: 1 = one line is exactly half the orb height; lower = smaller text. (Font size is fixed internally — it has no visible effect because the text is auto-scaled to this height.)")
  heightScale: number = 0.8

  @input
  @hint("Horizontal padding (cm) inset on each side from the available width.")
  sidePadCm: number = 0.6

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Reveal (typewriter sync)</span>')
  @input
  @hint("Slowest reveal speed (chars/sec) while the agent is speaking.")
  minCps: number = 6

  @input
  @hint("Fastest reveal speed (chars/sec); caps how quickly a backlog is flushed.")
  maxCps: number = 55

  @input
  @hint("Reveal speed (chars/sec) for the tail once the audio has drained.")
  tailCps: number = 28

  @input
  @hint("Seconds the finished caption lingers before it clears.")
  lingerSeconds: number = 1.2

  @input
  @hint("Backstop: wipe the caption after this many seconds of total agent silence, even if the normal linger clear didn't fire (e.g. a stuck audio schedule).")
  silenceWipeSeconds: number = 5

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging</span>')
  @input
  enableLogging: boolean = false

  private logger: Logger
  private text: Text | null = null
  private textTrans: Transform

  // Streaming reveal state.
  private accumulated = ""     // everything the agent has said this turn (target)
  private revealed = 0         // float count of chars revealed from `accumulated`
  private displayStart = 0     // first char index shown (front of the 2-line window)
  private idleAfterDone = 0    // seconds since fully revealed + silent (for linger clear)
  private silentSeconds = 0    // seconds with no new text and no audibly-draining audio
  private lastSpeakSecs = 0    // previous frame's speakingSecondsRemaining (stuck detection)

  // Calibration: local-space height of a 2-line block at scale 1 (font-dependent).
  private twoLineLocalH = 0
  private frames = 0
  private loggedShow = false

  private pose: SubtitlePose | null = null

  onAwake(): void {
    this.logger = new Logger("AgentSubtitle", this.enableLogging, true)
    ;(global as any).agentSubtitle = this

    if (!this.subtitleText) {
      const obj = global.scene.createSceneObject("AgentSubtitle Text")
      obj.setParent(this.getSceneObject())
      // Render on the same layer as this component's object so the camera draws it
      // (a fresh root object can otherwise land on a layer the camera ignores).
      obj.layer = this.getSceneObject().layer
      this.text = obj.createComponent("Component.Text") as Text
      if (this.font) this.text.font = this.font
    } else {
      this.text = this.subtitleText
    }
    this.text.text = ""
    this.text.size = MEASURE_FONT_SIZE
    this.text.textFill.color = this.color
    this.textTrans = this.text.getSceneObject().getTransform()

    this.createEvent("UpdateEvent").bind(() => this.update(getDeltaTime()))
  }

  // --- Public surface (called by the voice scripts and AgentSphere) ---

  /** Append a spoken-text fragment. Starts a fresh caption if the previous turn finished. */
  pushText(fragment: string): void {
    if (!fragment) return
    // New turn: the previous caption fully revealed and the audio has gone silent.
    if (
      this.accumulated.length > 0 &&
      this.revealed >= this.accumulated.length &&
      this.speakingSecondsRemaining() <= 0
    ) {
      this.resetBuffer()
    }
    this.accumulated += fragment
    this.idleAfterDone = 0
    this.silentSeconds = 0
    this.logger.info("pushText (+" + fragment.length + ") -> len " + this.accumulated.length)
  }

  /** Hard reset — wipe the caption now (barge-in / scene change). */
  clear(): void {
    this.resetBuffer()
    if (this.text) this.text.text = ""
  }

  /**
   * Positions + sizes the caption for this frame. Called by AgentSphere with the
   * orb-relative anchor: `lineHeightCm` is half the orb height (one line slot), so a
   * 2-line block equals the orb height. `widthCm` is the wrap width budget.
   */
  place(pos: vec3, rot: quat, lineHeightCm: number, widthCm: number, hAlign: HAlign, vAlign: VAlign): void {
    this.pose = { pos, rot, lineHeightCm, widthCm, hAlign, vAlign }
  }

  // --- Internals ---

  private resetBuffer(): void {
    this.accumulated = ""
    this.revealed = 0
    this.displayStart = 0
    this.idleAfterDone = 0
    this.silentSeconds = 0
  }

  /** Buffered speech still to be heard (the clock we pace the typewriter against). */
  private speakingSecondsRemaining(): number {
    const sphere = (global as any).agentSphere
    const s = sphere?.getSpeakingSecondsRemaining?.()
    return typeof s === "number" && s > 0 ? s : 0
  }

  /**
   * Font calibration: the local height of a 2-line block at scale 1. Measured with
   * the sample laid out but at zero fill alpha so it never flashes (mirrors
   * CardCaption.beginMeasure). Falls back to a font-size estimate if the measure
   * never returns, so the caption is never permanently blank.
   */
  private calibrate(): void {
    if (this.twoLineLocalH > 0 || !this.text) return
    const c = this.color
    this.text.textFill.color = new vec4(c.r, c.g, c.b, 0)
    this.text.verticalOverflow = VerticalOverflow.Overflow
    this.text.text = "Ag\nAg"
    const h = this.text.getBoundingBox().getSize().y
    if (h > 0) {
      this.twoLineLocalH = h
      this.logger.info("calibrated twoLineLocalH=" + h)
    } else if (this.frames > 30) {
      this.twoLineLocalH = Math.max(1, MEASURE_FONT_SIZE * 2.6)
      this.logger.warn("calibration fell back to " + this.twoLineLocalH)
    }
    this.text.text = ""
    this.text.textFill.color = this.color
  }

  private update(dt: number): void {
    if (!this.text) return
    this.frames++
    this.calibrate()

    // Advance the reveal, paced so the characters land with the audio. While the
    // agent is speaking, spread the remaining chars over the remaining audio; once
    // the audio has drained, finish the tail at a steady fallback rate.
    const remainingChars = this.accumulated.length - this.revealed
    if (remainingChars > 0) {
      const secs = this.speakingSecondsRemaining()
      let cps: number
      if (secs > 0) {
        cps = remainingChars / Math.max(secs, 0.25)
        cps = Math.max(this.minCps, Math.min(this.maxCps, cps))
      } else {
        cps = this.tailCps
      }
      this.revealed = Math.min(this.accumulated.length, this.revealed + cps * dt)
    }

    // Silence watchdog: wipe after `silenceWipeSeconds` of total agent silence,
    // regardless of reveal state. "Speaking" requires the audio schedule to be
    // positive AND actively draining — a schedule frozen above zero (the way a
    // caption gets stuck forever) counts as silence; real playback drains every
    // frame, so long replies are never wiped mid-utterance.
    const speakSecs = this.speakingSecondsRemaining()
    const audiblySpeaking = speakSecs > 0 && Math.abs(speakSecs - this.lastSpeakSecs) > 1e-6
    this.lastSpeakSecs = speakSecs
    if (this.accumulated.length > 0) {
      this.silentSeconds = audiblySpeaking ? 0 : this.silentSeconds + dt
      if (this.silentSeconds >= this.silenceWipeSeconds) {
        this.logger.info("silence watchdog wiped the caption (" + this.silenceWipeSeconds + "s)")
        this.clear()
        return
      }
    }

    // Linger then clear once everything is revealed and the agent is silent.
    const done = this.revealed >= this.accumulated.length
    if (done && this.speakingSecondsRemaining() <= 0 && this.accumulated.length > 0) {
      this.idleAfterDone += dt
      if (this.idleAfterDone >= this.lingerSeconds) {
        this.clear()
        return
      }
    } else {
      this.idleAfterDone = 0
    }

    if (!this.pose || this.accumulated.length === 0) {
      this.text.text = ""
      return
    }
    if (!this.loggedShow) {
      this.loggedShow = true
      this.logger.info("first caption render (twoLineLocalH=" + this.twoLineLocalH + ")")
    }

    this.applyLayout(this.pose)
    this.renderRolling()
    // Pose is written after layout so scale/rect are consistent this frame.
    this.textTrans.setWorldRotation(this.pose.rot)
    this.textTrans.setWorldPosition(this.pose.pos)
  }

  /** Sets world scale + wrap rect so one line = lineHeightCm (half the orb height). */
  private applyLayout(p: SubtitlePose): void {
    // Ensure full opacity (calibration may have left the sample transparent).
    this.text.textFill.color = this.color
    const orbFullCm = p.lineHeightCm * 2 * this.heightScale
    const ref = this.twoLineLocalH > 0 ? this.twoLineLocalH : Math.max(1, MEASURE_FONT_SIZE * 2.6)
    const S = orbFullCm / ref // world scale: 2-line block == orb height * heightScale
    this.textTrans.setWorldScale(vec3.one().uniformScale(S))

    const innerWidthCm = Math.max(0.1, p.widthCm - 2 * this.sidePadCm)
    const localW = innerWidthCm / S
    // Horizontal: left-anchored ribbon (home) starts at the origin and grows right;
    // centered (card) is symmetric about the origin.
    const left = p.hAlign === "left" ? 0 : -localW / 2
    const right = p.hAlign === "left" ? localW : localW / 2
    // Vertical: centered on the origin (home) or top-anchored growing down (card).
    const top = p.vAlign === "center" ? 100000 : 0
    const bottom = p.vAlign === "center" ? -100000 : -100000

    this.text.horizontalOverflow = HorizontalOverflow.Wrap
    this.text.verticalOverflow = VerticalOverflow.Overflow
    this.text.horizontalAlignment = p.hAlign === "left" ? HorizontalAlignment.Left : HorizontalAlignment.Center
    this.text.verticalAlignment = p.vAlign === "center" ? VerticalAlignment.Center : VerticalAlignment.Top
    this.text.worldSpaceRect = Rect.create(left, right, bottom, top)
  }

  /** Shows accumulated[displayStart..revealed], trimming the front to fit 2 lines. */
  private renderRolling(): void {
    const end = Math.floor(this.revealed)
    if (this.displayStart > end) this.displayStart = end
    this.text.text = this.accumulated.slice(this.displayStart, end)

    // Fit to 2 lines, measuring at most ONCE per frame (getBoundingBox is rate-limited
    // to a few calls/frame — a per-frame loop throws). If too tall, drop a single
    // leading word; the slow typewriter reveal (~1-2 chars/frame) means one word/frame
    // keeps pace, so the window stays within 2 lines without ever looping.
    const ref = this.twoLineLocalH > 0 ? this.twoLineLocalH : Math.max(1, MEASURE_FONT_SIZE * 2.6)
    if (this.text.getBoundingBox().getSize().y > ref * 1.05) {
      const nextSpace = this.accumulated.indexOf(" ", this.displayStart)
      if (nextSpace >= 0 && nextSpace < end - 1) {
        this.displayStart = nextSpace + 1
        this.text.text = this.accumulated.slice(this.displayStart, end)
      }
    }

    // Compact the dead prefix occasionally so `accumulated` doesn't grow unbounded.
    if (this.displayStart > 4000) {
      this.accumulated = this.accumulated.slice(this.displayStart)
      this.revealed -= this.displayStart
      this.displayStart = 0
    }
  }
}
