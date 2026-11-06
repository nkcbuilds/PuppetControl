# PuppetControl

**Open-source, agent-first 2D character animation. Experimental but runnable.**

PuppetControl builds videos using reusable deformable characters rather than generating every animation frame with AI. It combines continuous rig-driven motion, eventually AI-generated pose families, and an agent-editable timeline. Claude Code or Codex can modify JSON scenes, validate capabilities, render previews, and inspect frames.

The long-term goal: **generate artwork when necessary, animate and reuse it indefinitely.**

## Current verified capability

- Versioned JSON scene and character schemas with strict validation.
- Explicit transition policy: compatible interpolation, authored bridge, deliberate cut, or failure.
- Frame-accurate pose timeline: genuine same-rig interpolation for neutral→pointing, and deliberate cuts for incompatible crossed-arm artwork.
- Parameterized head/gaze/expression timelines compiled to a Rev2D animation.
- Working local sample with blinking/idle/breathing from Rev2D.
- Real PNG frame sequence and H.264 MP4 export, with optional single-track AAC voiceover. The video renderer composites transparent mesh-edge pixels against the chosen background (default `#f0eaf4`) to prevent black border artifacts.
- Optional aspect-safe 1920×1080 presentation output independent of native rig canvas size.
- Experimental camera events (wide/medium/close-up/punch-in) with frame-exact cut boundaries and FFmpeg zoompan.
- Reproducible vector-art demo with a shared head/face and independent ArmRaise / ElbowExtend controls for reversible two-joint pointing.
- Local Rhubarb speech alignment CLI and eased lip-sync viseme curves driving the mouth.
- Assisted single-PNG character onboarding through Rev2D landmarks, local rig build, review sheets, unapproved-by-default manifest, and starter scene.
- Agent-guided landmark proposals: source-hash-bound task, optional **tested** Codex image-based suggestion, isolated geometry validation, visual overlay and explicit review/acceptance that revokes old rig approval.
- Imported avatar asset provenance: source/spec/model/texture fingerprints checked by scene validation and render; untracked alternate imported pose models are refused. Force rebuild revokes approval before modifying art. Suspicious landmarks generate nonblocking geometry warnings.
- An opt-in `character approve <project> --reviewed` gate for visually inspected imported rigs; asset fingerprints and review sheets are checked before approval.
- `scene new` creates editable expression/look/dialogue scenes from an already approved rig without changing the character; voice requires genuine Rhubarb cues.
- Non-destructive MP4 export: output files are promoted only after successful FFmpeg encoding, with overwrite requiring explicit `--force`.
- Guarded **local drawn eye/mouth variant** request, status and import commands using Rev2D masks and sprites. Imported drawings revoke approval and require a fresh visual review; no image generation happens automatically.
- An optional **experimental** short-fade profile for imported half/closed eye drawings; avoids prolonged duplicate lash outlines at the cost of faster pose changes, revokes approval and regenerates review sheets.
- Local PNG pixel and ordered-frame QA (full frame or explicit region) reports RGB activity, unexpected transparency, candidate motion jumps and changed-control stalls; these metrics never auto-approve a rig.
- Agent-readable CLI output, tests and CI.

**Not implemented yet:** fully automatic landmark placement or reliable one-click rigging, AI-generated arbitrary new pose rigs, convincing smooth bridges between unrelated meshes (especially crossed arms), automatic transcription/TTS, captions, B-roll and multiple actors. The arm-raise gesture is genuinely animated, but its artwork is still prototype-quality. Other pose families may require edited hard cuts. The pose manifest is capability metadata; visual poses become usable only after their rig files are generated, validated and inspected.

## Local quickstart (Node.js 22+, Git, FFmpeg)

~~~sh
npm ci
npm run rig:setup   # Downloads pinned Rev2D under ignored .cache/rev2d; installs its dependencies
npm run rig:status
npm run verify
npm run dev -- doctor
npm run demo:preview
npm run demo:render
npm run demo:poses       # Generate three demo rigs from the pinned Hana source
npm run demo:multipose   # Export an experimental 3-pose video with hard cuts
npm run demo:1080p      # Fit native art inside a 1920x1080 widescreen MP4
npm run demo:directed   # Apply edited camera framing and gradual punch-in
npm run demo:gesture    # Generate two-joint gesture rig and export edited 1080p demo
npm run demo:gesture-cycle  # Render continuous raise/lower cycles without cuts
npm run demo:avatar    # Import a freshly rendered flat PNG and create an unapproved rig + review sheets
npm run demo:first-video   # Prepare an ignored, unapproved Hana fixture for review
# After actually reviewing the pinned Hana test fixture only:
# node scripts/demo-first-video.mjs --reviewed-sample
# For a built imported avatar, see docs/CHARACTER_IMPORT.md for drawn-variant request/import
# Compare captured PNG frames:
# node dist/cli/index.js character qa compare outputs/rest.png outputs/closed.png --region 175,220,170,75
# node dist/cli/index.js character qa sequence outputs/f00.png outputs/f01.png outputs/f02.png --control-values 1,0.5,0
~~~

The sample uses Rev2D's own **Hana** rig from the pinned MIT-licensed upstream checkout; generated character rig JSON is not checked into this repository. The derived example video is separately attributed and licensed under the original Rev2D terms.

