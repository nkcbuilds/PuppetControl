# Pixel-level visual QA (triage only)

**Status:** local PNG comparison implemented with deterministic RGBA decoding through the already-required FFmpeg executable. This is **not** a visual-approval model and not a perceptual similarity metric.

## CLI

Capture two frame images of exactly the same canvas and resolution. For a Rev2D avatar, use the engine's `render` command (review the current pinned backend help for flags) or the generated scene preview PNGs.

~~~sh
node dist/cli/index.js character qa compare outputs/rest.png outputs/eyes-closed.png
node dist/cli/index.js character qa compare outputs/rest.png outputs/eyes-closed.png --region 175,220,170,75
~~~

The optional region is an **integer** `x,y,width,height` rectangle within both images. Always use comparable camera, framing and character pose settings; do not compare resized images or a camera cut to an unchanged rest pose and interpret the result as articulation.

The output includes:

| Field | Meaning |
| --- | --- |
| `rgbMeanAbsoluteError` | Average absolute difference per RGB channel, in 0–255 intensity levels |
| `changedPixels` and `changedFraction` | Pixels whose RGB or alpha changed by more than 10 levels; fraction of comparable ROI pixels |
| `ignoredTransparentPixels` | ROI pixels where both samples have negligible alpha and RGB is visually undefined |
| `unexpectedTransparentBorderPixels` | Full-image perimeter pixels that were opaque in the reference and became nonopaque in the candidate |
| `region` | Coordinates actually evaluated for motion and RGB differences |

Inputs must be PNGs under 30 MB with dimensions 256–4096 pixels per side. Files must be inside the active workspace. PNGs with mismatched dimensions or invalid ROI are rejected rather than silently scaled. FFmpeg is invoked with fixed argument arrays, without a shell, and decoded RGBA buffers are bounded.

## Real-data probe (Hana, 2026-11-07)

A fresh local 512×640 Hana import was rendered at rest and again with both eye-open parameters set to 0, using the same native camera and an opaque background. The resulting source-versus-rest full-frame comparison gave `rgbMeanAbsoluteError = 0.0002`, `changedPixels = 0`, and `unexpectedTransparentBorderPixels = 0` for that specific imported test drawing.

For a 170×75 eye-region crop, rest versus closed-eyes produced `rgbMeanAbsoluteError = 33.5879`, `changedFraction = 0.364392`, and `unexpectedTransparentBorderPixels = 0`. These numbers establish **pixel activity**, not the quality of the drawing. Human visual inspection of the same review sheets still showed flat half-eye artwork and double contour artifacts in fades.

## Limitations and next checks

- A different or badly deformed eye can produce a *higher* difference score; there is no universal minimum or maximum that certifies good animation.
- Closed-eyelid anatomy, visible tears, head/neck continuity, seam quality, motion cadence, and voice sync still require inspecting rendered frames/video.
- Frame-to-frame cuts, camera movement and background replacement must be identified semantically before interpreting pixel deltas.
- Thresholds should be calibrated per rig on diverse properly licensed artwork, not tuned to one Hana sample.
- This helper does not transmit artwork to an external model. It decodes PNGs locally using FFmpeg.
