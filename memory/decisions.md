# Architectural & Design Decisions

<!-- Log key choices made during development: what was decided, why, and what alternatives were rejected. -->

## 2026-03-15 — Initial project setup
- Electron (no framework) chosen for desktop-native feel and direct filesystem access.
- No runtime npm dependencies: only Node built-ins to keep the app portable and avoid supply-chain risk.
- Data stored in `%APPDATA%/TIAVersionManager/` so user data survives app reinstalls.
- Snapshots stored as full file copies (not deltas) for simplicity and reliable restore.
- Atomic store saves (write .tmp → rename) to prevent data corruption on crash.
- Frameless window with custom title bar for Obsidian-style aesthetic.

## 2026-04-29 — Myers diff OOM fix

**Problem:** Comparing two XML export snapshots (2787 files, some FBD blocks 250K lines / ~14 MB) caused a fatal `CALL_AND_RETRY_LAST Allocation failed` JS heap crash. The Myers diff `trace` array stores one full `v`-array snapshot (`2*(n+m)+1` elements) per edit step — on a 250K-line input that blows several GB.

**Solution — two guards, defence-in-depth:**
- `src/main/diff-engine.js` — `MAX_DIFF_LINES = 20000`: if the combined extracted-logic line count of two XML files exceeds this, skip Myers diff entirely and return `{ tooLarge: true }`. This is the primary guard.
- `src/main/text-differ.js` — dynamic `maxD` in `myersDiff`: compute maximum allowable edit steps before the trace exceeds 256 MB (`Math.floor(256MB / ((2*max+1) * 4))`). Return `null` if exceeded (caller maps to `tooLarge`). This is the safety net.
- `tooLarge` flag propagated: `diffXmlFiles` → `compareXmlExports` → IPC payload → renderer.
- `src/renderer/js/components/modals/modal-diff.js` — renders "Block is too large to diff inline (X / Y lines). Use Open in Compare Tool." when `block.tooLarge` is set.
- `package.json` start script — `NODE_OPTIONS=--max-old-space-size=4096` as belt-and-suspenders.

**Do not remove these guards.** The project has naturally giant FBD blocks that will always trigger them.

---

## 2026-04-29 — In-memory compare result cache

**Problem:** `compareXmlExports` takes significant time on 2787 files. Closing and reopening the diff modal re-ran the full comparison from scratch.

**Solution:** Module-level `compareResultCache = new Map()` in `src/main/ipc-handlers.js`.
- Cache key: `[versionIdA, versionIdB].sort().join('|')` (order-independent)
- Cache hit: return payload immediately, `compareXmlExports` never called
- Invalidate on:
  - `diff:generateXmlExport` (new export makes prior compare stale)
  - `versions:delete` (version no longer exists)

**Intentionally in-memory only.** Result blobs can be 3–100 MB — too large for app-data.json. Disk persistence across restarts is deferred.

---

## 2026-04-29 — XML export size is a hard ceiling

**Finding:** `ExportOptions.None` (already in use) is the minimum possible option from TIA Openness. Some FBD blocks are genuinely 14 MB / 250K lines because every graphical FBD element (contact, coil, call, wire) is an XML node. `WithDefaults` would be even larger.

**Consequence:** SACT crashes on these blocks regardless. Stripping XML post-export (comment/title elements) saves <3% for files this large and is not worth the complexity. The `tooLarge` inline diff message is the correct and final handling. Do not revisit this.

---

## 2026-04-23 — ExportOptions.None for TiaExporter

### SACT compatibility fix
- `TiaExporter.cs` changed from `ExportOptions.WithDefaults` to `ExportOptions.None`.
- Root cause: `WithDefaults` makes TIA Portal include every default attribute value, inflating FBD blocks to 7–8 MB. SACT 1.4 uses a synchronous JavaScript SAX parser that fails to build a DOM tree for files this large — the "done" event never fires, the parsed document is null, and SACT shows "The files being compared are not common block types".
- `ExportOptions.None` exports only essential content (Interface + CompileUnits/NetworkSource). FBD blocks drop to a few hundred KB — well within SACT's parser limits.
- SCL blocks were unaffected because they stay small regardless of export option.
- Our diff engine (`extractBlockLogic`) reads Interface and NetworkSource, both always present with `None`, so diffs are unaffected.

