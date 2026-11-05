# PuppetControl — Technical Concept & Implementation Specification

**Status:** initial engineering design (subject to evidence-based revisions)
**Date:** 2026-11-05
**Project type:** open-source, local-first, agent-operated animation toolkit
**Working name:** PuppetControl
**Primary language:** TypeScript
**First user interfaces:** CLI and project files, controlled by Claude Code/Codex
**Primary output:** editable project + rendered MP4

> Generate art only when necessary. Reuse characters, deformations, motion, and timing whenever possible.

## 1. Vision and intended experience

PuppetControl turns a user-provided illustration into a reusable expressive 2D actor and uses an AI coding agent to direct scenes. The main target is fluid, Live2D-like dialogue, commentary, explainer, educational, and storytime animation—not arbitrary high-action anime or photorealistic video.

A user should eventually be able to tell Codex or Claude Code:

> Use this character illustration and my voiceover. Create a 45-second animated explainer. Have the character start neutral, look confused, fold their arms, then point at the chart. Make expressions and head movements smooth. Export 1080p.

The agent discovers capabilities, uses existing rigs and assets, requests new pose artwork only when required, generates valid timelines, checks previews, repairs problems, and renders video. The user can later ask for precise edits without re-generating the whole video.

### Success is defined by the output—not by engine complexity

- Character features, colors, linework, clothing, and relative proportions remain consistent across scenes.
- Head, eye, mouth, breathing, and small gestures have continuous, appealing motion.
- Major pose changes never masquerade as physical motion using a visibly broken sprite switch.
- Voice timing and mouth movement are synchronized.
- The scene can be revised through normal files and short natural-language agent requests.
- Re-rendering with the same inputs and compatible pinned toolchain yields a reproducible visual timeline.
- A user is not required to learn a custom editor or operate an always-online service.

## 2. Product boundaries

### In scope for the first complete vertical slice

- One humanoid, waist-up character (front / slight 3/4 orientation).
- An existing layered or manually prepared source with a working rig.
- Parameterized head movement, blinking, gaze, breathing, facial expression, and lip sync.
- At least three body pose families: neutral, pointing, and arms crossed; a fourth variant is desirable.
- Constrained transitions: interpolation when compatible; authored bridge or cut when incompatible.
- Audio-first timing from provided WAV and later TTS.
- A text/JSON scene format, validation, 2D compositing, preview frames, and MP4 export.
- Agent workflow documentation with actionable errors and repeatable commands.
- Optional generation of new pose artwork and human/agent review of generated assets.

### Explicitly out of scope initially

- A replacement for Live2D's entire editor or file format.
- Universal 3D reconstruction; arbitrary 360-degree views.
- Automatic reliable animation of fighting, dancing, running, or complex contact.
- Training our own foundation image/video model.
- A new mesh engine, solver, or physics engine without demonstrated need.
- Browser SaaS, user accounts, billing, databases, distributed queues, or a full timeline GUI.
- Promises of flawless one-click rigging for arbitrary illustrations.

## 3. Core design: hybrid pose families

The actor has **one persistent identity** and multiple **pose families**. A pose family is a compatible set of artwork, layer placement, rigged controls, and motion ranges for a major posture (neutral, pointing, crossed arms, sitting). Continuous motion operates **inside** each family, while a transition resolver handles changes **between** families.

The head/face rig should be reused across body families when orientation, silhouette, and attachment constraints permit. If a change of view makes that impossible, a validated alternate head view is used; the actor identity stays the same.

There are three categories of movement:

| Movement | Example | Allowed execution |
| --- | --- | --- |
| Continuous within rig | head tilts, gaze, blinking, breathing, small arm motion | interpolated parameter curves |
| Compatible family transition | neutral to pointing with matching shoulders/anchors | short authored transition clip, matched endpoint pose |
| Incompatible family transition | arms down to folded, standing to sitting, front to side | special bridge art/clip OR intentional shot cut/occlusion |

**Never** assume a plain alpha crossfade is physically convincing. It can create double limbs and ghosting. Never directly tween vertices between unrelated mesh topologies.

A transition plan may only choose an implementation supported by the active rig. If no compatible bridge exists, produce a clear warning and choose a safe camera cut/scene boundary, not an unreviewed fake blend.

### Pose family manifest (conceptual)

Each family records: ID; source assets; rig reference; supported controls/motions; head attachment transform; local scale/anchors; entry/exit neutral states; supported transitions; consistency/QA status; asset provenance. Actor names and expression IDs remain shared; raw vertex indices do not have to match between families.

