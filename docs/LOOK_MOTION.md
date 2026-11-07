# Authoring reviewable head and eye movement

PuppetControl's semantic scene `look` event uses normalized **screen-space** coordinates: `x=1` looks right, `x=-1` looks left, `y=1` looks **down**, and `y=-1` looks **up**. Both the head and irises follow the same direction. Rev2D itself declares positive `AngleY` and `EyeBallY` as up, so the compiler reverses both when scene `y` is positive.

## Per-character look limits

An imported single-image actor gets conservative **starting amplitudes** in its generated `character.json`:

~~~json
"lookLimits": {
  "headYawDegrees": 8,
  "headPitchDegrees": 5,
  "eyeX": 0.2,
  "eyeY": 0.2
}
~~~

The property lives inside the `render` object, alongside `expressionPresets`. These are **only intensity limits, not quality scores or proof of approval**. A character may still have broken eyelids, detached hair or an ugly neck at an 8-degree head turn. Always inspect actual pose sheets and video.

Before this feature, a `look` event at the extremes drove `AngleX=±22`, `AngleY=±12`, `EyeBallX=±0.5`, and `EyeBallY=±0.5`. Existing fully authored or upstream pre-rigged actors without `render.lookLimits` keep these original amplitudes. Previous provenance-tracked flat-image imports that lack the new field automatically use the conservative imported profile at render time. New `character build` manifests include the values explicitly.

All four limits are mandatory when the object is present. They are independently customizable in `character.json`, but can only **decrease** from the wider pre-rigged defaults. Setting any limit to `0` disables that channel for semantic `look` events. `character inspect <character.json>` shows the currently applied values and whether they came from the manifest, imported fallback, or legacy pre-rigged fallback.

For example, `look: { x: 0.5, y: -0.25 }` with the imported profile compiles to `AngleX=4`, `AngleY=+1.25`, `EyeBallX=+0.1`, `EyeBallY=+0.05`. The keyframes are eased over the event's specified duration, and expressions/mouth cues are unaffected.

## How to judge a setting

1. Render the imported character's head turn and gaze review sheets, and inspect small and extreme positions. Check for iris clipping, asymmetry, detached hair, shifting neck outlines and unintended background movement.
2. Start with the small imported amplitudes and only increase a channel after comparing actual frames of the same character. Reduce or disable channels that fail.
3. Use two `look` events in an editable scene, then render the whole transition at the target FPS. A clean endpoint does not prove intermediate frames are smooth.
4. **Keep the avatar unapproved** when any required pose is visually unacceptable. Altering the authored look configuration after approval warrants renewed review; the present asset hashes track PNG/landmarks/model/textures, not arbitrary manifest settings.

On 2026-11-07, the reviewed **experimental, unapproved** Hana import was directly rendered at yaw 22°/8°, pitch 12°/5° and gaze 0.5/0.2. The small states remain recognizable and exhibit less drastic movement, but the character still has unacceptable eyelid art and does not pass visual acceptance. The preview outputs are ignored under `outputs/qa/look-envelope-20261107`.

## Current boundary

This is a deliberate constraint on *how far* existing rig controls move. It does not create new eye sprites, compensate 3D head parallax, decompose layers or invent a physically believable pose transition. Per-character values are editable human/agent authored metadata; future work should associate a motion envelope's approval with its reviewed frame evidence.
