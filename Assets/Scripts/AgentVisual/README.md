# Agent Ring — amplitude-reactive animated circle

The voice agent's visual presence, reworked from a single pulsing orb into an
**animated circle** built from three additive, Perlin-distorted **hollow rings**
(cyan, magenta, yellow). Each ring is a filled band (annulus) — exactly like the
Bubbles system — whose outer and inner rims undulate independently. Stacked in
additive blend they sum to a **white ring**; as the agent speaks louder the three
layers' noise drifts apart and the **cyan/magenta/yellow fringes bloom** out of
the white core.

A pair of white **rectangle eyes** (4-point quads) sits in the hollow center,
with natural idle behavior — occasional **blinks** (a quick vertical squash) and
**darts** (small shared saccade offsets).

It reacts to real audio **amplitude** (RMS of each PCM frame), scheduled by
playback time so it stays alive for the whole utterance — and stays lightweight
(no FFT; one shared time + three ring rebuilds per frame, on the allocation-free
Bubbles hot path; the eye meshes are static — only their transforms animate).

---

## How the effect works

| State | Distortion | Undulate speed | Layer divergence | Reads as |
|---|---|---|---|---|
| **Quiet** (amp → 0) | small (`quietDistortion`) | slow (`quietSpeed`) | 0 — all layers share the same noise time | a clean, slowly-undulating **white ring** |
| **Loud** (amp → 1) | large (`loudDistortion`) | fast (`loudSpeed`) | high (`divergence`) — each layer's time drifts | wobbly core with **colored CMY fringes** |

Additive CMY math: `cyan + magenta + yellow = white`, and *any two* already sum
to white, so the bulk (where ≥2 layers overlap) stays white and only the
**single-coverage rim crescents** show a pure color. Black adds nothing — which
is also exactly how the Spectacles optical see-through display composites, so
additive is the natural choice here.

Every layer (and the eyes) renders **non-occludable**: the cloned material has
`depthWrite = false` (layers never hide each other) and `depthTest = false`, so
world/scene geometry never occludes the ring — it always draws on top of whatever
is behind it.

The divergence is driven entirely by amplitude (`amp^divergenceExponent *
divergence`), so when the agent is silent the layers collapse onto one shape and
the circle is white; the color only appears with the voice.

---

## Architecture

| File | Responsibility |
|---|---|
| [`AgentNoiseDisc.ts`](AgentNoiseDisc.ts) | Plain class for **one** ring layer: owns a `RenderMeshVisual` + a **cloned** material forced to additive blend + its own `PerlinNoise`. Reuses `getBubblePointsInto` **and** `BubbleMeshBuilder` (the hollow band/annulus) from `../Bubbles`, with two independently-undulating rims — identical to `BubbleMesh`. |
| [`AgentRing.ts`](AgentRing.ts) | `@component` manager: spawns the 3 CMY layers as children, billboards them to the camera, reads `global.agentSphere.getAudioLevel()` and maps amplitude → distortion / speed / divergence. |

The mesh is **not** forked: each layer reuses the Bubbles `BubbleMeshBuilder`
band (outer rim + inner rim at `radius*(1-innerFraction)`), so the ring is the
same hollow annulus a `BubbleMesh` draws.

### Data flow

```
voice scripts (Welcome/Nudge/CardVoiceAgent)
   pcm16Rms(frame), pcm16DurationSec(frame, 24000)
        └──►  global.agentSphere.noteAudioFrame(level, durationSec)
                     │  AgentSphere SCHEDULES frames by playback duration and
                     │  drains them in real time (attack/release smoothing), so
                     │  the envelope tracks audible playback, not frame arrival.
                     ▼
AgentRing.update()  ── getAudioLevel() ──►  amp (0..1)
   ├─ sharedTime += lerp(quietSpeed, loudSpeed, amp) * dt
   ├─ distortion  = lerp(quietDistortion, loudDistortion, amp)
   ├─ div         = amp^exp * divergence
   └─ for each layer i:  disc[i].render(sharedTime + seed[i]*div, distortion, noiseScale)
                              └─ getBubblePointsInto (outer + inner rim)
                                    → BubbleMeshBuilder.updateBand → RenderMeshVisual
```

### What changed outside this folder

- **`Assets/Scripts/AudioLevel.ts`** — new `pcm16Rms()` (cheap RMS of a PCM16
  frame) and `pcm16DurationSec()` (frame playback length).
- **`WelcomeVoice.ts`, `NudgeVoice.ts`, `CardVoiceAgent.ts`** — now pass
  `pcm16Rms(audio, 2)` **and** `pcm16DurationSec(audio, 24000)` into
  `agentSphere.noteAudioFrame(level, durationSec)` (Welcome newly calls it).
- **`AgentSphere.ts`** — `noteAudioFrame(level, durationSec)` now **schedules**
  frames and drains them by real time (the envelope follows playback, not the
  up-front burst of arriving frames); added `getAudioLevel()`. Its own scale
  pulse now scales with loudness instead of a fixed sine. **`Bubble Mat` was not
  touched** — every layer clones whatever base material you assign and overrides
  color/blend on the clone.

---

## Lens Studio setup (step by step)

### 1. Make sure the scripts compiled
Let Lens Studio import `Assets/Scripts/AudioLevel.ts` and the three files in
`Assets/Scripts/AgentVisual/`. Confirm no errors in the Logger panel.

### 2. (Recommended) Create an additive material
`AgentRing` will try to set each cloned layer to **Add** blend at runtime, but
giving it an already-additive base material is the safest path:

