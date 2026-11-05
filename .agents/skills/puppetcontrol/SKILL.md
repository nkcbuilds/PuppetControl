---
name: puppetcontrol
description: Agent workflow for creating and validating PuppetControl 2D animation scenes.
---

# PuppetControl creation workflow

Read repository AGENTS.md and docs/TECHNICAL_CONCEPT.md before major changes.

For a currently available scene:
1. Inspect available CLI commands with npm run dev -- --help.
2. Inspect the actor's supported poses and expressions.
3. Edit a scene only using the known schema and those capabilities.
4. Run npm run dev -- scene validate <scene-file>.
5. Fix validation errors. An intentional pose cut needs an actual camera cut at the pose change.
6. Do not claim the result can render until a rig backend and video renderer are implemented.

For future render commands (only after they exist):
7. Render low-resolution previews / contact sheets.
8. Inspect the actual images and reject clipping, face drift and ghosting.
9. Repair/review failed generated pose assets before promotion.
10. Export, check video/audio stream timing and report paths.

Keep all edits reviewable and commits tested. Never fabricate render proof or silently switch to an unapproved pose.