## 4. Three runtime building blocks

1. **Character preparation:** normalize art, optionally decompose layers, import or construct a rig, generate additional poses on demand, validate every asset.
2. **Performance timeline:** audio-aligned semantic track for emotion, head/gaze, pose, gesture, camera, captions, and sound; generated/edited by agents.
3. **Renderer/compositor:** evaluate rig at specific timestamps, composite layers/background/camera/captions, encode the video with FFmpeg.

These are logical modules inside **one TypeScript repo**, not separate network services. External image/segmentation models are optional adapters invoked in isolated processes, never hard runtime dependencies.

## 5. Character preparation: simple first, extensible later

### Path A: already layered art (preferred for quality)

Import PSD/individual transparent layers. Establish face, hair, torso, arms and occlusion order. Set rig landmarks and deformation limits. Validate face sweeps and arm poses, then save as a reusable actor.

### Path B: single flat reference illustration

1. Validate dimensions, orientation, file format, alpha, permissions.
2. Identify canonical character appearance (palette, face, hair, costume, accessories, outline).
3. Use a segmentation/decomposition adapter (for anime art, evaluate See-through; others may use Qwen-Image-Layered or manual preparation).
4. Reconstruct occluded regions as required; preserve provenance of every generated region.
5. Obtain rig layers and landmarks, using an existing rigging engine if viable.
6. Render parameter sweeps and a QA contact sheet. Reject severe clipping, missing layers, inverted controls.
7. Save the validated base rig and asset references.

**The compiler is allowed to fail honestly** and ask for correction rather than producing an unusable actor marked as success.

### On-demand pose extension

When a scene needs a posture not in the library:

1. Generate a new pose from frozen reference character/art style, with a controlled prompt and consistent canvas.
2. Compare identity, colors, clothing, silhouette, face, and accessories to the canonical reference. Use automated scoring as **triage**, not proof of identity.
3. Prefer reusing the shared head and facial assets instead of regenerating a whole different face.
4. Decompose/rig the *body* pose and align anchors; retain an explicit transform to the shared head.
5. Render a pose sweep, mouth/blink contact sheet, and transition probes.
6. Add pose family only after QA passes; cache artifact with model/seed/prompt/version hashes.
7. Never regenerate an already-accepted family during ordinary video renders.

For v0.1 new pose generation may involve explicit approval/review; avoid claims of arbitrary fully automatic topology-changing animation.

## 6. Animation backend and adoption gate

**Initial evaluation candidate: Rev2D**, because it advertises a machine-readable rig, TypeScript-centric workflow, renderer/CLI, validation, and agent-oriented tools. Its capabilities and actual image quality must be verified against a real sample before committing to it.

Alternatives to evaluate only if evidence warrants: Inochi2D's existing character tooling or Stretchy Studio for authoring. We will not clone or replace an existing rigging engine as our opening task.

Adoption checklist:

- Can load/render a properly licensed sample rig locally, without requiring a cloud account?
- Can set named facial/head/body parameters deterministically at timestamps?
- Can render representative frames or a batch of frames with alpha to files?
- Can be used programmatically from TypeScript or a stable CLI?
- Can implement or approximate a shared face rig across compatible body families?
- Are render speed and deformation quality acceptable at 1080p/30?
- Are all required runtime dependencies and redistribution rights compatible with an open-source app?

If not, record specific failing tests and select the smallest alternative. Preserve only a minimal backend adapter where necessary; avoid premature multi-engine abstraction.

## 7. Performance controls and layering

Prefer high-level named controls such as: headYaw, headPitch, headRoll, bodyLean, eyeLookX/Y, blinkLeft/Right, brow, smile, mouthOpen, mouthShape, and gesture intensity.

Composite control sources in a defined order:

1. Rig rest state and pose-family base.
2. Motion clip and head/body parameter curves.
3. Semantic expression (brows, cheeks, smile/frown, eyes).
4. Gaze and blink.
5. Speech viseme/mouth aperture (owns speech-critical mouth channels).
6. Small procedural idle motion/secondary physics where available.

Expression must remain visible during speech: an angry open mouth should not become neutral merely because a viseme is active. Clamp/normalize parameters to safe ranges; choose sensible interpolation (cubic/ease) and explicitly authored enter/exit times.

Procedural idle/blinking must use deterministic seeded schedules, not ambient random calls during render. Speech pauses can trigger gaze shifts or restrained nods; not every sentence needs an exaggerated gesture.

## 8. Audio and lip sync