1. **Asset Browser → + → Material → Unlit.** Name it e.g. `AgentRingMat`.
2. In its Inspector set **Blend Mode = Add** and **Depth Write = off**, **Two
   Sided = on**.
3. Leave `Base Color` white (the script overwrites each layer's color on its
   clone). You can also just reuse the existing `Bubble Mat` — it will be cloned,
   not modified — but an Add-blend material avoids relying on the runtime
   blend-mode override.

### 3. Add the ring anchor under the agent orb
The existing `AgentSphere` script moves its **Sphere Obj** around the FOV. We
want the ring to inherit that position but face the camera on its own:

1. In the Scene Hierarchy, find the object assigned to `AgentSphere`'s **Sphere
   Obj** (the orb visual).
2. **Hide/disable that orb's mesh** (disable its `RenderMeshVisual`, or the
   object's visual) so only the ring shows.
3. Create an **empty SceneObject as a child** of that orb. Name it `AgentRing`.
   Keep its local position at `(0,0,0)`.

### 4. Add and wire the `AgentRing` component
On the `AgentRing` object: **Add Component → Script → AgentRing**, then set:

- **Base Material** → `AgentRingMat` (or `Bubble Mat`).
- **Camera Obj** → the scene's head **Camera Object** (same one used elsewhere).
- **Layer Colors** → leave cyan / magenta / yellow (defaults).
- **Color Intensity** → `0.7` (lower if the white core clips/blooms too hard).
- **Radius** → `3` cm (outer radius; tune to taste).
- **Inner Fraction** → `0.12` (ring band thickness as a fraction of the radius;
  smaller = thinner ring, `1` = solid disc — same meaning as in `BubbleMesh`).
- **Num Points** → `64` (drop to ~48 for cheaper, still-smooth rings).
- **Amplitude Response** → start with the defaults:
  - Quiet/Loud Distortion `1.5` / `7.0`
  - Quiet/Loud Speed `0.15` / `1.2`
  - Divergence `1.6`, Divergence Exponent `1.5`
- **Eyes** → leave **Show Eyes** on. Each eye is a white **4-point rectangle**.
  Defaults: **Eye Size** `0.4` (half-size; the rect spans ±this), **Eye Aspect**
  `1.0` (height-to-width ratio; >1 = taller), **Eye Distance** `1.6`, **Eye
  Height** `0.4`, **Eye Forward** `0.5` (cm popped toward the viewer, in front of
  the ring). Idle animation:
  **Blink Interval** `2.5–6`s over **Blink Duration** `0.12`s; **Dart Interval**
  `1.5–4.5`s, **Dart Hold** `0.4`s, **Dart Amount** `0.25`cm. The eyes are white
  solid discs that blink (vertical squash) and dart (small shared offsets).

### 5. Confirm the orb scale pulse isn't fighting the ring
`AgentSphere`'s **Speak Pulse** now scales with amplitude. Since the ring is a
child, that pulse gently breathes the whole circle's size — usually nice. If you
don't want any size change, set **Speak Pulse = 0** on `AgentSphere`.

### 6. Test on device (not the simulator)
Gemini Live runs over the gateway WebSocket and **does not work in the Lens
Studio simulator** — use Preview with a device, or run on Spectacles.

- **Silence:** a steady **white ring** that slowly undulates, facing you.
- **Agent speaking softly:** small wobble, mostly white.
- **Agent speaking loudly:** faster, larger wobble and **cyan/magenta/yellow
  fringes** blooming at the rim, settling back to white as it quietens.

### Tuning cheatsheet
- Want color to appear sooner → lower **Divergence Exponent** (toward 1) or raise
  **Divergence**.
- Too much color / never reads white → raise **Divergence Exponent** or lower
  **Divergence**.
- Wobble too tame/violent → adjust **Loud Distortion**.
- Reaction too jumpy/sluggish → tune the envelope constants (`LEVEL_GAIN`,
  `LEVEL_ATTACK`, `LEVEL_RELEASE`) at the top of `AgentSphere.ts`.
- **Animation races ahead of / lags the voice** → adjust **Audio Latency** on
  `AgentSphere` (default `0.2`s). Frames arrive a bit before they're audible (the
  player buffers first), so the schedule is held back by this much at the start of
  each utterance. Raise it if the visual still leads the sound; lower it if it now
  trails.
- **Eyes** → tune **Eye Size / Aspect / Distance / Height** for the face
  proportions (Aspect >1 makes taller eyes, <1 wider);
  **Blink/Dart Interval** for how lively the idle feels (lower = busier), **Dart
  Amount** for how far the eyes flick, and **Blink Duration** for blink speed.
  Turn **Show Eyes** off for a plain ring.

---

## Performance notes

- **Amplitude** is one multiply-add per (sub)sample of each PCM frame
  (`pcm16Rms`, subsampled with stride 2) — negligible, and the frame was already
  decoded.
- **Per frame:** advance one shared time, read one envelope float, rebuild three
  ring bands (two Perlin samples per rim point — outer + inner rim, intrinsic to
  the hollow annulus) + three `updateMesh()` calls. No per-frame allocation or
  trig (rim cos/sin precomputed once per layer, reused scratch buffers).
- **No FFT.** Frequency-band visuals were considered and intentionally skipped;
  amplitude alone drives the whole effect.
- Three draw calls (one per layer). Lower **Num Points** if you need to shave
  more.
