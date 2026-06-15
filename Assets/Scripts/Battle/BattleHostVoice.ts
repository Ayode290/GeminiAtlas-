/**
 * Specs Inc. 2026
 * BattleHostVoice — the sassy trivia-show host for Battle mode.
 *
 * Audio-output-only Gemini Live narrator (same plumbing as NudgeVoice — no mic)
 * that *speaks* the host's reactions during a 1v1 Battle match. The lines come
 * from BattleHostLines (a curated, guardrail-safe bank with intensity calibration
 * and no-repeat rotation) — this component just gives them a voice and keeps the
 * single live session healthy.
 *
 * It is GENERATION-FREE on purpose: it never asks the model to invent a line. It
 * hands the model an exact line and tells it to read it verbatim with sassy
 * delivery. That keeps every guardrail (short, kind-when-losing, no repeats) under
 * deterministic control while still getting expressive, in-character speech.
 *
 * Per-device: each player's glasses run their own host, roasting THEIR play. No
 * network sync — the manager feeds this from the local player's perspective.
 *
 * Lifecycle (driven by MultiplayerTriviaManager):
 *   beginMatch()                 → reset rotation, lazy-connect the live session
 *   onBattleEvent(event, snap)   → pick a calibrated line and speak it
 *   speakRoast(text)             → speak the existing Supabase per-question roast
 *   endMatch()                   → close the session, freeing the single live slot
 *
 * Give this its OWN DynamicAudioOutput (separate from the other voices) to avoid
 * audio conflicts. Gemini Live runs over a gateway WebSocket — it does NOT work in
 * the Lens Studio simulator; test on device (or Preview with Device Type Override
 * = Spectacles) with the glasses online.
 */
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";
import { Gemini } from "RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAI";
import { GeminiTypes } from "RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAITypes";
import { DynamicAudioOutput } from "RemoteServiceGateway.lspkg/Helpers/DynamicAudioOutput";
import { pcm16Rms, pcm16DurationSec } from "../AudioLevel";
import { BattleHostDirector, BattleEvent, GameSnapshot } from "./BattleHostLines";

