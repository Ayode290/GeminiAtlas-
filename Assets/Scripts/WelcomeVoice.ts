/**
 * Specs Inc. 2026
 * WelcomeVoice / Agent voice foundation.
 *
 * Connects to the Gemini Live API through the Remote Service Gateway (so NO
 * Internet Access capability and NO on-device key are needed) and speaks with a
 * chosen voice (default "Leda"). 5 seconds after launch it speaks the welcome
 * line as the agent's first utterance. The public speak(text) method is the
 * reusable hook for every later agent line.
 *
 * Audio is streamed back as PCM (24 kHz) and played through the shared
 * DynamicAudioOutput helper that ships in the RemoteServiceGateway package
 * (it lives on the RemoteServiceGatewayExamples "DynamicAudioOutput" object).
 *
 * NOTE: Gemini Live runs over a WebSocket on the gateway — it does NOT work in
 * the Lens Studio simulator. Test on device (or Preview with Device Type
 * Override = Spectacles) and make sure the glasses are online.
 */
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";
import { Gemini } from "RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAI";
import { GeminiTypes } from "RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAITypes";
import { DynamicAudioOutput } from "RemoteServiceGateway.lspkg/Helpers/DynamicAudioOutput";

@component
export class WelcomeVoice extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Agent Voice (Gemini Live)</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Speaks via Gemini Live through the Remote Service Gateway. Says the welcome line a few seconds after launch; speak(text) drives later agent lines. Does NOT run in the simulator — test on device with internet.</span>')
  @ui.separator

  @ui.group_start("Setup (drag from the RemoteServiceGatewayExamples prefab)")
  @input
  @hint("The 'Websocket requirements' SceneObject from the RemoteServiceGatewayExamples prefab. Enabled on launch so the gateway WebSocket can connect.")
  private websocketRequirementsObj: SceneObject;

  @input
  @hint("The 'DynamicAudioOutput' object from the RemoteServiceGatewayExamples prefab (it carries the AudioComponent + audio-output track that plays the voice).")
  private dynamicAudioOutput: DynamicAudioOutput;
  @ui.group_end

  @ui.separator
  @ui.group_start("Speech")
  @input
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem("Leda", "Leda"),
      new ComboBoxItem("Puck", "Puck"),
      new ComboBoxItem("Charon", "Charon"),
      new ComboBoxItem("Kore", "Kore"),
      new ComboBoxItem("Fenrir", "Fenrir"),
      new ComboBoxItem("Aoede", "Aoede"),
      new ComboBoxItem("Orus", "Orus"),
      new ComboBoxItem("Zephyr", "Zephyr"),
    ])
  )
  private voice: string = "Leda";

  @input
  @widget(new TextAreaWidget())
  @hint("Exact line spoken a few seconds after launch")
  private messageText: string =
    "Welcome back! I found some new places to visit for you -- hope you find some interesting cards there!";

  @input
  @hint("Seconds after launch before the welcome line")
  private delaySeconds: number = 5;

  @input
  @widget(new TextAreaWidget())
  @hint("System instruction. The verbatim-narrator prompt makes Gemini read lines exactly instead of chatting back.")
  private instructions: string =
    "You are a text-to-speech voice, not a conversational assistant. Speak the user's message aloud exactly as written -- word for word -- with no additions, omissions, replies, greetings, or commentary. Never react or respond to the content; only read it aloud, in a warm and friendly tone.";

  @input
  @hint("Gemini Live model id (no 'models/' prefix — it's added automatically). Supported: gemini-live-2.5-flash, gemini-2.0-flash-live-preview-04-09, gemini-live-2.5-flash-preview-native-audio")
  private model: string = "gemini-live-2.5-flash";
  @ui.group_end

  @ui.separator
  @ui.group_start("Logging")
  @input private enableLogging: boolean = true;
  @ui.group_end

  private logger: Logger;
  private liveSession: ReturnType<typeof Gemini.liveConnect>;
  private sessionReady = false;
  private pendingText: string | null = null;

  onAwake(): void {
    this.logger = new Logger("WelcomeVoice", this.enableLogging, true);

    if (this.websocketRequirementsObj) {
      this.websocketRequirementsObj.enabled = true;
    } else {
      this.logger.error("websocketRequirementsObj not assigned — gateway WebSocket may fail.");
    }

    this.createEvent("OnStartEvent").bind(() => this.onStart());
  }

  private onStart(): void {
    if (!this.dynamicAudioOutput) {
      this.logger.error("dynamicAudioOutput not assigned — assign the prefab's DynamicAudioOutput.");
      return;
    }

    // Gemini Live streams audio back at 24 kHz.
    this.dynamicAudioOutput.initialize(24000);
    this.connect();

    // Fire the welcome line at the chosen delay. If the session isn't ready yet
    // (it usually is within ~1s), speak() queues it and sends on setupComplete.
    const delay = Math.max(0, this.delaySeconds);
    this.logger.info(`Welcome line scheduled in ${delay}s`);
    const delayed = this.createEvent("DelayedCallbackEvent");
    delayed.bind(() => this.speak(this.messageText));
    delayed.reset(delay);
  }

  /** Connect to Gemini Live and configure audio output with the chosen voice. */
  private connect(): void {
    this.liveSession = Gemini.liveConnect();

    this.liveSession.onOpen.add(() => {
      this.logger.info("Gemini Live connection opened — sending setup");

      const generationConfig: GeminiTypes.Common.GenerationConfig = {
        responseModalities: ["AUDIO"],
        temperature: 1,
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
            parts: [{ text: this.instructions }],
          },
          output_audio_transcription: {},
        },
      };
      this.liveSession.send(setupMessage);
    });

    this.liveSession.onMessage.add((message) => {
      // Log non-audio server messages so errors/status are visible (audio
      // frames are skipped to avoid flooding the console).
      const firstPart = message?.serverContent?.modelTurn?.parts?.[0];
      const isAudioFrame = firstPart?.inlineData?.mimeType?.startsWith("audio/pcm");
      if (!isAudioFrame) {
        this.logger.info("Server msg: " + JSON.stringify(message));
      }

      if (message?.setupComplete) {
        this.sessionReady = true;
        this.logger.success("Gemini Live ready");
        if (this.pendingText !== null) {
          const queued = this.pendingText;
          this.pendingText = null;
          this.sendTurn(queued);
        }
        return;
      }

      // Stream spoken audio out as it arrives.
      const part = message?.serverContent?.modelTurn?.parts?.[0];
      if (part?.inlineData?.mimeType?.startsWith("audio/pcm")) {
        const audio = Base64.decode(part.inlineData.data);
        this.dynamicAudioOutput.addAudioFrame(audio);
      } else if (message?.serverContent?.outputTranscription?.text) {
        this.logger.info("Spoke: " + message.serverContent.outputTranscription.text);
      }
    });

    this.liveSession.onError.add((event) => {
      this.logger.error("Gemini Live error: " + JSON.stringify(event));
    });

    this.liveSession.onClose.add((event) => {
      this.sessionReady = false;
      this.logger.warn("Gemini Live closed: " + JSON.stringify(event));
    });
  }

  /**
   * Speak a line. If the live session isn't ready yet, the line is queued and
   * sent as soon as setup completes. This is the reusable agent hook.
   */
  speak(text: string): void {
    if (!text || text.trim().length === 0) return;
    if (!this.sessionReady) {
      this.pendingText = text;
      return;
    }
    this.sendTurn(text);
  }

  private sendTurn(text: string): void {
    this.logger.info("Speaking: " + text);
    // Gemini Live is conversational, so sending a bare line makes it *reply* to
    // the line. Wrapping it as an explicit "read this aloud" directive makes it
    // voice the line instead of answering it.
    const directive =
      "Read the following line aloud to the user, word for word and warmly, then stop. " +
      "Do not reply to it, answer it, ask a question, or add any words of your own. " +
      "The line to read is:\n\n" +
      text;
    const turn: GeminiTypes.Live.ClientContent = {
      client_content: {
        turns: [{ role: "user", parts: [{ text: directive }] }],
        turn_complete: true,
      },
    };
    this.liveSession.send(turn);
  }
}
