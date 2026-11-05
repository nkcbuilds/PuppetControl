# Rev2D integration evaluation

**Pinned candidate:** RevStudio/Rev2D commit f144581cdf1f12d781379c4df90d262b8c2dfa3d (2026-10-06)
**Upstream:** https://github.com/RevStudio/Rev2D
**License:** MIT (source repo); review separately before redistributing any imported third-party media
**Status:** CLI/API source audit passed; local visual benchmark in progress

## Confirmed upstream interfaces

- Text-based rig/model specification (*.r2d.json).
- Named parameter overrides (e.g. --param AngleX=...).
- Separate named animation layers (--anim).
- CLI validate, inspect, render, sheet, frames and gif.
- JSON output + structured diagnostics and error codes.
- Single-image bust avatar tooling, with limitations and a landmark/review workflow.
- Headless, time-sampled rendering; frame sequences can be encoded with external FFmpeg.

### Integration decision

Use a **pinned local checkout** and invoke its documented CLI with Node, through a narrow TypeScript wrapper, before considering direct SDK imports.

Do not use npm install rev2d yet: as of review, no npm release exists. Do not add Rev2D source to our repository or check in their dependencies. Provide an opt-in bootstrap command and record the pinned upstream SHA.

Do not expose Rev2D's editor/server to untrusted network traffic. Its upstream issue #1 highlights potential texture-path confinement concerns; only use the local CLI for MVP.

## Proven limitations

- No native video/MP4 exporter; use frames + FFmpeg.
- One-photo avatar builder works best on front-facing bust illustrations and cannot invent arbitrarily hidden art.
- AI-generated full-body pose families and seamless transitions are NOT first-class upstream capabilities. PuppetControl must own that logic and QA.
- Generated PNG frames alone do not prove future on-demand character compilation.

## M1 local spike protocol

1. Clone pinned Rev2D commit to ignored .cache/rev2d.
2. Install dependencies in that checkout.
3. Use bundled redistributable sample rig or upstream generator template.
4. Render a base image, parameter-sweep contact sheet, and short animation loop.
5. Inspect actual images directly and record any deformation artifacts.
6. Confirm CLI can run deterministically on Node 24/Windows.
7. Measure output frame count/duration/speed; compare to v0.1 requirements.
8. Record GO/NO-GO decision and exact reproduce commands.

## Licensing note for video export

FFmpeg is LGPL by default but may be GPL with particular enabled dependencies/build options, including commonly used libx264. Use users' existing local FFmpeg installation initially, do not bundle binaries, and verify packaging/license options separately. Official resource: https://ffmpeg.org/legal.html.

## References

- https://github.com/RevStudio/Rev2D/blob/main/docs/CLI.md
- https://github.com/RevStudio/Rev2D/blob/main/docs/AVATAR.md
- https://github.com/RevStudio/Rev2D/blob/main/docs/SPEC.md
- https://github.com/RevStudio/Rev2D/issues/1
