# Agent-assisted landmark review

**Experimental.** PuppetControl can create a coordinate-aware task for Claude Code/Codex, validate its proposed landmarks in isolation, and require visible review before replacing a live avatar specification. No automatic image-understanding model is bundled or invoked by this command.

## 1. Import and generate the task

~~~sh
npm run rig:setup
npm run build
node dist/cli/index.js character import art/portrait.png --out avatars/portrait --id portrait
node dist/cli/index.js character landmarks assist avatars/portrait
~~~

The second command produces:
- work/landmark-agent-task.md — source-pixel coordinate instructions and exact image hash
- work/landmark-proposal.template.json — a constrained JSON proposal template
- work/grid.png — labelled coordinate grid from the imported original PNG

The command is repeatable for the same image and preserves previously edited task files. It refuses a stale proposal template from a different source image.

## 2. Generate a visual landmark proposal

**Optional automated suggestion:** When the Codex CLI is installed and authenticated, run:

~~~sh
node dist/cli/index.js character landmarks propose avatars/portrait --provider codex
~~~

This invokes `codex exec` with the original PNG and coordinate grid attached as images, using a read-only sandbox and an ephemeral session. This is **not an offline command**: the images and task prompt are sent to the user's configured Codex model/provider and may consume the user's quota. It never automatically accepts or approves a character. Raw model response and validated proposal JSON are stored in ignored `work/vision-proposals/`. A valid proposal is staged for Rev2D geometry validation and a review overlay; rejected geometry is saved for manual correction with its diagnostics (valid:false and a nonzero exit code). Known unambiguous formatting mistakes (two vertical range objects and a two-radius iris ellipse) are normalized locally, with every conversion reported in normalizedFields. Missing iris data produces qualityWarnings even when geometry validation passes. See [real-image evaluation](CODEX_VISION_LANDMARKS.md). If Codex is not available, use the manual agent task below.

**Manual Claude/Codex path:**

Give Claude Code or Codex **the actual original source.png and coordinate grid** plus work/landmark-agent-task.md. Its job is to inspect the image, identify head, face, eye contours, mouth and body geometry, and fill in the proposal template. A model without image access cannot accurately place landmarks by reading JSON alone.

The proposal must have this shape:

~~~json
{
  "format": "puppetcontrol-landmarks-v1",
  "sourceSha256": "<the SHA-256 reported by the assist command>",
  "landmarks": {
    "head": {},
    "face": {},
    "body": {},
    "hair": {"strands":[]},
    "attachments": []
  },
  "notes": "Geometry confidence and details needing review"
}
~~~

The empty objects above are placeholders, **not valid completed landmarks**. Copy the actual full group shapes from the generated template and replace unknown/null coordinates using visual inspection. Refer to .cache/rev2d/docs/AVATAR.md.

Proposals can change only those landmark groups. They cannot modify the source PNG location, character ID, build settings or post-processing operations.

## 3. Stage and inspect before applying

~~~sh
node dist/cli/index.js character landmarks stage avatars/portrait --proposal avatars/portrait/work/my-proposal.json
~~~

PuppetControl verifies the exact source PNG hash, creates an isolated candidate directory, runs Rev2D's geometry validator and produces a candidate work/overlay.png. **avatar.json is not changed during staging.**

Open the returned overlay and original source in an image viewer. Check head/neck and face ellipses, eye openings versus lashes, region contours, mouth and body anchors. A clean geometry validator is not visual QA. If the candidate fails validation, do not accept it; revise the proposal and stage a new candidate.

## 4. Explicit acceptance revokes approval

Only after inspecting the candidate overlay:

~~~sh
node dist/cli/index.js character landmarks accept avatars/portrait --candidate <the-candidateDir-from-stage> --reviewed
node dist/cli/index.js character build avatars/portrait --force
~~~

Acceptance checks source/spec/candidate hashes, verifies protected fields are unchanged, re-validates the candidate and requires an overlay. Stale candidates are rejected. The old avatar spec is backed up as avatar.json.before-<hash>.bak. Retrying acceptance reuses an existing backup only when its bytes match the original; conflicting backups abort without revoking approval. Temporary filenames are unique, so an interrupted earlier attempt does not block safe retries.

If character.json already exists, **all pose families are marked approved:false before the landmark file is replaced**. A newly built model is also unapproved. Review eyes.png, mouth.png, turn.png and poses.png after the rebuild. Human or agent visual review remains necessary before manually approving a pose.

Do not use --reviewed automatically just because validation succeeded: it is an acknowledgement that the staged overlay was **actually inspected**.

## Evidence and current limitations

The first real test used a PNG from the pinned MIT-licensed Rev2D Hana fixture. The assist command generated a hash-bound template, staging produced a valid overlay, and the original file remained unchanged. Changing the original spec after staging correctly triggered CANDIDATE_STALE. Accepting a reviewed test candidate backed up the spec and revoked a deliberately pre-set approval flag. The generated eyes sheet still shows eyelid artifacts, so the test actor is **not approved for use**.

This milestone is an *agent workflow* for landmark placement, not an automatic landmark detector. Image interpretation must be supplied by a vision-capable agent or user. No cloud provider, image upload or model dependency is added by PuppetControl.
