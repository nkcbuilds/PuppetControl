# PuppetControl — Agentic Implementation Plan

**Source of truth:** [Technical concept](TECHNICAL_CONCEPT.md)
**Development mode:** Claude Code/Codex + PC workspace, local-first, evidence-driven.
**Rule:** Do not move on merely because code compiles; inspect visual output.

## Milestones, in execution order

| Milestone | Scope | Proof required |
|---|---|---|
| M0 | Repository, architecture docs, standards, basic CI | Public repo, push, CI green |
| M1 | Existing rig engine benchmark | Frame samples showing head/gaze/mouth motion; license and speed report |
| M2 | Character capability manifest, semantic timeline, CLI | Unit tests, deterministic scene validation and preview |
| M3 | Audio-to-viseme, facial acting and compositing | Voice-synced playable MP4, visual inspection |
| M4 | Hybrid pose families and transition resolver | Distinct poses, safe transitions, no identity drift |
| M5 | Assisted image-to-actor and new-pose generation | New pose generated/reviewed once, reusable across two scenes |
| M6 | Agent skill, install polish, video presets and docs | New developer can generate video with natural-language agent request |

## Task board: M0

- [x] Establish workspace and select project name.
- [x] Write design and acceptance targets.
- [ ] Add root AGENTS.md, README, license, CI and a short decision log.
- [ ] Initialize Git, verify GitHub authentication, create remote.
- [ ] Push first coherent M0 commit and verify remote/CI.

## Task board: M1 (highest technical risk)

- [ ] Verify Rev2D current API/CLI, license and installation.
- [ ] Select a redistributable layered sample actor; if no suitable art is licensed, author a tiny test fixture.
- [ ] Render 4–6 timestamps at fixed resolution and parameter values.
- [ ] Build one 5–10-second loop with head yaw/pitch, blinking, mouth aperture and idle motion.
- [ ] Save preview contact sheet and video (if rendering is supported).
- [ ] Inspect images directly for clipping/joint deformation.
- [ ] Benchmark per-frame cost; capture CPU/GPU/version details.
- [ ] Record GO/NO-GO decision in docs/DECISIONS.md.

## Task board: M2

- [ ] Versioned character capability schema.
- [ ] Versioned scene timeline schema.
- [ ] Transition classification (same-rig, bridge, hidden cut, unsupported).
- [ ] Timeline interpolation/evaluation.
- [ ] CLI command for doctor, inspect, validate and preview.
- [ ] Reject unsupported parameters and generated content not yet QA-approved.
- [ ] Unit tests for every validator/error path.

## Task board: M3

- [ ] Normalize/measure audio, derive transcript if required.
- [ ] Generate Rhubarb (or chosen aligner) mouth cues.
- [ ] Map cues to selected rig mouth controls.
- [ ] Merge speech and emotion without fighting mouth priority.
- [ ] Export short MP4 with FFmpeg and inspect audio/viseme timing.

## Task board: M4

- [ ] Build neutral, pointing and arms-crossed pose rigs.
- [ ] Attach compatible shared head or document alternate head view.
- [ ] Validate alignment/scale/reference palette between poses.
- [ ] Author two bridge transitions, and one intentionally cut transition.
- [ ] Ensure face/audio playback survive transition boundaries.
- [ ] Test invalid topology does not trigger naive morph/crossfade.

## Task board: M5

- [ ] Choose smallest working decomposition adapter.
- [ ] Add canonical reference image/pose prompt templates.
- [ ] Align generated pose canvas, rig anchors and attachment transforms.
- [ ] Save provenance/model/version/seed and QA status per pose.
- [ ] Generate a new pose once; use same cached asset in second project.
- [ ] Allow manual rejection, repair or regeneration of just one failed stage.

## Acceptance benchmark

A single 45-second 1080p/30 video with human/AI voice, four pose families (three minimum), convincing continuous head/face movement, visually acceptable lip-sync, smooth or intentionally hidden pose changes, consistent identity, and a successful second export after a one-line expression edit.

The agent must inspect preview images/frames rather than only file metadata.

## Development loop for every task

1. Inspect the current repository and nearby tests; confirm ownership of files.
2. Identify a narrow success criterion and a failing test or observable artifact.
3. Implement smallest change.
4. Run focused tests, typecheck/lint/build as relevant.
5. Render previews if visuals are involved and inspect screenshots.
6. Document limitations explicitly.
7. Commit small coherent change; push explicitly named branch.
8. Report commit, validation, and next blocker.

## Parallel agent work

Separate workstreams where practical:
- **Architecture/research** — read-only upstream/compatibility/quality audits.
- **Core scene/runtime** — schema, transition planner, timeline.
- **Rig/render adapter** — evaluated backend integration and benchmark.
- **Audio/CLI** — lip sync and export once runtime is ready.

Agents must not edit overlapping files concurrently; the primary agent integrates and pushes. Use feature branches/worktrees when multiple writers are introduced. Do not autonomously merge unreviewed incompatible changes.

## Risks to revisit after M1

- Rev2D API unstable/incomplete for required frame rendering.
- Generated pose family cannot share the head without complicated renderer changes.
- Raster render too slow for long videos.
- Pose transition quality poor even with matched anchors.
- Model dependencies too heavy for users with consumer GPUs.
- Licensing restrictions on sample art or pre-trained weights.

Mitigation is evidence-backed scope reduction or a small alternate adapter, not unbounded engine development.
