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

Use `node dist/cli/index.js character landmarks assist avatars/portrait` to create a coordinate-aware task and source-bound proposal template for Claude Code/Codex. See the [landmark agent workflow](LANDMARK_AGENT_WORKFLOW.md) for staged validation and approval revocation. The agent must still inspect the original image, not just copy coordinates.

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

This validates landmark geometry, builds a Rev2D model, renders review sheets and writes a PuppetControl manifest/preview scaffold. When rendering an MP4, transparent warp margins are flattened onto the scene's output background (default `#f0eaf4`) rather than appearing black. Set `scene.output.background` to match the illustration when appropriate.

| Output | Purpose |
| --- | --- |
| portrait.r2d.json, textures/ | Actual model and image layers |
| review/poses.png | Rest, blinking, mouth/head/body parameter views |
| review/turn.png | 3x3 head-turn matrix |
| review/eyes.png | Eyelid, wink and gaze details |
| review/mouth.png | Mouth shapes / visemes |
| review/summary.json | Detailed pose data |
| character.json | PuppetControl manifest, with neutral pose **unapproved** |
| avatar-build.json | SHA-256 fingerprints of source art, landmarks, rig and generated textures. Scene validation rejects stale/missing assets |
| preview-scene.json | Agent-editable four-second scene |

The result has status "review-required" and may include geometryWarnings for suspect neck/body/eye landmarks. These warnings guide inspection; they are not automatic quality grades. If landmarks require correction after building, edit avatar.json, then run:

~~~sh
node dist/cli/index.js character build avatars/portrait --force
~~~

This revokes prior approval **before** the rendering backend touches the rig, and regenerates the manifest and preview scene. A failed or interrupted rebuild leaves the old character unapproved. It **overwrites edits to those two generated files** but not source.png or avatar.json. Save important manifest changes elsewhere before using --force.

## Step 4 — Approve only after visual QA

Inspect every review sheet for torn eye closures, halos, doubled contours, missing hair/skin, incorrect mouth shapes, and awkward head movement. Correct the landmark source and rebuild as needed.

When the rendered rig is genuinely acceptable, change the neutral pose family's approved field to true in character.json. Only then:

~~~sh
node dist/cli/index.js scene validate avatars/portrait/preview-scene.json
node dist/cli/index.js scene render avatars/portrait/preview-scene.json --out outputs/portrait.mp4
~~~

Scene validation also checks avatar-build.json against source.png, avatar.json, the built model and all generated textures. Changing any of them requires a new build and renewed review; stale files fail with AVATAR_ASSETS_STALE. Before approval, the scene intentionally fails with DEFAULT_POSE_NOT_APPROVED. The built model begins with one body pose family (neutral), not automatic pointing or crossed-arms artwork. Its provenance record covers that primary rig only: adding a different pose model to this imported actor is rejected until separate pose-model fingerprints are supported. Manually authored multi-pose characters remain available through the existing explicit rig workflow.

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
