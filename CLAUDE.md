# Claude Instructions for TIA Project Version Manager

## Session Start
Read these files before doing any work:
- `memory/decisions.md` — architectural decisions and rationale
- `memory/people.md` — stakeholders and their context
- `memory/preferences.md` — code style and collaboration preferences
- `memory/user.md` — user profile and background

## Session End
After completing work, update the relevant memory files if:
- A significant architectural or design decision was made → `decisions.md`
- New information about collaborators was learned → `people.md`
- The user corrected your approach or expressed a preference → `preferences.md`
- You learned something new about the user's context or background → `user.md`

Only update what changed. Do not rewrite entries that are still accurate.

## Project Overview
Electron desktop app for managing TIA Portal project snapshots.
- Entry: `src/main/main.js`
- Renderer: `src/renderer/index.html` + `src/renderer/js/app.js`
- Preload: `src/renderer/preload.js`
- Run: `npm start`

## Key Constraints
- No runtime npm dependencies (Node built-ins only)
- Windows only (personal use)
- Data in `%APPDATA%/TIAVersionManager/`
- Keep changes minimal and focused — no speculative features
- TiaExporter must use `ExportOptions.None` (not `WithDefaults`) — `WithDefaults` inflates FBD blocks and crashes SACT's JavaScript XML parser
- Some FBD blocks in this project are genuinely 14 MB / 250K lines. `ExportOptions.None` is already the minimum — there is no way to reduce export size further. SACT will crash on these; the `tooLarge` inline diff message is the correct handling. Do not attempt XML post-processing.
- `src/main/diff-engine.js` has a `MAX_DIFF_LINES = 20000` guard and `src/main/text-differ.js` has a dynamic `maxD` memory-budget guard in `myersDiff`. Both are intentional OOM safeguards — do not remove them.
- `src/main/ipc-handlers.js` has an in-memory `compareResultCache` Map that caches `diff:compareXml` results for the session. Invalidated on export regeneration and version deletion.
