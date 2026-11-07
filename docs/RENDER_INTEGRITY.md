# Verified render inputs and filesystem boundaries

PuppetControl is a **local-first authoring CLI**. It processes user art and files supplied by agents. These safeguards address accidental source edits, ordinary file replacement between checks, and symlinked output destinations. They are **not a sandbox** against another process running with the same user permissions and deliberately modifying the private render snapshot during rendering.

## Imported-character rig integrity

After the normal imported-avatar SHA-256 build-record verification, `scene render` now copies the approved `source.png`, `avatar.json`, rig model and all recorded model textures into a fresh, ignored `verified-actor-assets/` directory under its unique frame-output root. Each copied file is SHA-256 checked against the existing build record. The Rev2D adapter reads the **copied** model and textures, never the original files during that render. If any bytes change before or during copying, the copy fails verification.

This closes the ordinary gap where a rig could be checked at scene-load time and replaced at its original path before Rev2D opened it. The imported test fixture must still be *genuinely* visually reviewed before user approval; an integrity record is not an aesthetic certification or an approval signature.

## Bound voice/cue integrity

`audio bind` now parses **the exact cue bytes** that it hashes. When a scene has `audio.bindingPath`, `scene render` verifies the sidecar, copies WAV and cue JSON into a fresh ignored `verified-speech/` directory, hashes both copied inputs against the binding and parses the **copied** cue JSON. Rhubarb tracks use those cues and FFmpeg receives the **copied audio path**.

This prevents ordinary source edits during an export from mixing new audio with an old cue file. Earlier scenes without an explicit binding remain supported and **do not** gain this protection.

## Render output and explicit roots

- Frame output must be **new**, rather than an existing directory that might contain old frames. A symlink/junction escape through its existing ancestors is rejected before rendering.
- The subprocess's list of frame names must match flat `frame_0000.png`-style names; a path-like name or traversal is rejected.
- `loadAndValidateScene(scene, { root })` now checks the scene, actors, and **all** audio, cue, and binding paths against the same realpath-aware root, returning diagnostics rather than throwing on escaped paths.
- The existing MP4 exporter still writes a unique temporary sibling MP4 and refuses overwrite without explicit `--force`.

## Reproduction and evidence (2026-11-07)

Run `npm run verify` to execute regression tests for copied asset integrity, path traversal, root-scoped loading, voice swaps, and guarded frame directories. For a locally installed pinned Rev2D backend and available FFmpeg, the actual video exports were separately exercised with two **ignored QA fixtures**:

- `.cache/render-snapshot-qa-20261107-1800/qa-snapshot.mp4`: 3 seconds, 15 FPS, 512×640, 45 H.264 frames, silent. **The test copy alone** has an explicit forced approval marker to exercise the renderer. The underlying imported artwork was not user-approved and its original manifest remains unapproved. Do not distribute or use the test marker in normal workflows.
- `.cache/first-video-demo/qa-12s-voiced/verified-snapshot-3s.mp4`: 3 seconds, 15 FPS, 512×640, 45 H.264 frames plus one AAC stream. The output refers to an actual ignored `verified-speech/voice.wav` rather than the source file.
- Representative real PNG frames visually inspected at 0, 1 and 2 seconds, contact sheet under `outputs/qa/verified-render-inputs/qa-frames.jpg`. Video codec/duration/stream checks passed, but this does **not** establish the quality of eyelid transitions or lip sync on other speakers.

## Limits and future review

Neither SHA-256 nor checked paths are a cryptographic trust boundary against **malicious concurrent same-user modification of the newly copied frame directory**. Node and FFmpeg do not hold immutable read-only file descriptors from validation through every subprocess read; a same-user attacker can intentionally mutate these writable render artifacts. For hostile multiuser execution, a separate OS sandbox with private immutable mounts, privileges and per-process filesystem isolation is needed. That is outside PuppetControl's present local developer scope.

Rig changes, repeated native speech samples, arbitrary-image eye deformation and cross-rig bridge animation still require independent perceptual QA. Keep stacked PRs in draft until reviewed.
