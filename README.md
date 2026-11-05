# PuppetControl

**Open-source, agent-first 2D character animation. Experimental but runnable.**

PuppetControl builds videos using reusable deformable characters rather than generating every animation frame with AI. It combines continuous rig-driven motion, eventually AI-generated pose families, and an agent-editable timeline. Claude Code or Codex can modify JSON scenes, validate capabilities, render previews, and inspect frames.

The long-term goal: **generate artwork when necessary, animate and reuse it indefinitely.**

## Current verified capability

- Versioned JSON scene and character schemas with strict validation.
- Explicit transition policy: compatible interpolation, authored bridge, deliberate cut, or failure.
- Frame-accurate multi-pose timeline planner (previewable JSON plan; distinct rigs do not render yet).
- Parameterized head/gaze/expression timelines compiled to a Rev2D animation.
- Working local sample with blinking/idle/breathing from Rev2D.
- Real PNG frame sequence and H.264 MP4 export, with optional single-track AAC voiceover.
- Local Rhubarb speech alignment CLI and eased lip-sync viseme curves driving the mouth.
- Agent-readable CLI output, tests and CI.

**Not implemented yet:** imported artwork → automatic actor rig, automatic generation of new pose rigs, rendering across distinct pose families, automatic transcription/TTS and built-in Rhubarb download, captions, B-roll, multiple actors, camera compositor, 1080p output for the sample. The JSON pose manifest is *capability metadata* and should not be mistaken for a working posed art asset.

## Local quickstart (Node.js 22+, Git, FFmpeg)

~~~sh
npm ci
npm run rig:setup   # Downloads pinned Rev2D under ignored .cache/rev2d; installs its dependencies
npm run rig:status
npm run verify
npm run dev -- doctor
npm run demo:preview
npm run demo:render
~~~

The sample uses Rev2D's own **Hana** rig from the pinned MIT-licensed upstream checkout; no sample artwork is redistributed from this repository.

Run a custom scene through the CLI:

~~~sh
node dist/cli/index.js scene validate examples/scenes/hana-preview.json
node dist/cli/index.js scene plan examples/scenes/intro.json
node dist/cli/index.js scene render examples/scenes/hana-preview.json --out outputs/hana-custom.mp4
~~~

The demo creates outputs/hana-preview.mp4. outputs/ and .cache/ are ignored by Git. The example scene is 4 seconds at 512×640/15 fps, with a single default pose family, head/gaze changes, expressions, and procedural idle/blinking.

On npm versions that consume flags, use the compiled CLI directly when passing --out.

The renderer rejects unsupported pose switches and video effects instead of falsely claiming they work.

## Agent workflow

Read [AGENTS.md](AGENTS.md), the project skill at [.agents/skills/puppetcontrol/SKILL.md](.agents/skills/puppetcontrol/SKILL.md), and the [architecture](docs/TECHNICAL_CONCEPT.md). Then:

1. Run npm run rig:status and npm run dev -- doctor.
2. Inspect examples/characters/hana/character.json and its capabilities.
3. Change examples/scenes/hana-preview.json only within supported events.
4. Validate with npm run dev -- scene validate ... .
5. Preview, inspect generated frames, and export.

Our native animation backend for the spike is **Rev2D**, pinned by the setup helper. It is not yet an npm-published dependency and must be installed locally. The project never silently downloads a rig/model while rendering.

## Development roadmap

- [Technical concept and architecture](docs/TECHNICAL_CONCEPT.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Rig backend and known limitations](docs/RIG_BACKEND_EVALUATION.md)
- [Audio and lip-sync workflow](docs/AUDIO_WORKFLOW.md)
- [Architecture decision log](docs/DECISIONS.md)

Audio/lip-sync works with precomputed Rhubarb cues and a locally installed executable. Next is the shared-face and multi-pose transition pipeline, then optional image decomposition and AI-assisted pose generation.

## License

MIT for PuppetControl-authored code and documentation. Rev2D, third-party models, voice assets, art and FFmpeg builds each retain their own licenses. Verify these before packaging or redistribution.
