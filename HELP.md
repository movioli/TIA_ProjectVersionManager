# TIA Project Version Manager - User Help Guide

Welcome to the TIA Project Version Manager. This guide explains the core features, general usage, and prerequisites for using the software successfully.

---

## 1. Initial Setup

Before you can snapshot or compare projects, you need to configure the **Working Directory**:
1. Click the **Gear icon (⚙ Settings)** at the bottom-left of the sidebar.
2. Under **Working Directory**, click **Browse...** and select the parent folder where your active TIA Portal project folders are located.
3. The application will store version snapshots in a hidden `_snapshots/` folder inside this directory.

---

## 2. Managing Groups and Projects

### Adding a Project
1. Click the **`+`** button at the top of the sidebar.
2. Click **Browse...** to select your TIA Portal project file (`.ap14`, `.ap15`, `.ap16`, `.ap17`, `.ap18`, `.ap19`, `.ap20`, etc.).
3. Under **Group Path**, optionally enter a path segment (e.g., `Factory A/Line 1`) to nest the project inside folders.
4. Choose whether to **Copy** the project into your workspace or **Move** it there directly.
5. Click **Add Project**.

### Creating Groups
- You can right-click any empty space in the sidebar and choose **📁 Add Group...** to create root folders or subfolders. 
- You can drag-and-drop projects directly into these folders to group them.

### Renaming and Deletion
- Right-click any project or group in the sidebar to open the context menu. You can rename them, open their source folders in Windows Explorer, open them directly in TIA Portal, or delete them.

---

## 3. Snapshots and Backups

### Taking a Snapshot
1. Select a project in the sidebar.
2. Click **Take Snapshot** in the top-right toolbar.
3. Choose a custom **Label** (e.g. `V1.0 - Baseline`), pick a color-coded tag, and add optional notes.
4. Click **Create Snapshot**.

### Restoring a Version
1. Select a snapshot card in the main panel.
2. Click the **Restore** button.
3. By default, the app creates an automatic backup snapshot of your current project state before overwriting it.

### Cleaning up snapshots
1. Open **Cleanup Snapshots** in the sidebar.
2. Filter with **Older than** (days / weeks / months / years) and optionally a single project.
3. **Keep newest N per project** is on by default so recent snapshots stay protected.
4. Select rows, then **Delete selected** — or **Keep selected** to delete everything else in the current filtered list.

---

## 4. Comparing Versions & Semantic Diffing

### Initiating a Comparison
1. Select the checkboxes on **two** different snapshots in the version list.
2. Click **Compare Selected** in the top-right toolbar.

### Generating Semantic Diffs
1. Under the comparison screen, click **Generate Semantic Diff**.
2. This headlessly launches the TIA Portal Openness exporter. *(Note: First-time export can take 1–2 minutes to compile and extract blocks).*
3. Once the export is complete, a tree view of all PLC blocks (OBs, FCs, FBs, DBs) will appear.
4. Click on any block to see a precise inline diff. This diff discards timestamp/UID noise to focus purely on SCL code and interface changes.

### Open in Compare Tool (SACT)
- If you have configured the **SIMATIC Automation Compare Tool (SACT)** path in Settings, you can click **Open in Compare Tool** in the diff viewer to launch a native side-by-side Siemens comparison of the selected block.

---

## 5. Prerequisites & Troubleshooting

If project exports or TIA Portal features fail, ensure:
1. **TIA Portal Openness** is installed on your machine.
2. Your Windows User Account is added to the local **"Siemens TIA Openness"** user group. *(You must log out of Windows and log back in for this group membership to take effect).*
3. The TIA Portal project file you are trying to export is not currently locked or open in another program.
