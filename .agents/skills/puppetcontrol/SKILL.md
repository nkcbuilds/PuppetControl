---
name: puppetcontrol
description: Agent workflow for importing, reviewing, and directing reusable Rev2D actors with PuppetControl.
---

# PuppetControl agent workflow

Read repo-root AGENTS.md, docs/TECHNICAL_CONCEPT.md, and docs/CHARACTER_IMPORT.md before making character or scene changes.

1. Verify backend with npm run rig:status and npm run dev -- doctor. Use npm run build when running the compiled CLI.
2. For an existing approved rig, inspect its manifest with node dist/cli/index.js character inspect <character.json>. Use only its named expressions, pose families, and allowed transitions.
3. To onboard new PNG art inside this workspace, call node dist/cli/index.js character import <image.png> --out <project-dir> --id <id>. The command writes source.png, incomplete avatar.json landmarks and a labelled review grid, but DOES NOT create an approved rig.
4. For agent-assisted landmark annotation, run `node dist/cli/index.js character landmarks assist <project-dir>`. Open source.png, work/grid.png and work/landmark-agent-task.md. Fill the generated JSON proposal template with original source-pixel coordinates; do not guess from resized images. Read .cache/rev2d/docs/AVATAR.md.
5. Stage the proposal using `node dist/cli/index.js character landmarks stage <project-dir> --proposal <proposal.json>`. Rev2D validates the isolated candidate and returns a work/overlay.png. **Actually inspect the overlay** before `character landmarks accept <project-dir> --candidate <returned-dir> --reviewed`. Accepting replaces avatar.json with a backup and revokes all existing pose approvals. Never auto-pass --reviewed solely because a validator passed.
6. Build using node dist/cli/index.js character build <project-dir> (use --force if prior output exists). Inspect every returned review/poses.png, turn.png, eyes.png and mouth.png. If incorrect, repair avatar.json and rebuild using --force; this resets the generated manifest and any edited scaffold.
7. A successful build intentionally leaves character.json with approved:false. Only after actual visual QA should an agent/user mark the neutral pose approved. If there are torn eyelids, missing areas, extra contours or identity drift, LEAVE IT UNAPPROVED and report what needs correction.
8. The generated preview-scene.json is editable. Use node dist/cli/index.js scene validate <scene.json> and scene plan before rendering. Preview PNG frames, inspect key timestamps, then render and inspect the MP4.
9. Within a compatible shared rig, semantic pose events may interpolate through validated parameter presets (the neutral-to-pointing demo uses shoulder and elbow controls). Distinct pose models require explicit scene camera cuts; an authored bridge is NOT implemented. Never silently crossfade meshes or call a body cut a smooth physical transition.
10. For speech, prepare WAV, install Rhubarb separately, and use node dist/cli/index.js audio align <voice.wav> --out <mouth.json> [--binary <rhubarb>]. Reference audio.path, audio.startMs and audio.cuesPath from the scene; review the actual mouth/audio timing.
11. Do not commit private character illustrations, full generated models, user voice recordings or secrets without checking redistribution rights. Demo:avatar generates pinned MIT-licensed sample artwork into ignored .cache.
12. State what actually rendered and which controls remain unsupported. Do not claim a flat PNG is automatically converted into production-quality animation without landmark review.

Keep edits small and testable. Run npm run verify and inspect visual evidence for any animation/asset changes.