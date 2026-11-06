# PuppetControl — Deep visual quality and reliability audit

**Date:** 2026-11-07. **State:** verified experimental rigging pipeline, NOT universal production-ready animation.
**Engine:** pinned Rev2D (f144581cdf1f12d781379c4df90d262b8c2dfa3d).
**Reference:** licensed Rev2D Hana 512 × 640 illustration plus two independent Codex-derived landmark proposals.

## 1. Actual pipeline

1. Source PNG is validated and copied. A coordinate grid and an initially incomplete landmark specification are prepared. Original image pixels are not overwritten.
2. An optional authenticated Codex call observes the PNG/grid and proposes landmark coordinates. The file and model task leave the machine if this option is invoked; use the manual agent path if local-only privacy is required.
3. Proposals are SHA-256 bound to the source and limited to geometry fields. Safe schema-format normalizations are recorded, while upstream Rev2D validation and an overlay are performed in an isolated staging directory. No auto-approval occurs.
4. Rev2D decomposes eye/mouth layers, inpaints the underlying canvas and builds head, blink, gaze, mouth and body parameter controls. It approximates a 2D head turn, not 3D anatomy or fully occluded views.
5. Build generates pose sheets. The user/agent inspects the actual eyelids, face, mouth, neck, hair, clothing and seams in several extreme parameter states.
6. PuppetControl compiles semantic scenes to existing rig parameters and Rhubarb-derived visemes; incompatible body-pose families require an explicit edit/cut, not an unsafe mesh blend.
7. The renderer produces deterministic PNG frames and H.264 video with optional AAC voice. MP4 cannot preserve alpha; intermediate frames are now composited onto the configured scene background (default #f0eaf4) rather than letting transparent warped margins encode as black.
8. New integrity protections record SHA-256 hashes for source PNG, accepted landmarks, model and generated textures. Scene preflight rejects changed/missing assets and untracked alternate pose models, while force rebuilding revokes prior approval before model/texture mutation.

## 2. What three Hana experiments actually demonstrate

| Observation | Manually annotated | First Codex attempt | Second Codex attempt |
| --- | --- | --- | --- |
| Source, rig and review sheets | Built | Built | Built after four explicit format-only corrections |
| Iris landmarks | Present | Absent | Present |
| Body pivot Y | 417 | 628 | 610 |
| Body fade Y interval | 365–465 | 602–640 | 598–640 |
| Rest identity | Very close to source | Not independently benchmarked | Very close to source |
| Blink quality | Not perfect | Obvious artifacts | Visible eyelid artifacts |
| Character approved for production? | No | No | No |

Measured full-frame rest-pose RGB mean absolute error is about **0.72 / 255** for both the manually annotated and second model-generated Hana rig, and about **2.9% of pixels** have any RGB channel difference above 10. This supports good *rest-pose preservation* on Hana only.

Within small source-geometry eye regions, gaze-right versus gaze-left rendered RGB mean absolute differences were approximately **14.8–22.0 / 255**, while closed-eye versus source differences were **33–45 / 255**. These numbers prove parameters change pixels; they do **not** prove anatomically convincing gaze or blinking. Actual inspection shows artifacts. Thresholds must be calibrated on a diverse artwork set; a simple pixel-difference score can reward ugly deformation.

The new geometry triage flags both AI body-pivot/bust-fade errors, plus missing or impossible iris coordinates. It leaves the manually validated Hana reference unflagged. These are **warnings**, not an automatic art-quality verdict.

## 3. Concrete defects / readiness risks

| Priority | Risk | Current treatment |
| --- | --- | --- |
| P1 | A crashed force rebuild can overwrite model files while retaining an old approved manifest | Fixed: revoke approval *before* calling the engine and use unique temporary manifest paths |
| P1 | Manual edits to source, landmark file, model or texture invalidate the earlier review, but manifests can still say approved | Fixed for new imported actors: build fingerprints checked by scene preflight and direct rendering; additional untracked pose models are rejected |
| P1 | Out-of-position body pivot/fade and absent eye iris pass structural validation | Geometry triage warns; review still required |
| P1 | Transparent mesh-edge pixels were encoded as black border lines by H.264 | Fixed for the reproduced Hana scene: Rev2D now composites onto the scene background; black-border frames decreased from 29/60 to 0/60 |
| P1 | Eyelid closures can smear lashes or reveal duplicate outlines | Not fixed: use reviewed drawn eye variants or repair the upstream eye matte |
| P1 | Sudden morph between incompatible rigs can create double limbs / broken topology | Disallowed; use compatible deformation or explicit editorial cuts |
| P2 | Arbitrary style/occlusion robustness is unknown | Need an art-style dataset and failure tracking |
| P2 | Head turn approximates 3D from a flat picture | Accept constrained yaw/pitch; provide separate artwork for radically different views |
| P2 | Model analysis/runtime speed varies by art complexity and machine | Benchmark on several images at native resolution and 1080p video |
| P2 | Unit tests do not judge aesthetic results | Need visual QA checkpoints and reviewer sign-off |

### Border-seam root cause and verified fix

The first four-second Hana render showed a thin black top-edge line in **29 of 60 frames**. Inspection of the intermediate PNGs showed actual transparent alpha-zero pixels at the canvas edge (up to 253 pixels along the top row in the last frame); the source PNG was fully opaque. FFmpeg's H.264/YUV420P encoder drops transparency and rendered those gaps black. Instead of cropping or smearing real art, we now use pinned Rev2D's existing `--bg` render setting to flatten animated frames onto `scene.output.background` or the default `#f0eaf4`. A repeat of the same 60-frame render produced **zero frames with the unexpected dark top-edge pixels and zero nonopaque pixels**. Width, frame rate and duration stayed 512×640, 15 fps and four seconds. A second three-frame test with `#ff00ff` confirmed that an explicit scene background is honored. This resolves the reproduced black-edge defect, not every possible background/seam mismatch on new artwork. Native frame previews from scene rendering are now opaque; a future dedicated transparent compositor should explicitly opt out of this flattening.

## 4. Why even valid eyes do not always close correctly

Rev2D creates eye-white, iris, upper/lower lid, lash, crease and foreground-hair layers from the open-eye illustration. Blink controls move those mattes and compress the eye opening. They cannot recreate a uniquely drawn closed-eyelid illustration that was never in the source PNG; some valid landmark boundaries still create smearing and line remnants.

**Use the engine's existing drawn-variant system instead of inventing another deformation engine.** The pinned upstream docs, section 7 of .cache/rev2d/docs/AVATAR.md, describe how variant masks and prompts for closed/half eyes and vowel mouth drawings are generated. The user/agent supplies matching artwork; Rev2D rejects global shifts, changes outside the mask, color seams and unchanged drawings, then imports the accepted eye/mouth sprites. This is the shortest credible route to more polished facial animation. It still requires correct artwork and visual review.

## 5. Definition of a dependable release

- A single original illustration never gets silently overwritten; input and accepted rig artifacts carry checked fingerprints.
- Bad or stale proposals fail closed, and every force rebuild revokes approval first.
- Geometry checks flag clearly wrong eyes, neck/body pivot and torso fade before manual acceptance.
- Closed, half-open, wink, look-left/right/up/down, multiple visemes and head yaw/pitch/tilt are rendered and **visually inspected**.
- Source color/identity, face shape, hairstyle, accessories and wardrobe remain stable across supported pose families.
- Voice alignment, output frame count, H.264/AAC streams, duration and requested resolution are verified; opaque video has no black/transparent warp-edge gaps.
- Cross-rig transitions use a real supported bridge or intentional editorial cut.
- A repeat render with unchanged inputs produces the expected deterministic frames.
- Any new rig, source, landmark or texture invalidates previous approval.
- Test on at least ten properly licensed and visually different characters, documenting real failure rates; never extrapolate from one anime avatar.

## 6. Next milestones

1. **Guarded local drawn-variant CLI added:** request/status/import supported by pinned Rev2D. Request masks for eyes_closed, eyes_half and mouth_a on a fresh 512×640 Hana import were generated and visually inspected. Importing an unchanged eyes_closed image correctly failed upstream with code `unchanged` and did not approve the character. A separate *throwaway* Hana project then accepted locally hand-procedurally-redrawn eyes_closed and eyes_half artwork (both with outsideDiff=0 and nearDiff=0); approval remained false. Actual eyes review frames showed the closed-eye lashes more continuous than the original mesh deformation, but a faint lower contour, too-flat half-open eyelids and double contours during fades remained. **These test drawings are not acceptable character art**, are only in ignored local .cache, and are not redistributed. No AI provider was used and no arbitrary-character quality claim follows.
2. **Experimental fade mitigation tested:** a 13-frame 30fps Hana blink was rendered with native opacity blending, an immediate sprite switch and a shortened fade. The opt-in `--experimental-short-fade` importer now produces the shorter blend windows after Rev2D validates the derived model, regenerates review sheets and refreshes fingerprints. At sampled `EyeOpen=0.667`, the guarded import produced the exact same PNG hash as the clean short-fade experiment; the native frame visibly had double eye outlines. The short fade changes pose faster, and can still overlap shapes within the narrow transition windows. The rig remains **unapproved**. Add image-based QA probes for rest-pose identity, blink/gaze/mouth activity, and head/neck discontinuities. Quantitative reports are triage, not automatic visual approval.
3. **Bounded pixel-QA implemented:** compare same-sized PNGs (full frame or explicit eye crop), report RGB pixel changes and unexpected opaque-border transparency. Earlier Hana calibration yielded rest RGB mean error 0.0002/255 and eye crop closed-vs-rest 33.5879/255 (36.4392% changed). Pixel changes are only diagnostic, not aesthetic approval; see [PIXEL_QA.md](PIXEL_QA.md).
5. Build a diverse rights-cleared benchmark matrix: eye size, hair over face, accessories/glasses, different skin tones and line styles, opaque versus transparent backgrounds and constrained 3/4 views. Track success/failure on each, not just demos.
6. Only after a reliable single actor: improve body-pose transitions, synchronized multi-actor shots and user-facing authoring polish.
4. **Pixel QA extended to ordered sequences:** 2–60 matching PNGs, optional eye/face ROI, declared hard-cut exemptions and actual parameter samples. The measured 512×640 Hana 13-frame blink probe at 30fps returned to its exact first image, but two intended-control intervals (3→4 and 8→9) yielded *identical* consecutive images, indicating a plateau. This is consistent with Rev2D's documented full-strength `eyes_half` sprite interval (`EyeOpen` 0.3–0.6), so it is **not** evidence of an unexpected renderer bug. The report flagged both intervals for human review, and no abrupt-change candidates were flagged. Manual inspection of the local contact sheet found overlapping outlines in intermediate blink frames (not captured by generic spike detection). See [PIXEL_QA.md](PIXEL_QA.md). Still **not** visually approved.

### Local reproduction

Run npm run rig:setup, npm run verify and npm run demo:avatar. Inspect the new local ignored .cache/avatar-onboarding/repro-* review images. To test provider inference, run the explicit Codex character landmarks propose command; source art is sent to the configured model. A valid proposal is only a candidate.

**Boundary:** No test suite or image model can promise flawless one-click rigging of arbitrary flat art with invisible anatomy. Reliability means constrained supported input, diagnostics, guided correction and refusal to approve visibly broken outputs.