## 2026-04-22 — v1.2.0 features

### Open in TIA Portal
- Added `project:openInTia` IPC handler. Scans the given folder for a `.apXX` file, uses `pickInstallation()` from `tia-detector.js` to find a compatible TIA Portal exe, and spawns it detached.
- Exposed on both snapshot cards (`version.snapshotPath`) and sidebar project items (`project.sourcePath`).

### Restore backup opt-out
- `restoreVersion()` in `snapshot-manager.js` now accepts `createBackup = true`. The entire auto-backup block is conditional on it.
- UI: checkbox in `modal-restore-confirm.js`, checked by default, threaded through preload → IPC → backend.

### Restore highlight (current snapshot)
- Project objects now carry `lastRestoredVersionId` and `lastRestoredAt` (set in `restoreVersion()` after copy completes).
- `version-list.js` computes `highlightId`: if the newest snapshot was created after `lastRestoredAt`, highlight the newest; otherwise highlight `lastRestoredVersionId`; if no restore ever, highlight `versions[0]`.
- CSS class `.version-card.current-version` — accent left-border + 6% accent tint on background.

### Version list refresh after restore
- Fixed: `modal-restore-confirm.js` now calls `updateProjectVersions(project.id, updated.versions)` after `setProjects()`, which fires `state:versions-changed` and triggers an immediate re-render.

### Build — winCodeSign cache workaround
- `npm run build` fails on this machine because electron-builder can't extract the winCodeSign-2.6.0.7z archive (macOS symlinks require Developer Mode or admin).
- Workaround: manually extract the archive into `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0\` once, then electron-builder uses the cached copy on all subsequent builds.
- Command used:
  ```
  7za.exe x -y -snl <any winCodeSign .7z from Cache\winCodeSign\> -o<Cache\winCodeSign\winCodeSign-2.6.0>
  mv <Cache\winCodeSign\<number>> <Cache\winCodeSign\winCodeSign-2.6.0>
  ```
- Only needs to be done once per machine (or after clearing the electron-builder cache).

### TiaExporter.exe — asarUnpack fix
- `TiaExporter.exe` was packed inside `app.asar` and couldn't be spawned (ENOENT at runtime).
- Fix 1: `package.json` build config — added `"asarUnpack": ["src/shims/TiaExporter/TiaExporter.exe"]` so the exe lands in `app.asar.unpacked/`.
- Fix 2: `openness-exporter.js` line 12 — path now replaces `app.asar\` with `app.asar.unpacked\` at runtime.
- Released as v1.2.1 (no other changes from v1.2.0).

---

## 2026-07-03 — Settings window & Compare Tool updates
- Removed "Argument template" settings UI field. Hardcoded tool arguments to standard default `"{pathA}" "{pathB}"`.
- Kept the manual Compare Tool path picker. Added recursive folder auto-detection scanning standard Siemens directories for `ACTool.exe` and `Siemens.Automation.CompareTool.exe` to act as a fallback when no path is manually configured.
- Displayed app version (obtained from Electron main process `app.getVersion()`) at the bottom of the Settings modal.
- Added a new `HELP.md` user guide explaining initial configuration, group/project management, snapshots, block comparisons, and troubleshooting.
- Added **View README** and **Open Help Guide** shortcut buttons to the Settings modal. Rather than launching external Notepad instances, they asynchronously load file text and render them inside the app using a lightweight, zero-dependency regex Markdown parser (`modal-markdown.js`).
- Styled `.markdown-body` elements inside `modals.css` to match the app's Obsidian dark mode design. Intercepted link clicks in parsed documents to open external URLs in default browsers and local paths in file explorer safely via IPC.
- Modified `package.json` build files array to include `"README.md"` and `"HELP.md"` so they are properly bundled by `electron-builder` in installer production builds.
