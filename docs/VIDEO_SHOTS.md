# Shot framing and widescreen exports (experimental)

PuppetControl now composes restrained camera zooms into the MP4 export without regenerating the character rig. Rev2D renders the native canvas; FFmpeg applies crop/zoom and optional aspect-preserving output scaling.

## Declarative camera events

- wide — 1.00× framing
- medium — 1.12× framing
- close-up — 1.34× framing
- punch-in — increases zoom by amount (default +0.08) with a short eased move
- cut — required marker for incompatible body rigs; never itself changes the crop or hides a body switch

For a same-frame intentional editing cut:

~~~json
{ "atMs": 2000, "kind": "camera", "name": "cut" },
{ "atMs": 2000, "kind": "camera", "name": "medium" },
{ "atMs": 2000, "kind": "pose", "actor": "hana", "name": "pointing", "transition": "cut" }
~~~

To tighten framing:

~~~json
{ "atMs": 5150, "kind": "camera", "name": "punch-in", "amount": 0.09, "durationMs": 600 }
~~~

A medium/close-up/punch-in event without a same-time cut uses a 350ms ease by default. Overlapping camera moves are rejected and must be adjusted in the scene timeline.

### Source canvas vs output canvas

The rig must match native scene resolution, e.g. 512×640. Presentation is independently configurable:

~~~json
"resolution": { "width": 512, "height": 640 },
"output": { "width": 1920, "height": 1080, "background": "#ede8f1" }
~~~

The 1080p video preserves the source proportions with padding; it does not add source artwork detail. A zoom crops the input and changes visual framing.

## Reproduction

~~~sh
npm ci
npm run rig:setup
npm run demo:poses
npm run demo:directed
~~~

Produces outputs/hana-directed-1080p.mp4, a silent 6.53-second 98-frame H.264 clip with three different body postures, two intentional hard-cut boundaries, and a final eased punch-in.

The generated demo uses Rev2D Hana art under MIT; see THIRD_PARTY_NOTICES.md.

## Limitations

- Camera reframing improves edited-shot readability but does **not** animate the arms between poses. Body changes still jump at cuts.
- PNG preview files are pre-camera; inspect MP4 for shot framing.
- Fixed crop anchor optimized for center-framed talking bust characters, no dynamic subject tracking.
- Not intended to replace a multi-camera video editor or generate dramatic complex shots.
- No caption overlays, B-roll, background cuts or full scene compositor yet.