Audio leads timing. Use provided WAV/MP3 or synthesised speech (TTS provider optional). For an uploaded recording:

- Convert to canonical PCM and track sample rate/duration.
- Generate or accept transcript; align words/phonemes if available.
- Use Rhubarb Lip Sync as a first practical audio-to-mouth-cue adapter.
- Convert cues to canonical viseme/aperture events.
- Apply anticipatory smoothing and ensure closed-mouth states on silence when appropriate.
- Audio waveform and mouth cues are referenced by the scene, not embedded as base64.

Agent should choose emotional intent and gestures; the alignment tool should decide mouth cues. Keep lip-sync frame-rate independent: evaluation by time in milliseconds/microseconds, not accumulating floating-point frame positions.

Failure behavior: if alignment fails, preserve audio, report warning, and either use conservative open/close amplitude fallback or block final output at quality gate—never pretend alignment succeeded.

## 9. Scene and timeline contract

Scene documents should be text-editable and strict, ideally JSON + Zod. Use milliseconds as integer timestamps in the user-facing contract and exact frame sampling during output.

**Illustrative API (subject to implementation validation):**

~~~json
{
  "schemaVersion": 1,
  "id": "intro",
  "durationMs": 8000,
  "fps": 30,
  "resolution": { "width": 1920, "height": 1080 },
  "actors": [{ "id": "maya", "characterPath": "./characters/maya" }],
  "audio": [{ "path": "./audio/intro.wav", "startMs": 0 }],
  "events": [
    { "atMs": 0, "actor": "maya", "kind": "pose", "name": "neutral" },
    { "atMs": 1200, "actor": "maya", "kind": "expression", "name": "confused", "intensity": 0.6 },
    { "atMs": 2600, "actor": "maya", "kind": "pose", "name": "arms-crossed", "transition": "auto" },
    { "atMs": 4300, "kind": "camera", "name": "punch-in", "amount": 0.08 }
  ]
}
~~~

The event vocabulary in v0.1: pose, motion/gesture, expression, look, camera, caption. Lip-sync generated in a separate derived track linked to the audio. Every event is validated against the actor's current capability manifest before rendering.

**Do not make agents hand-author raw bone rotations or mesh vertices.** Code translates semantic events into safe controls. Agent instructions should include capability manifests and transition inventory to prevent hallucinated actions.

## 10. Minimal transition resolver contract

Input: previous family, target family, rig capabilities, timing window, camera context.

Output: one of:
- SAME_RIG_INTERPOLATION
- COMPATIBLE_BRIDGE_CLIP
- GENERATED_BRIDGE_PENDING_REVIEW
- HIDDEN_CUT
- UNSUPPORTED with actionable error

Rules:
- Use same-rig interpolation only if a valid shared rig/control domain exists.
- Use a bridge only if endpoint anchors and visual quality pass.
- Generated intermediate art must be treated as generated assets and QA reviewed.
- A hidden cut requires actual shot/occlusion context; do not invent one silently inside a single locked shot.
- No transition should offset the head position/scale unexpectedly.
- Mouth and face timing continue through a transition if the face remains visible.
- A pose is not available merely because the source image file exists; it needs a validated rig/capability entry.

## 11. Rendering

Start with rig-backend-rendered image frames + simple 2D compositor + FFmpeg.

Frame evaluation at frame number n uses t = n / fps (derived from integer rational timestamps). For each frame:
1. Resolve active scene shot and pose family.
2. Sample continuous curves for head, body, face, gaze, mouth and gestures.
3. Apply motion/transition policy and procedural idle controls.
4. Render character(s) at requested resolution with alpha.
5. Composite backgrounds, camera transforms and overlay captions.
6. Encode frames and synchronized audio using FFmpeg.

A pinned environment and seeded dynamics are required for reproducible timeline behavior. Bit-identical MP4 bytes are **not** required across codecs/GPUs; the acceptance test compares visual frames and audio timing within tolerances.

Export initial goals: 1080p, 30 fps, H.264 MP4, AAC audio; 720p/low FPS preview; contact sheets and short preview clips for agents. Avoid full exports during normal iteration.

## 12. Agent-first local experience

The project must run without opening a specialized visual editor. Ship:
- one CLI (working name: puppetctl);
- short root AGENTS.md and matching Claude instructions;
- a project-local skill/workflow guide;
- human-readable JSON diagnostics with stable error codes;
- deterministic, inspectable example scenes;
- a preview/contact sheet command for visual QA;
- no cloud API required for consuming existing rigged actors.

