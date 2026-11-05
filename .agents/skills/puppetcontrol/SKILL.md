---
name: puppetcontrol
description: Agent workflow for directing reusable Rev2D actors and validating video output.
---

# PuppetControl scene creation

Read repo-root AGENTS.md and docs/TECHNICAL_CONCEPT.md before major changes.

1. Inspect CLI capabilities using npm run dev -- --help and npm run dev -- doctor.
2. Inspect actor's approved pose rigs, expressions and transition capabilities.
3. Modify scene JSON using only the supported scene schema and actor controls.
4. Run npm run dev -- scene validate <scene.json> and npm run dev -- scene plan <scene.json>.
5. For a new working copy: npm run rig:setup; for the three-pose demo also run npm run demo:poses.
6. A different body rig may currently be selected only at an actual same-timestamp camera cut marker with allowCameraCuts=true. This renders an abrupt hard switch in unchanged framing. It is NOT seamless pose animation.
7. Never ask the renderer to silently blend incompatible meshes. Animated pose bridges are not implemented; if the plan contains nonzero bridge/interpolate segments, the renderer rejects them.
8. Run npm run dev -- scene preview <scene.json> to produce PNG frames, then inspect both ends of every pose change. Run scene render to export MP4 and inspect video/audio stream properties.
9. For speech, prepare WAV, install Rhubarb separately and use: node dist/cli/index.js audio align <voice.wav> --out <mouth.json> [--binary <rhubarb>]. Add audio.path, audio.startMs and audio.cuesPath to scene.
10. Do not commit user or third-party voice recordings unless redistribution rights have been checked. Review character likeness, art style and voice permissions.
11. Report exactly what rendered and what remained unsupported. Do not call a timed pose cut a smooth transition.

Prefer small tested changes; never generate a pose asset and mark it approved before visual review. Keep every edit Git-reviewable.
