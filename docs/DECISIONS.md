# Architecture Decision Log

## ADR-001 — Reuse an existing 2D rig engine before writing one
**Status:** provisional — awaiting M1 benchmark.

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
