# Audio and lip-sync workflow

PuppetControl supports one WAV/MP3 audio track per scene and optional Rhubarb JSON mouth cues driving a prepared Rev2D character's MouthOpen/MouthForm parameters. The first audio-backed pipeline was verified locally on Windows: 8.533-second H.264 video with 128 frames, 15 fps, AAC audio and visible mouth changes. The test recording is not committed because it came from an OS speech synthesis voice.

## Requirements

- PuppetControl installed: npm ci and npm run rig:setup.
- FFmpeg on PATH for final MP4 export.
- Rhubarb Lip Sync installed separately for alignment (open-source external executable). Download appropriate build from https://github.com/DanielSWolf/rhubarb-lip-sync/releases or configure an existing binary with the CLI --binary flag. The repository does not redistribute Rhubarb executables.
- A WAV speech recording (Rhubarb supports WAV). MP3 may be used as the *audio* referenced in a scene, but align the WAV version first.

## Generate mouth cues

~~~sh
node dist/cli/index.js audio align path/to/voice.wav --out path/to/mouth-cues.json --binary path/to/rhubarb
~~~

Or place the executable on PATH or set PUPPETCONTROL_RHUBARB to omit --binary. Supply --dialog path/to/script.txt when the known transcript is available. Existing output is never overwritten unless --force is explicitly provided.

The CLI calls Rhubarb with an argument array (never through a shell), reads its JSON, validates cue intervals, and only then promotes the generated file to the requested path. It returns cue count and duration in machine-readable JSON. The Rhubarb tool must be installed separately; the render command does not install or invoke it implicitly.

## Wire it into a scene

Illustrative audio array for the single actor:

~~~json
"audio": [
  {
    "path": "voice.wav",
    "startMs": 350,
    "actor": "hana",
    "cuesPath": "mouth-cues.json"
  }
]
~~~

Paths are relative to the JSON scene's directory. Positive startMs delays *both* audio and mouth cues. If a cue is silent or outside the audio's active interval, the mouth is closed.

Full scene JSON must pass the versioned schema. The character's Rev2D rig must implement MouthOpen/MouthForm. Audio-specific events are separate from expressions; the speech track owns the mouth while brows, cheeks, gaze and head motion remain expression/animation driven.

## Render

~~~sh
node dist/cli/index.js scene validate path/to/scene.json
node dist/cli/index.js scene render path/to/scene.json --out outputs/talking-character.mp4
~~~

The pipeline uses PNG frames, FFmpeg libx264/yuv420p and AAC. Audio is delayed by startMs, padded/trimmed to the *video duration calculated from frame count / fps*, and multiplexed as a single synchronized audio stream. Only one actor/rig family is currently supported in the renderer.

## QA

Inspect still frames at word starts, pauses, and sentence ends; play the MP4 to judge audio/video sync. Machine tests validate cue ordering, nonoverlap, 9 mouth-shape mapping, eased transition bounds, audio delay/pad/trim and use of structured FFmpeg arguments. Real performance quality must be evaluated against varied accents, languages, speech rates and microphone quality; do not mistake one demo voice for universal lip-sync.

Known limitations:
- No built-in transcription or speech synthesis provider.
- No offline auto-installer for Rhubarb.
- Rhubarb's recognizer is mostly English-focused; other languages may need external aligners.
- No multiple audio tracks or spatial mixing.
- No cross-pose motion/transition rendering yet.
