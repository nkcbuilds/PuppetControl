# 45-second renderer benchmark

**Purpose:** exercise the actual local Rev2D → PNG sequence → FFmpeg pipeline at 30 fps using a long timeline, multiple body poses, expressions, gaze, and camera events.

## Reproduce the public silent example

~~~sh
npm ci
npm run rig:setup
npm run demo:benchmark
~~~

The resulting file is `outputs/hana-45s-benchmark.mp4`. The scene is in `examples/scenes/hana-45s-benchmark.json`; it intentionally does **not** reference the private/local voice recording used in an earlier voiced test.

## What has been tested (Windows, 2026-11-05)

A separate private/local version of the same 45-second scene was rendered with a Windows synthetic speech voice and Rhubarb mouth cues. Its output was verified via FFprobe:

| Property | Verified |
| --- | --- |
| Video | H.264, 1920×1080 |
| Frame rate | 30 fps |
| Frame count | 1,350 |
| Duration | 45.000 seconds |
| Audio | AAC, 45.000 seconds |
| Mouth cues | 294 from Rhubarb |
| Total wall time | Approximately 121 seconds for full rendering/encoding |

The sample art was generated from the pinned Rev2D Hana fixture, not an arbitrary imported user drawing. The visual quality is stylized prototype art; a separate crossed-arms rig still needs a hard cut. These results show pipeline scalability for one character under this environment, **not** guaranteed runtime performance or high-quality lip-sync for all characters.

## Known constraints

- The published example is silent; it does not upload or redistribute the OS-generated voice recording.
- 1080p presentation uses an upscaled/letterboxed 512×640 rig; it is not genuinely 1080p source art.
- The renderer currently caps timelines at 2,000 frames. Larger productions need segmented render/export and resource limits.
- FFmpeg and the pinned Rev2D checkout must be installed locally.
