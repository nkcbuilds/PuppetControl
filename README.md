# PuppetControl

**Open-source, agent-first 2D character animation — early development.**

PuppetControl aims to generate reusable 2D actor assets from character illustrations, animate them with Live2D-like continuous facial/body movement, extend major poses with AI-generated reusable artwork, and let Claude Code/Codex direct scenes from scripts and voiceover.

**Main principle:** Generate the artwork when needed; animate it repeatedly without regenerating every video frame.

## Current status

The project is in the **architecture and rig-engine evaluation stage**. The CLI, compiler, video renderer and automated pose pipeline described in the specification are planned capabilities, **not yet available to users**.

- [Technical concept and architecture](docs/TECHNICAL_CONCEPT.md)
- [Implementation milestones and acceptance tests](docs/IMPLEMENTATION_PLAN.md)
- [Architecture decisions](docs/DECISIONS.md)
- [Agent working instructions](AGENTS.md)

## Target workflow (planned)

~~~text
reference image + optional layered art
            ↓
validated base rig + reusable pose families
            ↓
audio / script → semantic performance timeline
            ↓
continuous character animation + safe pose transitions
            ↓
video compositor + FFmpeg
            ↓
editable project + MP4
~~~

Our first engineering target is a verified animation rig with smooth head/face movement driven by timestamped parameters; a complete on-demand AI pose generator is deliberately later.

## Contributing

Initial implementation follows the agentic build plan. Small focused issues/PRs with tests, reproductions and visual evidence are preferred. No proprietary sample media or API secrets should be submitted.

## License

MIT for PuppetControl-authored code and documentation unless otherwise specified. Third-party engines, model weights, artwork and binaries have their **own** licenses.