**Target workflow, not assumed implemented CLI yet:**

~~~sh
puppetctl doctor
puppetctl character inspect characters/maya --json
puppetctl scene validate projects/intro/scene.json --json
puppetctl scene preview projects/intro/scene.json --out previews/intro
puppetctl scene render projects/intro/scene.json --out outputs/intro.mp4
~~~

Advanced commands when compiler arrives: character prepare, add-pose, pose validate, pose repair.

An agent should first inspect available capabilities, author a scene only with supported actions, validate, preview, visually inspect snapshots, correct issues, and export. Never overwrite original user artwork. Never claim a preview was inspected without opening the frames.

## 13. Proposed repo layout (keep it small)

~~~text
PuppetControl/
  docs/
    TECHNICAL_CONCEPT.md
    IMPLEMENTATION_PLAN.md
    DECISIONS.md
  src/
    cli/
    scene/
    character/
    animation/
    audio/
    render/
  examples/
    scenes/
    characters/
  tests/
  .github/workflows/
  AGENTS.md
  README.md
  package.json
~~~

Initial code need not fill all directories. Add a module only when a tested feature needs it.

## 14. Interfaces to implement first

- Scene schema parser/validator with version and structured error paths.
- Character capability manifest parser (supported pose families, expressions, gestures, and transitions).
- Transition planning: pure function with explicit output/warnings and deterministic behavior.
- Timeline evaluation (get state at timestamp, event ordering, easing).
- Renderer adapter (only when selected engine passes spike).
- Audio cue adapter (to be introduced after first moving rig).
- CLI exposing doctor, scene validation, preview and render as functionality becomes real.

Return machine-readable outputs with success/error status. Commands must never claim unsupported functions exist merely because their names appear in docs.

## 15. Engineering milestones and dependencies

### M0 — Repo and design, first public commit
- Technical concept, decision log, build tasks, AGENTS.md, README and license.
- Verify GitHub repo and CI/test baseline.
- Define a minimal runnable path and open decisions.
- Exit criterion: documents reviewed; repository initialized; GitHub remote pushed.

### M1 — Rig rendering spike
- Select licensed sample or create simple layers.
- Test Rev2D installation, parameter updates, batch frames, headless output.
- Record quality/performance and integration compatibility; fix or choose fallback.
- Exit: sample produces visibly fluid head + eye motion and reproducible frame previews.

### M2 — Agent-controlled timeline
- Strict scene schema, character capabilities, deterministic semantic event evaluator.
- Minimal CLI, example scene, tests, validation diagnostics.
- Connect to rig backend and generate short silent video.
- Exit: agent can modify text scene and produce changed visual preview.

### M3 — Audio performance
- WAV preparation, optional TTS, lip cue extraction, mouth blending.
- Automated face expressions, eyes/blink, audio-composited MP4.
- Exit: 15–30-second voiced performance with acceptable mouth sync.

### M4 — Multiple pose families / smooth transitions
- At least three body postures, shared head attachment or controlled alternate view.
- Transition resolver and explicit bridge/cut fallback.
- Quality gates for transition continuity.
- Exit: 45-second voiced scene shows multiple poses without unintended popping/ghosting.

### M5 — Assisted pose generation
- Reference conditioning, model adapter(s), layer separation, attachment alignment, consistency QA, caching and repair.
- New pose only becomes active after passing checks.
- Exit: one new pose can be generated, reviewed, cached, and reused in a second project.

### M6 — Agent workflow polish and creator experience
- Compact Claude/Codex skill, simple install, demo media, docs, reproducible sample.
- Potential lightweight web preview after CLI has proved viable.
- Exit: a newcomer can follow documented commands to build a first scene with limited manual setup.

## 16. Quality gates and tests

Unit tests:
- Schema rejects invalid paths, unknown actions, negative/out-of-range times, invalid intensity.
- Capability validation rejects unsupported poses/expressions.
- Transition resolver never chooses interpolation for mismatched rig topology.
- Timeline event sort/order is stable; no accumulating drift.
- Blink schedules and curve sampling are deterministic.

Integration tests:
- A sample rig renders at 0, 0.25, 0.5, 1 seconds with distinct expected appearance.
- Lip cues align with audio (check timing near utterance starts, ends, and silence).
- Camera cuts do not displace shared-head anchors unexpectedly.
- Encoded video has expected dimensions/FPS/duration and an audio track.

