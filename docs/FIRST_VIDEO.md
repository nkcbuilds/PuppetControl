# First usable video: two scenes, one reviewed rig

This page documents the smallest truthful PuppetControl flow that produces real MP4 files while reusing one already-reviewed Rev2D actor.

The integration demo uses the pinned MIT-licensed Rev2D **Hana** sample only. It never approves user artwork. Its approval marker lives in an ignored .cache/first-video-demo/... fixture and is created only after an explicit --reviewed-sample flag.

## Prerequisites

Use Node.js 22 or newer and install the repository dependencies. FFmpeg and FFprobe must be available on PATH.

Prepare the pinned rig backend and build the current CLI:

    npm run rig:setup
    npm run build

The expected Rev2D commit is f144581cdf1f12d781379c4df90d262b8c2dfa3d.

## Reproduce the two-video Hana demo

First prepare an **unapproved** ignored fixture and a PNG for visual review:

    node scripts/demo-first-video.mjs

The command prints a path such as:

    .cache/first-video-demo/run-XXXXXX/hana-review.png

Open that PNG and inspect the sample. PuppetControl cannot technically verify that a human actually reviewed or consented to an asset.

Only for this pinned Hana QA fixture, explicitly continue with:

    node scripts/demo-first-video.mjs --reviewed-sample

That second command creates a **separate disposable copy** of the same pinned Hana sample. Its flag records acknowledgement for a test fixture, not verified review of that newly created copy. It uses the current CLI scene new, scene validate, and scene render commands to create two separate 5-second scenes that both point at the same copied Hana rig. It then runs the FFprobe acceptance checker on both MP4s.

Each run is isolated under ignored .cache/first-video-demo/run-XXXXXX/. Expected outputs are:

    outputs/hana-scene-a.mp4
    outputs/hana-scene-b.mp4

Both videos are silent H.264 MP4s at 512x640, 15 fps, 75 frames, and 5 seconds. The scenes differ in supported expression/look timing while keeping the same actor and rig bytes.

The checker validates container/stream metadata, dimensions, fps, duration, frame count, expected lack of audio, and availability of FFmpeg/FFprobe. That is **not** a visual-quality approval; inspect actual frames/video as part of QA.

## Use your own approved rig

The scene new command is for an actor that has already passed the project's real review/approval workflow. It refuses an unapproved default pose and does not auto-approve artwork. For a single-image Rev2D import, after genuinely inspecting all four review sheets, acknowledge approval explicitly with:

    node dist/cli/index.js character approve path/to/avatar-project --reviewed

This validates source/landmark/rig/texture fingerprints and presence of review sheets before recording approval. It cannot technically verify that a human looked at them. Do not script approval for unreviewed user art.

After `npm run build`, create an editable scene. Commands below are each a single line so they work in **PowerShell**, Command Prompt, bash and other supported shells:

    node dist/cli/index.js scene new .cache/my-video/scene-a.json --character path/to/character.json --id scene-a --seconds 5 --fps 15 --size 512x640

Edit only events that the character actually supports, then validate and render:

    node dist/cli/index.js scene validate .cache/my-video/scene-a.json
    node dist/cli/index.js scene render .cache/my-video/scene-a.json --out .cache/my-video/scene-a.mp4

For a second scene, run scene new again with a different output scene path and ID while keeping the same --character path. That reuses the same approved rig rather than rebuilding or regenerating the actor.

## Optional WAV + Rhubarb cues

Voice is optional. PuppetControl does not synthesize speech or pretend that lip sync exists when cues are missing.

If Rhubarb is installed, align a WAV first:

    node dist/cli/index.js audio align path/to/voice.wav --out .cache/my-video/mouth.json --binary rhubarb

Then create the scene with both the WAV and cue JSON:

    node dist/cli/index.js scene new .cache/my-video/voiced.json --character path/to/character.json --id voiced --seconds 5 --fps 15 --size 512x640 --voice path/to/voice.wav --cues .cache/my-video/mouth.json

The current first-video path requires --voice and --cues together. Validate and render the resulting scene normally. A real 12-second test using local nonredistributed voice input successfully generated 36 Rhubarb cues and a 180-frame H.264/AAC MP4 at 512×640, 15 FPS. The audio recording, cues and MP4 are intentionally kept only in ignored .cache/first-video-demo/qa-12s-voiced/. This proves file/cue/mux integration, not perceptual lip-sync quality on every speaker.

## Non-destructive rendering

By default, PuppetControl refuses to replace an existing MP4 at the chosen output path. The renderer writes to a unique temporary MP4 and publishes it only after FFmpeg successfully completes. To explicitly re-render over the same output path after editing a scene, use `--force`:

    node dist/cli/index.js scene render .cache/my-video/scene-a.json --out .cache/my-video/scene-a.mp4 --force

For ordinary revisions, prefer a new `--out` name so the prior render remains available. Scene IDs by default follow the scene filename, reducing collisions between different scenes.

## Verify an exported MP4

For a 5-second 15-fps 512x640 silent export:

    node scripts/check-first-video-video.mjs .cache/my-video/scene-a.mp4 --fps 15 --width 512 --height 640 --frames 75 --video-codec h264

For a voiced export, add --audio --audio-codec aac.

## Current limitations

- The first-video flow is intentionally one reviewed reusable actor; it is not a reliable one-click importer or automatic approval system.
- Approval state is a technical gate, not proof that a human reviewed the art or that the creator has rights/consent.
- The Hana --reviewed-sample path is a test-only exception isolated under ignored .cache; it must not be copied into production approval logic.
- Voice requires an existing WAV plus valid Rhubarb cue JSON. There is no automatic transcription or TTS in this flow.
- Current rendering supports at most one audio track and the first-video scaffold is aimed at one actor.
- Smooth arbitrary between-pose bridges are not implemented. Do not present hard cuts or unrelated-rig switches as fluid motion.
- Metadata acceptance with FFprobe does not establish animation quality. Inspect the rendered frames/video.
- Native rig rendering and presentation/output scaling are separate concerns; use dimensions that the current renderer has actually been tested with.
