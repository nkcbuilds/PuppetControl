# Character review: from flat PNG to a reusable actor

This is a **guided visual-correction workflow**, not a one-click promise. PuppetControl can import a front-facing PNG and prepare a Rev2D rig, but source landmarks and sprite artwork may need manual or agent-assisted repairs. **Never approve a rig merely because a CLI validation or pixel report passes.**

## 1. Import, annotate and build

Run commands inside the PuppetControl workspace:

~~~powershell
node dist/cli/index.js character import art/portrait.png --out avatars/portrait --id portrait
node dist/cli/index.js character landmarks assist avatars/portrait
node dist/cli/index.js character build avatars/portrait
~~~

Inspect `avatars/portrait/work/grid.png` and the accepted `avatar.json` landmark overlay. Correct any erroneous eyes, neck, head or body pivot before building. Use the existing staged landmark-proposal workflow for agent-proposed points. Imported actors remain `approved:false`.

## 2. Request optional real eyelid and mouth drawings

When flat-image eyelid deformation is visibly wrong:

~~~powershell
node dist/cli/index.js character variants request avatars/portrait eyes_closed eyes_half mouth_a
node dist/cli/index.js character variants status avatars/portrait
~~~

The requests produce PNG masks and text instructions under `variant-requests/`. Provide **full-canvas PNGs** at `variants/eyes_closed.png`, `variants/eyes_half.png`, etc. Modify only the mask area, match the original skin/outline pixels at the seam, and keep the rest of the character byte-for-byte visually consistent. The validator rejects many unchanged or misaligned edits but cannot tell if eyelashes look natural.

Only after locally reviewing the submitted artwork, import the selected IDs:

~~~powershell
node dist/cli/index.js character variants import avatars/portrait eyes_closed eyes_half --reviewed-art
~~~

An **optional** short-fade experiment can reduce double contours by narrowing sprite opacity blends. It is not always smoother and may make the eyelids pop:

~~~powershell
node dist/cli/index.js character variants import avatars/portrait eyes_closed eyes_half --experimental-short-fade --reviewed-art
~~~

Another **opt-in, sharp-switch** experiment avoids showing two eyelid drawings simultaneously. It removes the sampled translucent/double-lash effect in the Hana trial, but **introduces abrupt eye-pose jumps** and is *not* a smooth blink:

~~~powershell
node dist/cli/index.js character variants import avatars/portrait eyes_closed eyes_half --experimental-stepped-eyes --reviewed-art
~~~

Choose **only one** experimental profile. Every import revokes earlier approval, regenerates review sheets and refreshes fingerprints. See [EYE_TRANSITIONS.md](EYE_TRANSITIONS.md) for the actual rendered comparison and trade-offs.

## 3. Inspect exact blink transition frames

~~~powershell
node dist/cli/index.js character qa blink avatars/portrait
~~~

This produces an **ignored, uniquely named** directory under `outputs/qa/blink-review/` with `blink-full.png`, `blink-eyes.png`, `blink-review.json` and the individual PNG frames. The 25-frame sequence samples closed/open and both short-fade transition boundaries, including `EyeOpen=0.19` and `EyeOpen=0.69`. Thirteen actual Rev2D states are rendered; the remaining twelve are the same states in reverse order. Review the montage left-to-right, top-to-bottom.

To check what an actual video frame rate samples, also run `node dist/cli/index.js character qa blink avatars/portrait --timed`. This generates a separate 36-frame, 30 FPS synthetic blink MP4 and 6×6 contact sheet without approving or modifying the character. The default 25-frame parameter sweep remains available for narrow threshold defects. See [EYE_TIMING.md](EYE_TIMING.md): the old short-fade and stepped rigs gave all 36 **identical rendered frames** for one tested blink schedule despite different boundary stills.

The JSON report lists candidate motion stalls, frame changes, sampled controls and crop coordinates. **None of those statistics establish good visual quality.** Scrutinize both eyelids for lingering lashes, matte seams, iris clipping, mismatched shadow/color and sudden double contours. Inspect the existing `review/eyes.png`, `review/mouth.png`, `review/turn.png` and `review/poses.png` too. If eye annotations are unavailable, specify `--region x,y,width,height` explicitly.

## 4. Approve only after actual visual review

Only when all relevant states look acceptable, run:

~~~powershell
node dist/cli/index.js character approve avatars/portrait --reviewed
node dist/cli/index.js scene new .cache/portrait-first.json --character avatars/portrait/character.json --seconds 12 --fps 15
node dist/cli/index.js scene validate .cache/portrait-first.json
node dist/cli/index.js scene render .cache/portrait-first.json --out outputs/portrait-first.mp4
~~~

Approval records a **user acknowledgement**, not proof of visual suitability. Changing source art, landmarks, rig or textures invalidates the verified build record. Any new variant import resets approval.

## What the actual Hana trial proves

On 2026-11-07, the short-fade Hana trial retained valid source/rig fingerprint integrity but **remained unapproved**. A 25-frame blink review rendered successfully, found control-motion plateaus and showed unnatural skin-tone patches and doubled eyelid contours at transition frames. The short-fade profile reduced one type of overlap but did not repair the underlying drawings. The ability to detect and inspect these issues is real; attractive universal blinking from arbitrary flat illustrations is still an open milestone.

The latest imported-character build uses deliberately smaller head/eye look amplitudes; configure the specific character after inspecting the head and gaze sheets, as described in [LOOK_MOTION.md](LOOK_MOTION.md). Small limits do not repair torn eyelid sprites or certify visual suitability.

Future work: human-quality intermediate eyelid drawings, properly reviewed eye/head motion envelopes across styles, additional licensed character styles and realistic mouth/voice assessment.
