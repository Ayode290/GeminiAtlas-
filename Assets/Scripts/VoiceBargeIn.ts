/**
 * Specs Inc. 2026
 * VoiceBargeIn — shared barge-in (interruption) handling for the conversational
 * voice agents (CardVoiceAgent, CardQueryVoiceAgent).
 *
 * Gemini Live already does the hard part: with automatic voice-activity detection
 * on (the default), when the user starts talking while the model is speaking, the
 * server stops generating and sends `serverContent.interrupted = true`, truncating
 * the model turn in context to only what was actually spoken. The catch is that
 * Gemini bursts several SECONDS of audio frames up front into DynamicAudioOutput's
 * playback queue, so unless we explicitly flush that queue the device keeps playing
 * the agent's already-buffered voice over the user. The orb (AgentSphere) likewise
 * keeps pulsing because it has up to ~20s of scheduled amplitude envelope queued.
 *
 * handleBargeIn() is called from each agent's onMessage: on an interrupt it flushes
 * the buffered playback and silences the orb immediately. The session + mic stay
 * open, so the user's barge-in speech is already streaming to Gemini and it simply
 * answers it next — no extra wiring needed.
 *
 * BARGE_IN_INSTRUCTION is appended to each agent's system instruction so the model
 * knows to resume its prior thought after handling the new ask ("catch up").
 */
import { DynamicAudioOutput } from "RemoteServiceGateway.lspkg/Helpers/DynamicAudioOutput";

// Appended to every conversational agent's system instruction. The mechanical flush
// (handleBargeIn) makes the agent go quiet the instant the user speaks; this tells
// the model how to behave conversationally afterward — answer the new ask, then pick
// the prior thought back up if it still matters.
export const BARGE_IN_INSTRUCTION =
  " If the user starts speaking while you are talking, STOP immediately and listen — " +
  "never talk over them. Answer whatever they just asked first. If you were in the " +
  "middle of a thought or explanation when they cut in, finish answering them and " +
  "then briefly pick back up where you left off (e.g. \"Anyway, back to what I was " +
  "saying…\") — but only if it's still relevant; don't force it.";

/**
 * If `message` carries Gemini Live's interrupt signal, flush the agent's buffered
 * audio playback and silence the orb, then return true (the caller should `return`).
 * Returns false for any non-interrupt message so the caller keeps processing it.
 */
export function handleBargeIn(
  message: any,
  dynamicAudioOutput: DynamicAudioOutput
): boolean {
  if (!message?.serverContent?.interrupted) return false;
  // Drop the seconds of agent voice already queued for playback so we go quiet now.
  try {
    dynamicAudioOutput?.interruptAudioOutput?.();
  } catch (e) {}
  // Stop the orb "talking" immediately (it has its own ~20s scheduled envelope).
  (global as any).agentSphere?.interruptAudio?.();
  // Wipe the live caption too, so it doesn't keep typing a sentence we cut off.
  (global as any).agentSubtitle?.clear?.();
  return true;
}
