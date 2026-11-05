# Hana demo pose rigs

The three rigs and PNG previews in this directory are **generated outputs**, not source-controlled assets.

Run:

~~~sh
npm run rig:setup
npm run demo:poses
npm run demo:multipose
~~~

scripts/build-demo-poses.mjs derives neutral, pointing, and arms-crossed models from the exact pinned upstream Rev2D Hana example. It adds deliberately simple vector limbs while preserving the original face, head, animation parameters, physics and base rig.

**Visual limitation:** These are proof-of-concept posture drawings, not hand-animated arm transitions. The current renderer deliberately accepts only an explicit shot cut between these different rigs. The resulting body switch is abrupt within the same fixed camera frame; convincing bridges/shot composition remain future work.

The original Hana rig is copyright © 2026 RevStudio and distributed under the MIT License:
https://github.com/RevStudio/Rev2D/blob/main/LICENSE

No upstream rig model or artwork is bundled into PuppetControl's Git repository. Generated variants inherit upstream license obligations if redistributed.
