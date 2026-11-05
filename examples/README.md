# Examples

The example character manifest and scene here are **schema-only fixtures**. They do **not** include an actual rig or artwork; the names and pretend bridge-clip string demonstrate validation semantics only.

Use: npm run dev -- scene validate examples/scenes/intro.json

The Rev2D-backed Hana example in examples/characters/hana and examples/scenes/hana-preview.json supports real continuous rig previews when the pinned local Rev2D checkout is installed. Run npm run rig:setup, then npm run demo:render. No sample illustration is copied into our repository; Rev2D supplies the example rig in the ignored local checkout. Camera, audio, captions, and distinct pose-family rendering are still unsupported.
