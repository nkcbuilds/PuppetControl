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

## Ordered-frame sequence QA (temporal motion)

Provide **2–60 PNGs in time order**. This does not infer sorting from filenames. The CLI analyzes adjacent frames, excludes declared intentional cuts from its local comparison baseline and reports unusually large changes as candidates for visual inspection.

~~~sh
node dist/cli/index.js character qa sequence outputs/f00.png outputs/f01.png outputs/f02.png outputs/f03.png --region 175,220,170,75
node dist/cli/index.js character qa sequence outputs/f00.png outputs/f01.png outputs/f02.png outputs/f03.png --region 175,220,170,75 --control-values 1,0.7,0.3,0
~~~

The optional `--control-values` list needs exactly one finite numeric control sample **per frame** and must describe a specific animated rig parameter (for example, `EyeLOpen`). When the control moves but rendered pixels barely change, the result is a `possibleMotionStalls` candidate. A static region, a clamped value, occlusion or an intentionally paused animation can also cause a flagged pair, so **visual review remains mandatory**.

For edited scenes, supply zero-based `--cut-after` indices to identify intended jumps: for example, `--cut-after 2` means the change between input frames 2 and 3 is an editorial cut and should not be treated as a surprise jump. The CLI reports the per-pair differences and candidate indices; it **never** returns a binary animation-quality verdict. The `firstToLast` measurement helps verify loop returns when the endpoints should match, but a deliberately non-looping scene need not return to start.

### Real 13-frame blink diagnosis (Hana, 2026-11-07)

The previously generated, intentionally unapproved Hana sprite trial was rendered locally at 512×640 with `EyeLOpen` and `EyeROpen` stepped together from 1 to 0 and back to 1 in 13 frames. A silent 30fps MP4 and manually assembled contact sheet were inspected under ignored `outputs/qa/temporal-blink-20261107/`. The new report showed:

| Metric | Observed |
| --- | --- |
| Adjacent pairs / frames | 12 / 13 |
| ROI | x 175, y 220, width 170, height 75 |
| Median adjacent RGB difference | 10.7044 / 255 |
| Potential abrupt pairs | none under generic outlier heuristic |
| Expected-control motion stalls | pairs 3→4 and 8→9 (0.166667 control delta, 0 RGB difference) |
| First versus last frame difference | exactly 0 |
| Video check | 512×640 H.264, 30 fps, 13 frames, 0.433333 seconds |

Rev2D's documented `eyes_half` variant intentionally remains fully visible over `EyeOpen` 0.3–0.6, explaining the two flat intervals; the tool cannot decide whether this artistic hold is acceptable. **Actual visual inspection** showed eye-outline ghosting at intermediate fade frames, even though the generic jump detector did not flag them. A smooth-looking statistic therefore does not imply smooth-looking animation. The generated variant art is experimental, locally ignored, not published and **not approved for use**.

## Limitations and next checks

- A different or badly deformed eye can produce a *higher* difference score; there is no universal minimum or maximum that certifies good animation.
- Closed-eyelid anatomy, visible tears, head/neck continuity, seam quality, motion cadence, and voice sync still require inspecting rendered frames/video.
- Frame-to-frame cuts, camera movement and background replacement must be identified semantically before interpreting pixel deltas.
- Thresholds should be calibrated per rig on diverse properly licensed artwork, not tuned to one Hana sample.
- This helper does not transmit artwork to an external model. It decodes PNGs locally using FFmpeg.
