/**
 * Specs Inc. 2026
 * Audio level helper for the voice agent visuals.
 *
 * Computes a cheap loudness estimate (RMS, 0..~1) from a raw PCM16 frame — the
 * exact buffer the voice scripts already hold right after Base64.decode, before
 * it is handed to DynamicAudioOutput. One multiply-add per (sub)sample, so it is
 * effectively free even at 24 kHz: the result drives the AgentSphere/AgentRing
 * amplitude reaction without any FFT or extra audio plumbing.
 */

/**
 * Root-mean-square amplitude of a little-endian PCM16 buffer, normalized to
 * roughly [0, 1] (1.0 ≈ full-scale square wave; typical speech peaks ~0.2–0.5).
 *
 * @param bytes  Interleaved/mono PCM16 audio (2 bytes per sample).
 * @param stride Sample stride for subsampling (1 = every sample, 2 = every
 *               other, …). >1 trades a little accuracy for less work; the
 *               envelope smoothing downstream hides the coarser estimate.
 */
export function pcm16Rms(bytes: Uint8Array, stride: number = 1): number {
  const totalSamples = bytes.length >> 1; // 2 bytes per PCM16 sample
  if (totalSamples <= 0) return 0;
  const step = Math.max(1, stride | 0);

  let sumSq = 0;
  let count = 0;
  for (let i = 0; i < totalSamples; i += step) {
    const lo = bytes[i * 2];
    const hi = bytes[i * 2 + 1];
    // Reassemble the 16-bit sample and sign-extend (<<16 >>16) to [-32768, 32767].
    const sample = (((lo | (hi << 8)) << 16) >> 16) / 32768;
    sumSq += sample * sample;
    count++;
  }
  if (count === 0) return 0;
  return Math.sqrt(sumSq / count);
}

/**
 * Playback duration (seconds) of a PCM16 buffer. Gemini streams a whole
 * utterance's frames in a burst that plays out over the following seconds, so
 * the visual must be scheduled by each frame's DURATION (not its arrival time)
 * to stay in sync with what's actually audible.
 *
 * @param bytes      PCM16 audio (2 bytes per sample per channel).
 * @param sampleRate Output sample rate in Hz (Gemini Live: 24000).
 * @param channels   Channel count (default 1, matching DynamicAudioOutput).
 */
export function pcm16DurationSec(
  bytes: Uint8Array,
  sampleRate: number,
  channels: number = 1
): number {
  const ch = Math.max(1, channels | 0);
  const frames = (bytes.length >> 1) / ch; // samples per channel
  return sampleRate > 0 ? frames / sampleRate : 0;
}
