# Experimental continuous arm gesture (Rev2D)

**Status:** tested prototype. A single rig can rotate an arm through intermediate geometry on a 300ms semantic pose transition. This is **not** full-body skeletal animation or automatic AI rigging.

## Why this is important

Earlier, neutral and pointing were different independently drawn body rigs. A camera cut was necessary to switch without inventing broken mesh interpolation.

The new Hana gesture rig demonstrates a narrower but genuinely smooth path:

- Extend the pinned RevStudio/Rev2D Hana sample with two articulated bones: shoulder and elbow.
- Attach sleeve artwork to the shoulder bone and forearm/hand artwork to the elbow bone.
- Add 0..1 named parameters: ArmRaise rotates the upper arm from 90° (down, mostly covered by blouse) to 0° (pointing right); ElbowExtend rotates the forearm from -50° (tucked) to 0° (straight).
- Author two pose-family records, neutral and pointing, that refer to the **same rig file**, and provide matching parameter presets.
- Our timeline planner emits an actual 300ms interpolate segment; Rev2D samples 10 real intermediate frames at 30fps.
- The compiler converts the semantic pose event into continuous ArmRaise and ElbowExtend curves. No opacity crossfade, no new full-body image at each frame, no unrelated mesh interpolation.

The demo also includes a separate crossed-arms body pose that **still requires a hard cut and camera reframe**.

## Reproduce

~~~sh
npm ci
npm run rig:setup
npm run demo:gesture
npm run demo:gesture-cycle
~~~

These commands generate neutral, pointing, crossed-arms and gesture models under ignored examples/characters/hana/rigs. The first renders outputs/hana-gesture-1080p.mp4 with a final hard cut. The second renders outputs/hana-gesture-cycle.mp4: a 5-second, 30-fps test raising and lowering the same arm twice with **no pose cuts**.

To examine the actual pose interpolation inside Rev2D:

~~~sh
node .cache/rev2d/bin/rev2d.js validate examples/characters/hana/rigs/gesture.r2d.json --json
node .cache/rev2d/bin/rev2d.js render examples/characters/hana/rigs/gesture.r2d.json -o outputs/arm-half.png --param ArmRaise=0.5 --param ElbowExtend=0.5 --ss 1 --json
~~~

The experimental model is deterministically derived from the exact pinned Rev2D commit specified in scripts/build-demo-gesture.mjs. The complete rig JSON and all third-party art remain ignored rather than being published in the repo. See THIRD_PARTY_NOTICES.md.

## Scene authoring

The character has two pose-family records using the same model path and rig identity:

~~~json
{ "name": "neutral", "rigId": "hana-arm-gesture", "modelPath": "rigs/gesture.r2d.json", "approved": true },
{ "name": "pointing", "rigId": "hana-arm-gesture", "modelPath": "rigs/gesture.r2d.json", "approved": true }
~~~

And a parameter preset map:

~~~json
"posePresets": {
  "neutral": { "ArmRaise": 0, "ElbowExtend": 0 },
  "pointing": { "ArmRaise": 1, "ElbowExtend": 1 }
}
~~~

A scene then requests:

~~~json
{ "atMs": 2000, "kind": "pose", "actor": "hana", "name": "pointing", "transition": "interpolate" }
~~~

The engine verifies that interpolated poses use the same rig and have both parameter presets. A preset can omit a numeric control: that control resets to the rig's declared default rather than inheriting the previous pose's value. A non-neutral default pose also initializes its controls at t=0 even if the scene has no explicit pose event. Otherwise, a same-rig transition cannot be rendered as a continuous gesture.

## Actual validation

- Rev2D validates the new gesture rig with 0 warnings and 0 errors.
- Rendered native samples with both joint controls at 0, 0.25, 0.5, 0.75 and 1; inspected head consistency and sleeve/arm movement visually.
- Rendered a 6.5-second 1920×1080/30fps video with 195 frames and three character pose states.
- Re-rendered a 5-second 1920×1080/30fps/150-frame cycle with four reversible 300ms pose transitions and inspected sample frames at raised/lowered endpoints.
- Test suite covers frame-accurate 300ms interpolation, both joint-control curves, reversibility, rejection of missing controls, and prohibition of interpolation between unrelated rig assets.

## Visual limitations

- The demo arm is simplified vector artwork with separate shoulder and elbow rotation, not a production skin/mesh rig. Convincing shoulder anatomy and deformation still need better art/weights.
- Suppressing the static sleeve outline reduces, but does not completely solve, the flat shoulder silhouette during intermediate frames.
- The late crossed-arms pose switch is an intentional camera cut, **not** a smooth physical transition.
- This proves the control/renderer architecture; it is not evidence that arbitrary user-supplied images can be auto-rigged flawlessly.
