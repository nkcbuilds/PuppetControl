# PuppetControl — Agent Working Agreement

Read [docs/TECHNICAL_CONCEPT.md](docs/TECHNICAL_CONCEPT.md) and [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) before architecture changes.

## Objective
Build a real local-first open-source AI-directed 2D animation pipeline. Keep character appearance consistent, preserve fluid rig motion, support distinct reusable pose families, lip sync and safe transitions.

## Priorities
1. Verify output quality through actual frames and video.
2. Integrate existing rig technology before writing a replacement.
3. Small TypeScript modules; text-editable scene files; CLI-first.
4. Restrict semantic actions to actual rig capabilities.
5. Generate/review new pose assets once, cache and reuse.
6. Never imply a command/feature works until demonstrated.

## Safety, review, and repository etiquette
- Inspect Git status and the current files before modifying them.
- Do not overwrite user images, generated assets, secrets or unrelated work.
- Use only properly licensed sample media; avoid checking in proprietary test assets.
- Imported scene/character files are untrusted inputs; validate them.
- Keep code/provider credentials out of logs, source files and commits.
- Do not silently upgrade dependencies, replace a rig engine, or delete other work.
- No concurrent edits to the same module without explicit ownership.
- Use atomic, reviewable commits. Before each commit inspect recent Git log style.
- Push with an explicit branch. For high-risk changes, use a feature branch/PR.
- If a required integration is unavailable, document blocker and smallest workaround.

## Local commands
Commands below are design goals until they exist; check package.json for actual scripts:
- npm test
- npm run typecheck
- npm run build
- puppetctl doctor / scene validate / scene preview / scene render

Do not hallucinate CLI flags or declare tests passed without running them.

## Definition of done for visual work
Provide actual rendered preview artifacts, visually inspect key timestamps and transition boundaries, run automated checks, report limitations and show how to reproduce output. A valid JSON file alone does not mean animation works.

## Task workflow
Read task + affected modules → design smallest test → implement → validate → inspect visual output when relevant → document → commit/push → report exact evidence.