[Watch the experimental multi-pose demo](docs/media/hana-multipose-demo.mp4) (silent, 512×640, hard-cut prototype).

[Watch the 1080p camera-directed demo](docs/media/hana-directed-1080p.mp4) (silent, deliberate camera reframes; unrelated body artwork still changes at cuts).

[Watch the 1080p arm-raise demo](docs/media/hana-gesture-1080p.mp4) (silent, 30 fps; pointing uses continuous shared-rig motion over 300ms; crossed arms still use a camera cut).

[Watch the reversible gesture demo](docs/media/hana-gesture-cycle.mp4) (5 seconds, silent 30 fps; the same arm moves between neutral and pointing four times with no cuts).

For the first reproducible **one-character video workflow**, see [First Video](docs/FIRST_VIDEO.md). With an already reviewed rig, run `character approve <project> --reviewed` for provenance-tracked imported characters, then `scene new <path> --character <character.json>`, `scene validate` and `scene render`. Create another scene with the same character path to reuse its rig, without regenerating artwork. To attach your own voice, use a real WAV and aligned Rhubarb cue JSON; no TTS is implied.

Run a custom scene through the CLI:

~~~sh
node dist/cli/index.js scene validate examples/scenes/hana-preview.json
node dist/cli/index.js scene plan examples/scenes/intro.json
node dist/cli/index.js scene render examples/scenes/hana-preview.json --out outputs/hana-custom.mp4
~~~

The demos create outputs/hana-preview.mp4, outputs/hana-multipose.mp4 and outputs/hana-multipose-1080p.mp4. outputs/ and .cache/ are ignored by Git. The example scene is 4 seconds at 512×640/15 fps, with a single default pose family, head/gaze changes, expressions, and procedural idle/blinking.

On npm versions that consume flags, use the compiled CLI directly when passing --out.

Scene `resolution` is the native rig canvas; optional `output` gives a fitted/padded presentation size and background color. Upscaling a 512×640 rig to 1080p does not add visual detail. The renderer interpolates a shared rig when both poses provide compatible parameter presets. It rejects cross-rig mesh interpolation and unavailable bridge clips instead of silently rendering broken transitions.

## Agent workflow

Read [AGENTS.md](AGENTS.md), the project skill at [.agents/skills/puppetcontrol/SKILL.md](.agents/skills/puppetcontrol/SKILL.md), and the [architecture](docs/TECHNICAL_CONCEPT.md). Then:

1. Run npm run rig:status and npm run dev -- doctor.
2. Inspect examples/characters/hana/character.json and its capabilities.
3. Change examples/scenes/hana-preview.json only within supported events.
4. Validate with npm run dev -- scene validate ... .
5. Preview, inspect generated frames, and export.

To start from a new illustration, run `node dist/cli/index.js character import art/portrait.png --out avatars/portrait --id portrait`. For automatic **suggestions**, run `node dist/cli/index.js character landmarks propose avatars/portrait --provider codex` with a logged-in Codex CLI (sends the artwork to the Codex service). Alternatively, run `character landmarks assist` for a Claude Code/Codex task. Inspect the resulting overlay, explicitly accept only after review, and rebuild. The generated actor remains unapproved pending visual QA. See the [Character import guide](docs/CHARACTER_IMPORT.md) and [agent landmark workflow](docs/LANDMARK_AGENT_WORKFLOW.md).

Our native animation backend for the spike is **Rev2D**, pinned by the setup helper. It is not yet an npm-published dependency and must be installed locally. The project never silently downloads a rig/model while rendering.

## Development roadmap

- [Technical concept and architecture](docs/TECHNICAL_CONCEPT.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Rig backend and known limitations](docs/RIG_BACKEND_EVALUATION.md)
- [Audio and lip-sync workflow](docs/AUDIO_WORKFLOW.md)
- [Experimental camera direction](docs/VIDEO_SHOTS.md)
- [Continuous arm gesture proof](docs/ANIMATED_GESTURE.md)
- [Assisted single-image import and QA](docs/CHARACTER_IMPORT.md)
- [Agent-guided landmark review and acceptance](docs/LANDMARK_AGENT_WORKFLOW.md)
- [Optional Codex vision inference: real-image results and limitations](docs/CODEX_VISION_LANDMARKS.md)
- [Deep quality and reliability audit with observed pixel measurements](docs/QUALITY_AUDIT.md)
- [Pixel-level visual QA (non-approval diagnostics)](docs/PIXEL_QA.md)
- [Architecture decision log](docs/DECISIONS.md)

Audio/lip-sync works with precomputed Rhubarb cues and a locally installed executable. The smooth pointing demo reuses the same face and deforms one rig continuously; crossed arms still need a more convincing bridge or intentional cut. Next: polish eyelid and mouth deformation by reusing Rev2D's reviewed drawn variants, expand automated image-quality probes and evaluate diverse source artwork. Do not confuse data validation with visual quality.

## License

MIT for PuppetControl-authored code and documentation. Rev2D, third-party models, voice assets, art and FFmpeg builds each retain their own licenses. Verify these before packaging or redistribution.