@component
export class BattleHostVoice extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #F59E0B;">Battle Host (Gemini Live)</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Sassy trivia-show host for Battle mode. Speaks curated, guardrail-safe lines (and the per-question roast) as the match unfolds. Audio-only, no mic. Does NOT run in the simulator — test on device with internet.</span>')
  @ui.separator

  @ui.group_start("Setup (drag from the RemoteServiceGatewayExamples prefab)")
  @input
  @hint("The 'Websocket requirements' SceneObject from the RemoteServiceGatewayExamples prefab. Enabled on launch so the gateway WebSocket can connect.")
  private websocketRequirementsObj: SceneObject;

  @input
  @hint("A DynamicAudioOutput object that plays the host voice. Give this its OWN (separate from the other voices) to avoid audio conflicts — duplicate the prefab's DynamicAudioOutput.")
  private dynamicAudioOutput: DynamicAudioOutput;
  @ui.group_end

  @ui.separator
  @ui.group_start("Speech")
  @input
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem("Charon", "Charon"),
      new ComboBoxItem("Puck", "Puck"),
      new ComboBoxItem("Fenrir", "Fenrir"),
      new ComboBoxItem("Leda", "Leda"),
      new ComboBoxItem("Kore", "Kore"),
      new ComboBoxItem("Aoede", "Aoede"),
      new ComboBoxItem("Orus", "Orus"),
      new ComboBoxItem("Zephyr", "Zephyr"),
    ])
  )
  private voice: string = "Charon";

  @input
  @widget(new TextAreaWidget())
  @hint("Host persona / system instruction. The host reads the supplied line VERBATIM with sassy delivery — it never invents or changes words.")
  private persona: string =
    "You are the VOICE of a sassy trivia game-show host (in the spirit of Tom Gleeson or Anne Robinson) -- a text-to-speech performer, NOT a chat partner. Every message you receive is ONE line of the host's script, and every line is spoken BY the host TO the two players -- it is NEVER addressed to you. Your only job: read that line OUT LOUD word-for-word, in the same order, with confident, sassy delivery. NEVER treat a line as something said to you, NEVER answer or react to it, and NEVER continue a conversation. Do not add, drop, rephrase, translate, or reorder any words. Never say filler like 'what's on your mind', 'that's fair', or 'I tried' -- say ONLY the words of the line. No greetings, no follow-up questions, no quotation marks, no stage directions, no preamble. Just perform the line.";

  @input
  @hint("Gemini Live model id (no 'models/' prefix — it's added automatically). Supported: gemini-live-2.5-flash, gemini-2.0-flash-live-preview-04-09, gemini-live-2.5-flash-preview-native-audio")
  private model: string = "gemini-live-2.5-flash";
  @ui.group_end

  @ui.separator
  @ui.group_start("Logging")
  @input private enableLogging: boolean = true;
  @ui.group_end

  private logger: Logger;
  private director: BattleHostDirector = new BattleHostDirector();

  // Appended to the persona FROM CODE (not the overridable @input) so the strict
  // read-verbatim framing always applies — even if a stale Inspector value keeps
  // an older persona. This is what stops the Live model from chatting back to our
  // lines (e.g. "that's fair… what's on your mind?") instead of reading them.
  private readonly DELIVERY_RULE: string =
    "STRICT DELIVERY RULES (highest priority): Every message arrives as `SAY: <line>`. The <line> after `SAY:` is ONE line of the host's script, spoken BY the host TO the players — it is NEVER addressed to you. Read that line aloud word-for-word with sassy delivery and STOP. Never voice the word `SAY:` or anything before the line. Never answer the line, react to it, paraphrase it, or continue a conversation. Never add greetings, follow-up questions, or filler such as 'what's on your mind', 'that's fair', or 'I tried'. Say ONLY the exact words of the line.";

  private liveSession: ReturnType<typeof Gemini.liveConnect>;
  private connecting = false;       // a connect is in flight (session not yet ready)
  private sessionReady = false;     // setupComplete received — safe to send turns
  private speaking = false;         // a turn is currently being spoken
  // At most one queued line: the newest line wins if one is already speaking, so a
  // burst of events never backs up the server with stale lines.
  private pendingLine: string | null = null;
  // Question reads are special: they're long, non-interrupting (they queue behind
  // any line in flight), and they get CUT — by stopQuestionRead() at a local buzz,
  // or by the next outcome line at round conclusion. These flags track whether the
  // current / pending turn is a question read so only it gets interrupted.
  private currentLineIsQuestion = false;  // the turn currently speaking is a question read
  private pendingIsQuestion = false;      // the queued line is a question read
  // Drop the in-flight question turn's burst frames after we've cut it (Gemini
  // streams a turn's whole audio up front, so flushing the buffer isn't enough —
  // late frames would restart playback). Cleared on turnComplete.
  private suppressQuestionAudio = false;

  onAwake(): void {
    this.logger = new Logger("BattleHostVoice", this.enableLogging, true);

    // Let the manager (and other scripts) reach the host.
    (global as any).battleHostVoice = this;

    if (this.websocketRequirementsObj) {
      // Harmless if another voice already enabled the shared requirements object.
      this.websocketRequirementsObj.enabled = true;
    } else {
      this.logger.error("websocketRequirementsObj not assigned — gateway WebSocket may fail.");
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public API (called by MultiplayerTriviaManager)
  // ───────────────────────────────────────────────────────────────────────────

  /** Start of a match: clear the no-repeat memory and lazy-connect the session. */
  beginMatch(): void {
    this.director.reset();
    this.ensureConnected();
  }

  /** React to a game moment: pick a calibrated, non-repeating line and speak it. */
  onBattleEvent(event: BattleEvent, snap: GameSnapshot): void {
    const line = this.director.lineFor(event, snap);
    if (!line) return;
    this.logger.info(`[${event}] i=${line.intensity.toFixed(2)} → ${line.text}`);
    // Outcome / event lines cut off an in-progress question read (the response
    // overrides the reading); they still queue normally behind another short line.
    this.speak(line.text, false, true);
  }

  /** Speak the question-specific roast on a wrong answer (already a full line). */
  speakRoast(text: string): void {
    if (!text || text.trim().length === 0) return;
    this.logger.info(`[ROAST] → ${text}`);
    this.speak(text, false, true);
  }

  /** Speak the question-specific praise on a correct answer (already a full line). */
  speakPraise(text: string): void {
    if (!text || text.trim().length === 0) return;
    this.logger.info(`[PRAISE] → ${text}`);
    this.speak(text, false, true);
  }

  /**
   * Read the question text aloud when a fresh question loads. Non-interrupting: it
   * queues behind any line already in flight (e.g. the matchpoint taunt), and is
   * itself cut by stopQuestionRead() at a local buzz or by the next outcome line.
   */
  speakQuestion(text: string): void {
    if (!text || text.trim().length === 0) return;
    this.logger.info(`[QUESTION] → ${text}`);
    this.speak(text, true, false);
  }

  /**
   * Silence this device's question read instantly (called the moment the LOCAL
   * player buzzes), leaving silence until the outcome line plays. No-op unless a
   * question read is currently speaking or queued.
   */
  stopQuestionRead(): void {
    // The question's audio plays out of the output buffer for several seconds —
    // long AFTER the server turn completes, because Gemini bursts a turn's whole
    // audio up front. So cut based on "a question read owns the audio output", NOT
    // on `speaking`, which has usually already flipped false by the time the player
    // buzzes (that was the bug: the read kept playing past the buzz).
    if (this.currentLineIsQuestion) {
      this.flushAudio();
      // Buzz landed during the initial burst (still streaming) → drop the rest.
      if (this.speaking) this.suppressQuestionAudio = true;
      this.logger.info("[QUESTION] cut at buzz");
    }
    // Drop a question that's only queued (or pending pre-connect) so it never fires.
    if (this.pendingIsQuestion) {
      this.pendingLine = null;
      this.pendingIsQuestion = false;
    }
  }

  /** End of the match: close the session so it doesn't hold the single live slot. */
  endMatch(): void {
    this.pendingLine = null;
    this.pendingIsQuestion = false;
    this.currentLineIsQuestion = false;
    this.suppressQuestionAudio = false;
    this.speaking = false;
    this.disconnect();
  }

  /** True while this voice holds (or is opening) the single gateway live session. */
  isActive(): boolean {
    return this.connecting || this.sessionReady;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Speaking
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * @param isQuestion  this line is a (long, cuttable) question read.
   * @param interrupt   an outcome/event line: cut off an in-progress question read
   *                    instead of queueing behind it (the response overrides the read).
   */
  private speak(text: string, isQuestion: boolean, interrupt: boolean): void {
    if (!text || text.trim().length === 0) return;

    // Not connected yet (e.g. the very first line of the match): open the session
    // and hold this as the line to say once setup completes.
    if (!this.sessionReady) {
      this.pendingLine = text; // newest wins
      this.pendingIsQuestion = isQuestion;
      this.ensureConnected();
      return;
    }

    // An outcome/event line overrides a question read — whether it's still
    // generating (`speaking`) or just playing out of the buffer (`speaking` already
    // flipped false). Cut the buffered question audio first, then take over.
    if (interrupt && this.currentLineIsQuestion) {
      this.flushAudio();
      if (this.speaking) {
        // Question still streaming from the server: mute its trailing burst frames
        // and let the outcome go out on turnComplete (brief silence until then).
        this.suppressQuestionAudio = true;
        this.pendingLine = text;
        this.pendingIsQuestion = isQuestion;
        return;
      }
      this.sendLine(text, isQuestion);
      return;
    }

    // Already speaking a non-question line → stash the newest; it goes out on
    // turnComplete (newest wins, single slot).
    if (this.speaking) {
      this.pendingLine = text;
      this.pendingIsQuestion = isQuestion;
      return;
    }

    this.sendLine(text, isQuestion);
  }

  /** Flush buffered TTS playback and silence the shared orb's scheduled envelope. */
  private flushAudio(): void {
    try {
      this.dynamicAudioOutput?.interruptAudioOutput?.();
    } catch (e) {}
    (global as any).agentSphere?.interruptAudio?.();
  }

  private sendLine(text: string, isQuestion: boolean): void {
    this.speaking = true;
    this.currentLineIsQuestion = isQuestion;
    this.suppressQuestionAudio = false;
    this.pendingLine = null;
    this.pendingIsQuestion = false;
    // Wrap the line in an explicit imperative with a `SAY:` marker. A bare user
    // turn reads as "the player said this — reply to it", which made the Live
    // model chat back ("that's fair… what's on your mind?"). The marker (which the
    // system instruction tells it to strip and never voice) reframes the turn as a
    // command to perform, not a remark to answer.
    const turn: GeminiTypes.Live.ClientContent = {
      client_content: {
        turns: [{ role: "user", parts: [{ text: `SAY: ${text}` }] }],
        turn_complete: true,
      },
    };
    this.liveSession.send(turn);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Live session
  // ───────────────────────────────────────────────────────────────────────────

  /** Open the Gemini Live session once (idempotent). */
  private ensureConnected(): void {
    if (this.sessionReady || this.connecting) return;
    if (!this.dynamicAudioOutput) {
      this.logger.error("dynamicAudioOutput not assigned — assign a (separate) DynamicAudioOutput.");
      return;
    }
    this.connecting = true;
    // Gemini Live streams audio back at 24 kHz.
    this.dynamicAudioOutput.initialize(24000);
    this.connect();
  }

  private connect(): void {
    this.liveSession = Gemini.liveConnect();

    this.liveSession.onOpen.add(() => {
      this.logger.info("Gemini Live connection opened — sending setup");

      const generationConfig: GeminiTypes.Common.GenerationConfig = {
        responseModalities: ["AUDIO"],
        // Temperature 0: we want faithful, verbatim reading of the exact line,
        // not improvisation. Any heat let the model chat back instead of read.
        temperature: 0,
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: this.voice },
          },
        },
      };

      const setupMessage: GeminiTypes.Live.Setup = {
        setup: {
          model: `models/${this.model}`,
          generation_config: generationConfig,
          system_instruction: {
            parts: [{ text: `${this.persona}\n\n${this.DELIVERY_RULE}` }],
          },
          output_audio_transcription: {},
        },
      };
      this.liveSession.send(setupMessage);
    });

    this.liveSession.onMessage.add((message) => {
      // Log non-audio server messages (audio frames are skipped to avoid flooding).
      const firstPart = message?.serverContent?.modelTurn?.parts?.[0];
      const isAudioFrame = firstPart?.inlineData?.mimeType?.startsWith("audio/pcm");
      if (!isAudioFrame) {
        this.logger.info("Server msg: " + JSON.stringify(message));
      }

      if (message?.setupComplete) {
        this.connecting = false;
        this.sessionReady = true;
        this.logger.success("Gemini Live ready");
        // Flush a line that was requested before setup finished.
        if (this.pendingLine && !this.speaking) {
          this.sendLine(this.pendingLine, this.pendingIsQuestion);
        }
        return;
      }

      // Stream spoken audio out as it arrives, keeping the orb/ring in sync.
      const part = message?.serverContent?.modelTurn?.parts?.[0];
      if (part?.inlineData?.mimeType?.startsWith("audio/pcm")) {
        // Drop the trailing burst frames of a question read we've already cut.
        if (this.currentLineIsQuestion && this.suppressQuestionAudio) return;
        const audio = Base64.decode(part.inlineData.data);
        this.dynamicAudioOutput.addAudioFrame(audio);
        (global as any).agentSphere?.noteAudioFrame?.(
          pcm16Rms(audio, 2),
          pcm16DurationSec(audio, 24000)
        );
      } else if (message?.serverContent?.outputTranscription?.text) {
        this.logger.info("Spoke: " + message.serverContent.outputTranscription.text);
        (global as any).agentSubtitle?.pushText?.(message.serverContent.outputTranscription.text);
      }

      // Turn finished — speak the queued line (if any), else go idle.
      if (message?.serverContent?.turnComplete) {
        this.speaking = false;
        this.suppressQuestionAudio = false;
        // NOTE: currentLineIsQuestion is intentionally NOT cleared here. The
        // question's audio keeps playing from the buffer after the server turn
        // completes, so stopQuestionRead() / the outcome-interrupt must still see
        // that a question read owns the output. It's overwritten by the next
        // sendLine() (a non-question line sets it false).
        if (this.pendingLine) {
          const next = this.pendingLine;
          const nextIsQuestion = this.pendingIsQuestion;
          this.pendingLine = null;
          this.pendingIsQuestion = false;
          this.sendLine(next, nextIsQuestion);
        }
      }
    });

    this.liveSession.onError.add((event) => {
      this.logger.error("Gemini Live error: " + JSON.stringify(event));
    });

    this.liveSession.onClose.add((event) => {
      this.connecting = false;
      this.sessionReady = false;
      this.speaking = false;
      this.currentLineIsQuestion = false;
      this.suppressQuestionAudio = false;
      this.logger.warn("Gemini Live closed: " + JSON.stringify(event));
    });
  }

  private disconnect(): void {
    if (this.liveSession) {
      try {
        this.liveSession.close();
      } catch (e) {
        this.logger.warn("Session close failed: " + e);
      }
    }
    this.connecting = false;
    this.sessionReady = false;
  }
}
