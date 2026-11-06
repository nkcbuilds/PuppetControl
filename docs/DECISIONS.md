# Architecture Decision Log

## ADR-001 — Reuse an existing 2D rig engine before writing one
**Status:** accepted for initial rendering (2026-11-05); multi-pose hard cuts demonstrated, smooth bridges unproven.

Evaluate Rev2D as first candidate; do not commit to it until installation, named parameter control, headless batch rendering, acceptable quality and licensing are demonstrated. Inochi2D and Stretchy Studio are fallback research candidates.

## ADR-002 — Hybrid pose families
**Status:** accepted as design direction.

Continuous rig controls handle small movements; separately prepared/rigged pose families handle topology-changing body postures. Shared head where compatible. Bridge clip or intentional camera cut for incompatible transitions; never interpolate unrelated topology.

## ADR-003 — Agent-first CLI; GUI later
**Status:** accepted.

Claude Code/Codex author text scene files and use commands, validation errors and contact sheets. No backend database, MCP server or complex Studio initially.

## ADR-004 — TypeScript local-first
**Status:** accepted.

One Node.js project, plain files and FFmpeg for output. GPU image models optional sidecars/adapters. No requirement for cloud keys to animate an already prepared actor.

## ADR-005 — Honest phased implementation
**Status:** accepted.

A working schema/CLI is not an animation engine; generated sample frames are not proof of arbitrary rigging. M1 requires visually inspected samples. M4/M5 depend on evidence.

## ADR-006 — OSS licensing
**Status:** pending upstream dependency/asset audit.

Intend to use permissive MIT core for low friction unless specific dependency/legal review indicates otherwise. Each model's weights, test artwork and binary tools need separate license checks.

## ADR-007 — First multi-pose renderer: explicit hard cuts only
**Status:** accepted as a narrowly-scoped prototype, not a solution to smooth pose switching.

The frame-accurate pose timeline now drives different Rev2D models for neutral, pointing and crossed-arms body art. Each model retains its shared head/face artwork and parameters. Renderer refuses nonzero interpolated/bridged pose segments; it only switches rigs at a camera-cut event explicitly permitted in the scene. The current camera event marks a hard switch without reframing, so visible body changes still pop. Do not describe this as a smooth transition. Next: author real bridging clips or implement shot reframing/occlusions, plus visual QA.

## ADR-008 — Demo art is reproducibly derived rather than bundled
**Status:** accepted.

scripts/build-demo-poses.mjs requires pinned Rev2D checkout SHA and emits three vector-art rig variants deterministically. Generated complete rig JSONs are ignored and not committed because they contain substantial upstream Rev2D Hana artwork. A small silent MP4 is bundled as an attributed proof-of-concept preview only. Upstream RevStudio MIT license text and ownership is preserved under docs/THIRD_PARTY_NOTICES.md.

## ADR-009 — Assisted PNG-to-rig via pinned Rev2D avatar tools
**Status:** experimental and verified for one pinned sample (2026-11-06).

Instead of building a new image decomposition/mesh engine, PuppetControl wraps the existing Rev2D avatar new / validate / build / poses workflow. Agent- or human-authored landmarks remain required. The source image stays local; the generated model shares the same scene renderer as authored rigs. Validation and build success alone cannot approve an actor: character manifests start with approved=false until review sheets are inspected. The checked-in Hana landmark fixture and demo reproduce the integration without bundling full rig artwork. A working imported animation was rendered from an isolated local test approval copy, while the normal generated actor remained unapproved due to observed eyelid artifacts.

An assisted avatar controls a head, eyes and mouth; it does not automatically add neutral-to-pointing body anatomy or new identity-consistent pose families.

## ADR-010 — Hash-bound agent landmark proposals, staged review and approval revocation
**Status:** experimental, tested against pinned Hana avatar (2026-11-06).

Rather than silently using any agent-produced JSON as an approved rig, PuppetControl generates an image-aware task with a source SHA-256 and constrains proposals to landmark geometry. Each proposal is built into an isolated staging folder and Rev2D validates it before producing an overlay. Approval requires the returned candidate path and an explicit acknowledgement that the overlay was inspected; stale source/spec/candidate hashes and changed protected fields are rejected. Acceptance backs up avatar.json and revokes old character approvals before changing the specification. The new rig must be rebuilt and visually reviewed separately. A built-in CV detector or guaranteed visual-QA classifier is **not** part of this milestone.

## ADR-011 — Optional image-vision proposals via Codex CLI
**Status:** experimental, demonstrated on the 512×640 Hana PNG (2026-11-06).

A user can explicitly invoke their authenticated Codex CLI with the original PNG plus coordinate grid. The Codex process receives a fixed structured landmark task, runs read-only and is not allowed to approve/modify the live avatar. Proposals are parsed as untrusted JSON, image-hash checked, normalized only for a few unambiguous schema representation mistakes, and staged through Rev2D. Provider use is optional and sends the art to the user's configured online model, potentially consuming quota.

The real-image tests proved source→Codex→staged overlay and an independently rendered candidate, but also exposed poor eyelid behavior and unreliable gaze when iris landmarks are absent. Schema validation alone cannot establish quality. The existing explicit visual-approval gate remains mandatory; no automatic rig acceptance or universal landmark-accuracy claim is authorized.

## ADR-012 — New imported rigs are content-fingerprinted, and approval is revoked before rebuilding
**Status:** implemented with QA evidence, 2026-11-06.

An imported actor must not appear approved when its source illustration, accepted landmarks, compiled model or any generated texture has changed since the last rig build. PuppetControl now writes a local avatar-build.json with SHA-256 hashes of those assets and the pinned Rev2D commit; scene preflight verifies every fingerprint and fails closed on missing/stale records for imported actors. Force rebuild revokes any prior pose approval **before** running Rev2D, with unique temporary manifest files to survive interrupted attempts. Geometry triage adds conservative warnings, not a pixel-quality grade. Existing manually authored characters without provenance are unaffected. This does not authenticate maliciously rewritten fingerprints or remove the need for visual QA.

## ADR-013 — Flatten moving-rig transparency before opaque video export
**Status:** implemented and compared on 60 real Hana frames (2026-11-07).

Rev2D warps an image on a finite canvas, leaving some edge pixels alpha-zero as the model moves. When these frames were encoded to H.264 without explicit compositing, missing pixels appeared black along the top edge in 29 of 60 frames. The frames CLI already supports an opaque `--bg` flag, so PuppetControl now supplies the scene's declared output background (or its established default `#f0eaf4`) when generating video/preview frames. The same 60-frame sequence then had zero nonopaque output pixels and zero unexpected dark top-edge pixels, with matching frame count/resolution/duration. A second render verified explicit background override. This is not an automatic fix for other rig-layer seams, and transparent export would need a separate opt-in path.