Visual regression:
- Contact sheets for neutral, smile, blink, O mouth, head tilt, each pose.
- Transition boundary frames, especially shoulders, hands, hair, neckline and head.
- Manually inspect 45-second target output on ordinary hardware.
- Bad generated pose must fail gracefully rather than corrupt an accepted actor.

### First demo acceptance target

- 45 seconds at 1920x1080/30 fps, one consistent character.
- At least four distinguishable pose families if feasible (three minimum).
- Continuous talking/blinking/gaze/head motion.
- Audio with convincing viseme synchrony.
- All incompatible pose changes receive authored bridge or intentional cut.
- Re-render after changing one expression without changing unrelated identity assets.
- No false success in CLI/README; actual MP4 exists and has been inspected.

## 17. Practical constraints and performance

Base render must be local-first. GPU-heavy decomposition/generation are optional jobs with cost and latency made explicit. Provide an offline path using pre-existing layered assets. Render speed is a benchmark, not an unverified promise. Targets: preview fast enough for iteration; final 1080p export at or near real-time on a typical discrete GPU **if the selected backend can achieve it**; record actual measurements.

One run must not require users to possess a powerful image-generation GPU just to animate a prepared character. Image models and compiler dependencies must be installable separately from the renderer.

## 18. Licensing and safety

Choose an OSI-approved permissive project license after dependency audit (Apache-2.0 recommended). Verify each third-party package, model weight, animation asset, font, binary and sample file independently; a permissive code license does not automatically license a model or artwork. Include notices for copied/adapted work. Do not distribute proprietary Live2D SDKs/assets without the appropriate terms.

Importers must treat archive contents/PSD/images/audio as untrusted: bound decode sizes, prevent path traversal and zip bombs, enforce timeouts/limits, avoid executing scripts embedded in imported data. Do not publish user art to GitHub without explicit inclusion.

Respect character/voice rights and consent for uploaded assets; provide provenance metadata for AI-generated poses. Logs should not contain API keys or personal data.

## 19. Agentic development and Git workflow

The user wants development carried out by agents, using the PC workspace, Git and a GitHub remote.

- One primary agent owns architecture, merges, releases and published commits.
- Additional agents may conduct read-only audits or work on non-overlapping modules.
- Every task begins with a bounded definition of done and tests.
- Follow workspace instructions and check git status before editing.
- Make small thematic commits; use explicit branches on push.
- Push after a verified milestone or coherent functional commit; never push known-broken tests as success.
- Keep the default branch reviewable and runnable.
- Do not pretend the project is complete after shipping only infrastructure.
- Document tool failures and decisions in DECISIONS.md, not in ad hoc hidden chat-only context.

Recommended PR policy later: default branch protected; feature branches and CI required. Initial bootstrap may use a direct commit/push to establish the repo.

## 20. Major open decisions

1. **Rig backend:** Rev2D feasibility in practice; evaluate alternative only on failing acceptance criteria.
2. **Pose representation:** how much body layer/mesh data can be reused across new poses? Prototype before standardizing.
3. **Shared head:** supported directly or via precomposition/camera anchors? Avoid invasive engine fork.
4. **Lip-sync:** Rhubarb cue shape mapping and supported languages; add forced alignment if needed.
5. **Generative pose provider:** local 8 GB GPU vs optional remote model. Use capability-based adapter, no required vendor.
6. **Transition quality:** when to author bridge animations vs visually hide change with cuts.
7. **Licensing:** review concrete dependency versions before redistribution.
8. **Render pipeline:** CLI frame export vs embedded renderer; measure rather than assume.

## 21. Foundational references (evaluate, do not blindly depend)

- Rev2D: https://github.com/RevStudio/Rev2D
- Stretchy Studio: https://github.com/MangoLion/stretchystudio
- Inochi Creator: https://github.com/Inochi2D/inochi-creator
- See-through: https://github.com/shitagaki-lab/see-through
- Qwen-Image-Layered: https://github.com/QwenLM/Qwen-Image-Layered
- Rhubarb Lip Sync: https://github.com/DanielSWolf/rhubarb-lip-sync
- FFmpeg: https://ffmpeg.org/

These are research/adapter candidates, not guaranteed endorsed dependencies. Exact versions, platforms and licenses must be pinned and tested in implementation.

## 22. Project acceptance statement

PuppetControl will be successful when a user can provide a character and a recorded/scripted performance, ask Claude Code or Codex to produce the scene, review the resulting video, and make selective changes with no character drift and without paying for a full AI video regeneration.

**Build the smallest pipeline that visibly achieves this. Expand complexity only when a failed test or clear visual limitation proves it is needed.**
