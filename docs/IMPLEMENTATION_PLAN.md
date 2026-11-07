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
- [x] Add root AGENTS.md, README, license, CI and a short decision log.
- [x] Initialize Git, verify GitHub authentication, create remote.
- [x] Push first coherent M0 commit to GitHub; verify remote/CI separately.

## Task board: M1 (highest technical risk)

- [x] Verify Rev2D current API/CLI, license and installation.
- [x] Use Rev2D's own MIT-licensed checkout sample Hana (no third-party art committed).
- [x] Render 5 inspected timestamps at 512x640 and explicit head/eye/mouth poses.
- [x] Generate a 4-second 15-fps scene from the PuppetControl CLI with continuous head/gaze/expression and Rev2D idle/blink/breathing. Mouth speech remains M3.
- [x] Render PNG frames and silent 4-second MP4 in ignored local outputs; FFprobe verified 60 frames, 15 fps, 512x640.
- [x] Inspect multiple actual PNGs, including neutral, mouth-open, and changing head/eye pose. Initial visible result acceptable for a rig spike.
- [ ] Benchmark per-frame cost; capture CPU/GPU/version details. Widescreen H.264 export at 1920×1080 has been locally verified from the 512×640 rig without aspect distortion.
- [x] Record conditional GO in docs/DECISIONS.md; do not mistake a single-character spike for multi-pose quality.

## Task board: M2

- [x] Versioned character capability schema.
- [x] Versioned scene timeline schema.
- [x] Transition classification (same-rig, bridge, hidden cut, unsupported) and frame-accurate pose segments; actual bridge/cut rendering remains M4.
- [ ] Timeline interpolation/evaluation.
- [x] CLI command for doctor, inspect, validate, plan and single-rig preview.
- [x] Reject unsupported parameters and pose families marked unapproved in scene planning/validation.
- [x] Unit tests for schema, pose transition boundaries, invalid actors and unsupported motion cases (additional visual integration tests follow).

## Task board: M3

- [ ] Normalize/measure audio, derive transcript if required.
- [x] Generate Rhubarb mouth cues from a local WAV using the optional installed executable (no auto-download).
- [x] Map Rhubarb cues to continuous MouthOpen/MouthForm rig tracks with eased boundaries.
- [x] Merge voice-driven mouth and emotion tracks with explicit mouth ownership.
- [x] Export and inspect 8.53-second H.264 + AAC voiced MP4 (128 frames at 15 fps); probe confirmed both streams and five inspected mouth/face frames. Subjective lip-sync quality on diverse real-world voices remains an open QA task.

## Task board: M4

- [x] Generate neutral, pointing and arms-crossed demo rigs from pinned Rev2D Hana artwork (simple vector poses; not yet AI-generated).
- [x] Verify shared head/face artwork and controls across the three derived variants (head-only output identical under same parameters).
- [x] Visually inspect same-scale/palette pose PNGs and sample boundary frames; currently rough arm vector design, appropriate only for a functional proof.
- [x] Prototype one genuinely moving rig transition: neutral→pointing uses a continuous ArmRaise bone rotation over 300ms and was visually inspected at 30fps. Cross-rig pointing→crossed-arms remains an edited hard cut; authored bridge clips still unimplemented.
- [x] Export 8.533-second voiced three-pose MP4, inspect speaking/boundary frames; facial timing continues across hard cuts.
- [x] Test invalid topology does not trigger naive morph/crossfade; renderer rejects nonzero interpolation/bridge segments pending real implementation.

## Task board: M5

