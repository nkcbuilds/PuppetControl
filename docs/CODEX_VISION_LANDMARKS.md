# Codex visual landmark proposal experiment

**Status:** working optional inference adapter; visual quality is not production-ready.
**Date:** 2026-11-06. Backend: pinned Rev2D Hana sample PNG, 512×640.

## How to run

A Codex CLI logged into a usable account is optional. On Windows the shell-free integration requires a native `codex.exe` on PATH; an npm-only `codex.cmd` shim is not executed through `cmd.exe` for command-safety reasons. Such installations can still use `character landmarks assist` and run Claude Code/Codex manually. With an imported avatar project and the pinned Rev2D backend installed:

~~~sh
npm run build
node dist/cli/index.js character landmarks propose avatars/portrait --provider codex
~~~

PuppetControl passes the original image and the coordinate grid directly as Codex CLI image attachments. The model is launched with an ephemeral session, a **read-only** sandbox and closed stdin; it cannot edit project files through its agent tools. The prompt includes the required Rev2D landmark fields, source dimensions and SHA-256. The run writes raw output and a validated proposal under ignored work/vision-proposals. It **does send these two images to your configured Codex provider** and may consume your account quota.

The output is *never accepted automatically*. A geometry-valid proposal is staged as an isolated candidate with an overlay. The returned status can contain qualityWarnings; manual overlay inspection and final review remain compulsory.

If the proposal is rejected by the Rev2D schema validator, the CLI returns valid:false / status proposal-needs-revision, a nonzero exit code, diagnostics and a proposal JSON path for manual corrections. Four safe model-output conversions are allowed: yStart/yEnd objects for head.neck and body.fade become two-element arrays, and [rx,ry] iris radii become the smaller positive scalar. Every correction is reported in normalizedFields; this repairs **format only**, not invented landmark locations.

If this provider is unavailable, character landmarks assist prepares the same source-specific task and template for use directly inside Claude Code/Codex.

## Actual evaluation

Two independent Codex calls were performed on a freshly imported, unplaced PNG from pinned Rev2D Hana.

| Probe | Outcome |
| --- | --- |
| First proposal | Codex returned geometric landmarks; Rev2D validated and produced an overlay |
| First review | Explicit iris center/radius absent; eye gaze control ineffective or unreliable |
| Second proposal | Codex included iris centers, but formatted two vertical ranges as objects and iris radii as two-element arrays |
| Deterministic correction | Four conversions, each recorded; no image or coordinates modified beyond choosing a conservative smaller iris radius |
| Second validation | Rev2D accepted the corrected proposal; isolated rig build and all review sheets rendered |
| Visual QA | Head, eyes, mouth and movement displayed, but closed-eye artifacts, inaccurate boundaries and imperfect deformation remain |
| Approval | Not granted; original imported avatar.json remains unchanged |

The first version of the child-process launcher had kept stdin open and blocked at "Reading additional input from stdin". It was corrected to launch Codex with stdin explicitly closed and a bounded timeout, and a focused regression test was added.

Both actual model calls took around 90 seconds on this connected machine. Runtime, output quality and usage costs may differ by account, model and image. This is not a dataset-wide accuracy benchmark.

## Quality gates and boundaries

- Valid coordinates mean the schema can build, not that the output looks right.
- The importer cannot infer occluded body artwork, animation-ready elbows or arbitrary additional poses.
- The model may miss iris details, include too much clothing in the head ellipse, or choose poor fade/neck bands.
- Rebuild review/poses.png, review/turn.png, review/eyes.png and review/mouth.png before approval; examine closing eyelids, iris gaze, face silhouette and head/neck seams.
- Do not commit user-provided art or raw model messages. Local sample runs and their generated rig/art live under ignored .cache.
- The model never receives a write-capable sandbox and cannot mark a character approved.
