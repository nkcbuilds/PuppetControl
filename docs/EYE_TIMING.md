# Blink timing versus eye-art quality

**Status:** review-only, not an automatic animation-quality pass.
**Evidence date:** 2026-11-07.
**Sample:** locally imported MIT-licensed RevStudio/Rev2D Hana illustration, with manually revised experimental half/closed eyelid drawings. Original imported actor remains **unapproved**.

## Two complementary diagnostics

To inspect the exact opacity thresholds:

~~~powershell
node dist/cli/index.js character qa blink avatars/portrait
~~~

This samples 13 real Rev2D states (including `EyeOpen=0.19` and `0.69`), mirrors them into a 25-frame sequence, and writes full/eye crop montages and a JSON motion report. Frame adjacency is **not** a realistic clock.

To test a synthetic **time-domain** blink at a real video frame rate:

~~~powershell
node dist/cli/index.js character qa blink avatars/portrait --timed
~~~

This outputs a 36-frame, 30 FPS, 1.2-second H.264 video and a 6×6 visual contact sheet. Frame `n` is sampled at exactly `n/30` seconds. The fixed control schedule is 250ms open lead-in, 140ms closing, 65ms closed hold, 240ms reopening, and an open tail. Ease-in/ease-out is deterministic. For repeated identical control values, the tool reuses the exact previous PNG rather than rerendering a different result. It never touches approval, models or input art.

A new unique ignored directory under `outputs/qa/blink-review/` contains `blink-timed-30fps.mp4`, `blink-eyes.png`, `blink-full.png`, `blink-review.json`, and per-frame PNGs.

**Warning:** The timing is a fixed test case, not a measured biological blink or an actual character's finished animation. Other animation speeds, FPS and control waveforms may expose different defects.

## Real 30 FPS findings

[Watch the timed Hana blink, 1.2 seconds, 30 FPS](media/hana-timed-blink-30fps.mp4)

The original experimental imported character remains unapproved. The sample video is a diagnostic using rights-cleared art, not a release-quality character demonstration.

| Test | Short fade | Stepped |
|---|---:|---:|
| 30 FPS frames | 36 | 36 |
| Unique Rev2D render states | 13 | 13 |
| Reused frames | 23 | 23 |
| Possible abrupt changes | 5 | 5 |
| Possible changed-control stalls | 5 | 5 |

**All 36 rendered PNG files were SHA-256 identical between the two methods** under this specific timing. The 0.18–0.20 and 0.68–0.70 transition bands fell between sampled frames. Neither mode could improve the actual 30 FPS output here, although the stepped version removes ghosting in deliberately sampled boundary *still images*.

This demonstrates why a static threshold comparison is not enough to justify an animation-quality claim. The bigger blocker is the **unconvincing eye geometry and half/closed drawings**.

## Rejected continuous-mesh experiments

Four isolated model variants were generated and rendered from the same imported image, without touching any tracked or approved artwork:

- **Early closed overlay** (0.11–0.20 opacity fade): kept continuous open-eye motion but produced doubled lines and translucent irises near the fade.
- **Late overlay** (0.035–0.105) and **ultra-late overlay** (0.01–0.055): moved ghosting nearer full closure but did not remove it. The underlying mesh still formed pinched/triangular lash corners.
- **Reduced upper warp** (80% displacement, 0.065–0.15 fade): altered the squeeze but did not produce natural eyelid geometry. Rejected for visible contour artifacts.

These experiments live only in ignored `outputs/qa/eye-hybrid-20261107/` and were **not** integrated as new CLI options. A mode that merely moves artifacts to different parameter values is not a sufficient fix.

## Acceptance criteria for future continuous eyelids

1. Produce a coherent, art-matched moving eyelid silhouette with the iris correctly occluded at intermediate positions.
2. Avoid double lash contours and corner pinching at all values in a slow parameter sweep, not just at 30 FPS.
3. Replay real 15/30/60 FPS performance timelines and compare actual frames across several rights-cleared drawing styles.
4. Preserve the original character's linework and colors, and require explicit human review. No code metric alone may mark an avatar approved.

The next engineering target is **quality-controlled intermediate eyelid artwork or a proper eyelid-specific deforming rig**, not another global opacity/fade profile.