- [x] Choose the pinned Rev2D single-image avatar builder as the first assisted decomposition/rigging adapter, rather than adding a second engine.
- [ ] Add canonical identity/reference image and new-pose prompt templates. A tested landmark fixture now exists, but AI body pose prompts remain future work.
- [ ] Align generated pose canvas, rig anchors and attachment transforms.
- [x] Save source/art/spec/model/texture SHA-256 provenance for new imported avatars and check it during scene validation. Pose-generation seeds and per-pose QA history remain future work.
- [ ] Generate a new pose once; use same cached asset in second project.
- [x] Support manual landmark repair, explicit rebuild, review sheets, and approval gating; generated rigs default to unapproved. Partial stage regeneration remains future work.
- [x] Add image-hash-bound Claude/Codex landmark tasks, isolated proposal validation/overlay review, stale-candidate detection and explicit acceptance that revokes prior approvals.
- [x] Implement optional Codex image-to-landmark proposal adapter; run two real-image Hana trials, normalize limited schema formatting errors, and build/inspect generated candidate review sheets.
- [ ] Reach robust fully automatic landmark inference across diverse supplied illustrations and remove visible eye/head deformation defects; no reliable one-click rigging claim yet.
- [x] Add conservative geometry triage for low torso pivot/fade, missing/outside-eye iris and shearing head pivot; return nonblocking warnings.
- [x] Revoke existing approval before any --force build mutates Rev2D outputs, and fail closed on stale source/spec/model/texture fingerprints.
- [x] Eliminate reproduced black edge artifacts caused by alpha-zero warped pixels in H.264: composite frames onto scene background, with a 60-frame before/after comparison.
- [x] Implement bounded PNG rest/activity region QA; metrics never prove visual quality.
- [x] Add 2–60 ordered-frame motion QA with optional ROI, control samples and intentional cut indices; verified on a 13-frame Hana blink cycle.
- [x] Add a reviewable 25-frame blink contact sheet and bounded motion report covering EyeOpen 0.18/0.19/0.20 and 0.68/0.69/0.70; actual imported Hana test remained unapproved.
- [ ] Add head/neck seam-specific QA and review multiple rights-cleared character styles; metrics must never auto-approve a rig.
- [x] Wrap local Rev2D drawn eye/mouth variant request/status/import with explicit reviewed-art selection, approval revocation before import, post-import provenance refresh, and new review sheets. A real Hana avatar produced correct edit masks; unchanged fake drawings were rejected.
- [x] Test and expose an opt-in, validated short eye-sprite fade as a local derived-model experiment. Compare 13 actual Hana blink frames with native, immediate-switch and shortened fades: shorter fades visibly reduce double lashes at sampled midpoints, but introduce faster pose changes; never auto-approve.
- [x] Add bounded per-character semantic head/eye look amplitudes with conservative imported-PNG starting values, schema validation, compiler tests and real Hana ±yaw/pitch/gaze frame comparisons. This does not establish visual approval.
- [ ] Produce and visually approve high-quality closed/half eye and mouth artwork; demonstrate seamless real rendered transitions across full blink playback and multiple character styles. The local proof drawing stays unapproved.

## First video milestone — reproducible usable slice (2026-11-07)

This milestone is deliberately **narrower** than M5's universal single-image promise. The verified workflow uses one previously reviewed Rev2D character, not an arbitrary one-click PNG rig. Commands and proof: [FIRST_VIDEO.md](FIRST_VIDEO.md).

- [x] Reuse an approved rig in two independently authored 5-second scenes, without changing character model, texture or manifest.
- [x] Create strict editable scene files via `scene new`, instead of hand-editing TypeScript; reject unsupported events and unapproved characters.
- [x] Add an explicit `character approve --reviewed` gate for one provenance-tracked imported rig with required review sheets. Software cannot prove human review, so this is a record of an explicit acknowledgement, never an automatic decision.
- [x] Validate the actual 75-frame, 15fps, 512×640 H.264 output of both scenes using FFprobe and visually inspect representative frames.
- [x] Render an additional 12-second, 180-frame H.264/AAC sample using 36 real Rhubarb cues from a local test WAV; verify both streams and inspect representative frames. Local audio and video are ignored, not published.
- [x] Prevent silent overwrite of existing MP4s by encoding to a temporary sibling file; `--force` explicitly replaces only after successful encoding.
- [x] Make `scene validate` distinguish planning-valid bridge/caption/motion documents from scenes the current renderer can actually export, with actionable errors.
- [ ] Achieve visibly polished eye/mouth deformation and user-friendly assisted rig correction on **diverse** artwork; the imported Hana avatar previously showed artifacts and remains unapproved.
- [x] Add optional exact-byte SHA-256 Rhubarb cue binding sidecars; verified bound first-video scene and live H.264/AAC render. Sidecars are opt-in, and legacy scenes remain supported.
- [ ] Verify visually acceptable lip synchronization with multiple natural speakers; optional integrity binding alone does not prove phoneme alignment.
- [ ] Produce a convincing, reproducible 10–15s video **using an independently imported and genuinely approved custom illustration** without developer intervention. The 12s test so far uses a pre-rigged licensed sample.

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
