# Coding & Collaboration Preferences

<!-- Capture how Florian likes to work: code style, review expectations, communication style, things to avoid. -->

## Code Style
- Vanilla JS (ES modules), no frameworks in the renderer
- Minimal dependencies — prefer Node built-ins
- CSS via custom properties (see theme.css)

## Collaboration
- Concise responses preferred; skip lengthy preambles
- Don't over-engineer: solve the immediate problem, don't add speculative features
- Don't add comments or docstrings to code that wasn't changed
- Don't create new files unless strictly necessary

## Feature Scope
- When adding "open in external app" actions, always expose them on BOTH the snapshot cards AND the project sidebar items — not just one of the two. (Corrected during v1.2.0 planning when "Open in TIA Portal" was initially scoped to snapshots only.)
