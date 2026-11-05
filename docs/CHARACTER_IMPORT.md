# Assisted single-image character import

This local-first workflow uses the pinned Rev2D avatar builder. It creates real facial/head/mouth controls from a front-facing illustration plus inspected landmark annotations. This is **assisted rigging**, not one-click automatic Live2D conversion.

## Step 1 — Start a character project

~~~sh
npm ci
npm run rig:setup
npm run build
node dist/cli/index.js character import art/portrait.png --out avatars/portrait --id portrait
~~~

Input: workspace-local PNG between 256 and 4096 pixels per side, under 30 MB. Existing destinations are never overwritten. The importer checks the source format and pinned backend, and creates these files:

| Output | Purpose |
| --- | --- |
| avatars/portrait/source.png | Byte-for-byte copy of the illustration |
| avatars/portrait/avatar.json | Editable Rev2D landmark specification (initially incomplete) |
| avatars/portrait/work/grid.png | Coordinate-labelled image for placing landmarks |

The JSON result reports status "landmarks-required" and provides absolute paths. The source stays local; there is no network image upload.

## Step 2 — Annotate with Claude Code or Codex

Read the local .cache/rev2d/docs/AVATAR.md or [Rev2D's online guide](https://github.com/RevStudio/Rev2D/blob/main/docs/AVATAR.md).

Open the source and coordinate grid, then annotate the head ellipse, face ellipse, both eyes (openings and outer regions), nose, mouth, chin, head pivot/neck band, torso/body pivot and chest. Hair strands and accessories are optional. Use source image pixel coordinates; do not estimate positions from resized previews.

~~~sh
node .cache/rev2d/bin/rev2d.js avatar validate avatars/portrait --json
node .cache/rev2d/bin/rev2d.js avatar overlay avatars/portrait -o avatars/portrait/work/landmarks.png
~~~

Fix reported geometry issues before building. Review enlarged eye and mouth crops. An agent that cannot read coordinates accurately should use Rev2D's avatar vision-check procedure instead of guessing.

## Step 3 — Build and review

~~~sh
node dist/cli/index.js character build avatars/portrait
~~~

This validates landmark geometry, builds a Rev2D model, renders review sheets and writes a PuppetControl manifest/preview scaffold.

| Output | Purpose |
| --- | --- |
| portrait.r2d.json, textures/ | Actual model and image layers |
| review/poses.png | Rest, blinking, mouth/head/body parameter views |
| review/turn.png | 3x3 head-turn matrix |
| review/eyes.png | Eyelid, wink and gaze details |
| review/mouth.png | Mouth shapes / visemes |
| review/summary.json | Detailed pose data |
| character.json | PuppetControl manifest, with neutral pose **unapproved** |
| preview-scene.json | Agent-editable four-second scene |

The result has status "review-required". If landmarks require correction after building, edit avatar.json, then run:

~~~sh
node dist/cli/index.js character build avatars/portrait --force
~~~

This explicitly regenerates the output manifest and preview scene, resetting approval. It **overwrites edits to those two generated files** but not source.png or avatar.json. Save important manifest changes elsewhere before using --force.

## Step 4 — Approve only after visual QA

Inspect every review sheet for torn eye closures, halos, doubled contours, missing hair/skin, incorrect mouth shapes, and awkward head movement. Correct the landmark source and rebuild as needed.

When the rendered rig is genuinely acceptable, change the neutral pose family's approved field to true in character.json. Only then:

~~~sh
node dist/cli/index.js scene validate avatars/portrait/preview-scene.json
node dist/cli/index.js scene render avatars/portrait/preview-scene.json --out outputs/portrait.mp4
~~~

Before approval, the scene intentionally fails with DEFAULT_POSE_NOT_APPROVED. The built model begins with one body pose family (neutral), not automatic pointing or crossed-arms artwork.

## Reproducible built-in demonstration

~~~sh
npm run demo:avatar
~~~

The demo renders the pinned MIT-licensed Rev2D Hana sample into a flat PNG, imports that PNG independently, applies our checked-in landmark fixture, compiles a new rig and produces review sheets under ignored .cache/avatar-onboarding/repro-* directories. Each run uses a unique output directory and does not overwrite earlier runs; the generated sample art and full rigs are not committed.

A local integration test on 2026-11-06 successfully generated a model from a flat PNG and rendered a 4-second, 60-frame scene using a separate temporary approved test copy. However, the resulting eye-closure review showed visual artifacts. The normal generated character remains **unapproved** until that defect is corrected.

## Limitations

- Landmark placement is currently assisted/manual, not automatically inferred.
- Front-facing bust illustrations with transparent backgrounds work best; opaque backgrounds complicate layering.
- It does not invent occluded anatomy, arbitrary new postures, or full-body motion.
- Valid data and successful builds are not substitutes for actual visual review.
- No cloud account or externally hosted image API is needed for import, validation or rendering.
