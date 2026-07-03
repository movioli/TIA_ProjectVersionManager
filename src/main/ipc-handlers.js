const { ipcMain, dialog, shell, app } = require('electron');
const fs = require('fs');
const path = require('path');
const { generateId, copyFolderRecursive, ensureDir } = require('./utils');
const { createSnapshot, restoreVersion, deleteVersion, importSnapshot } = require('./snapshot-manager');
const { compareXmlExports } = require('./diff-engine');
const { detectTiaInstallations, pickInstallation } = require('./tia-detector');
const { exportSnapshotToXml } = require('./openness-exporter');

// key: sorted "versionIdA|versionIdB"  →  value: compare result object
const compareResultCache = new Map();

// Tokenise a compare-tool argument template and substitute real paths.
// Null-byte sentinels prevent path content (spaces, $ patterns) from
// interfering with the shell-style tokeniser. spawn() receives raw args,
// so no quoting of the substituted paths is needed.
function buildCompareArgs(template, pathA, pathB) {
  const SA = '\x00A\x00';
  const SB = '\x00B\x00';
  const withSentinels = template
    .replace('{pathA}', () => SA)
    .replace('{pathB}', () => SB);
  const tokens = (withSentinels.match(/(?:[^\s"]+|"[^"]*")+/g) || [])
    .map(t => t.replace(/^"|"$/g, ''));
  return tokens.map(t =>
    t === SA ? pathA :
    t === SB ? pathB :
    t.replace(SA, () => pathA).replace(SB, () => pathB)
  );
}

function registerHandlers(store, getMainWindow) {
  // ─── Projects ────────────────────────────────────────────────────────────

  ipcMain.handle('projects:getAll', () => store.get('projects'));


  /**
   * Import a project folder into the working directory (copy or move).
   * Returns the new project object.
   */
  ipcMain.handle('projects:import', async (_e, { sourcePath, name, mode, group }) => {
    const workingDir = store.get('settings').workingDirectory;
    if (!workingDir) throw new Error('No working directory set. Please configure it in Settings first.');
    if (!fs.existsSync(sourcePath)) throw new Error(`Source path does not exist: ${sourcePath}`);

    const projectName = name || path.basename(sourcePath);
    const normalizedSource = path.normalize(sourcePath);
    const normalizedWorkingDir = path.normalize(workingDir);

    // If the source is already inside the working directory, just register it
    const alreadyInWorkspace = normalizedSource.startsWith(normalizedWorkingDir + path.sep) ||
                               normalizedSource === normalizedWorkingDir;

    let finalPath;

    if (alreadyInWorkspace) {
      // No copy/move needed — project is already in the right place
      finalPath = normalizedSource;
      console.log(`[import] Already in workspace: ${finalPath}`);
    } else {
      const destPath = path.join(workingDir, projectName);

      if (fs.existsSync(destPath)) {
        throw new Error(`A folder named "${projectName}" already exists in the working directory. Rename the project or remove the existing folder first.`);
      }

      const win = getMainWindow();
      const progressCb = ({ currentFile, copied, total }) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('progress:update', {
            operation: mode === 'move' ? 'Moving...' : 'Copying...',
            percent: total > 0 ? Math.round((copied / total) * 100) : 0,
            currentFile: currentFile || '',
          });
        }
      };

      ensureDir(destPath);
      console.log(`[import] ${mode}: ${sourcePath} -> ${destPath}`);
      await copyFolderRecursive(sourcePath, destPath, progressCb);
      console.log(`[import] Copy complete`);

      if (mode === 'move') {
        console.log(`[import] Deleting source: ${sourcePath}`);
        fs.rmSync(sourcePath, { recursive: true, force: true });
        console.log(`[import] Source deleted`);
      }

      finalPath = destPath;
    }

    const project = {
      id: generateId(),
      name: projectName,
      sourcePath: finalPath,
      group: group || '',
      addedAt: new Date().toISOString(),
      color: randomColor(),
      versions: [],
    };
    store.get('projects').push(project);
    store.save();
    return project;
  });

  ipcMain.handle('projects:remove', (_e, { projectId }) => {
    const projects = store.get('projects');
    const idx = projects.findIndex(p => p.id === projectId);
    if (idx === -1) throw new Error(`Project not found: ${projectId}`);
    projects.splice(idx, 1);
    store.save();
  });

  ipcMain.handle('projects:update', (_e, { projectId, changes }) => {
    const project = store.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    Object.assign(project, changes);
    store.save();
    return project;
  });

  // ─── Versions / Snapshots ────────────────────────────────────────────────

  ipcMain.handle('versions:create', async (_e, { projectId, label, labelIds, note }) => {
    const win = getMainWindow();
    const progressCb = ({ currentFile, copied, total }) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('progress:update', {
          operation: 'snapshot',
          percent: total > 0 ? Math.round((copied / total) * 100) : 0,
          currentFile: currentFile || '',
        });
      }
    };
    return await createSnapshot(store, { projectId, label, labelIds, note }, progressCb);
  });

  ipcMain.handle('versions:import', async (_e, { projectId, sourcePath, label, labelIds, note }) => {
    const win = getMainWindow();
    const progressCb = ({ currentFile, copied, total }) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('progress:update', {
          operation: 'Importing...',
          percent: total > 0 ? Math.round((copied / total) * 100) : 0,
          currentFile: currentFile || '',
        });
      }
    };
    return await importSnapshot(store, { projectId, sourcePath, label, labelIds, note }, progressCb);
  });

  ipcMain.handle('versions:delete', (_e, { projectId, versionId }) => {
    deleteVersion(store, { projectId, versionId });
    for (const key of compareResultCache.keys()) {
      if (key.includes(versionId)) compareResultCache.delete(key);
    }
  });

  ipcMain.handle('versions:restore', async (_e, { projectId, versionId, createBackup }) => {
    const win = getMainWindow();
    const progressCb = ({ phase, currentFile, copied, total }) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('progress:update', {
          operation: phase === 'backup' ? 'backing up' : 'restoring',
          percent: total > 0 ? Math.round((copied / total) * 100) : 0,
          currentFile: currentFile || '',
        });
      }
    };
    return await restoreVersion(store, { projectId, versionId, createBackup }, progressCb);
  });



  // ─── Semantic (Openness) Diff ─────────────────────────────────────────────

  ipcMain.handle('diff:detectTia', () => {
    return detectTiaInstallations();
  });

  ipcMain.handle('diff:checkXmlExport', (_e, { versionId }) => {
    const found = store.findVersion(versionId);
    if (!found) throw new Error(`Version not found: ${versionId}`);
    const p = found.version.xmlExportPath;
    const available = !!(p && fs.existsSync(p));
    return { available, path: available ? p : null };
  });

  ipcMain.handle('diff:generateXmlExport', async (_e, { versionId }) => {
    const found = store.findVersion(versionId);
    if (!found) throw new Error(`Version not found: ${versionId}`);
    const { version } = found;

    const snapshotRoot = path.dirname(version.snapshotPath);
    const outputDir    = path.join(snapshotRoot, '_xml_export', versionId);

    const win = getMainWindow();

    const send = (payload) => {
      if (win && !win.isDestroyed()) {
        // Global progress bar
        win.webContents.send('progress:update', {
          operation:   payload.operation,
          percent:     payload.percent ?? 0,
          currentFile: payload.currentFile ?? '',
        });
        // Detailed status for the diff modal
        win.webContents.send('diff:exportStatus', payload);
      }
    };

    const progressCb = (msg) => {
      const { type, phase, message, block, done, total } = msg;

      if (type === 'status') {
        const phaseLabels = {
          launch:  'Launching TIA Portal (headless)…',
          open:    'Opening project…',
          scan:    'Scanning PLC devices…',
          compile: 'Compiling PLC software…',
          export:  `Exporting blocks${total ? ` (${done}/${total})` : ''}…`,
        };
        send({
          operation:   phaseLabels[phase] || message || phase,
          percent:     (phase === 'export' && total > 0) ? Math.round((done / total) * 100) : 0,
          currentFile: '',
          phase, message, done, total,
        });
      } else if (type === 'progress') {
        send({
          operation:   `Exporting blocks (${done}/${total})…`,
          percent:     total > 0 ? Math.round((done / total) * 100) : 0,
          currentFile: block || '',
          phase: 'export', block, done, total,
        });
      } else if (type === 'done') {
        send({
          operation:   `Export complete — ${msg.exported} blocks exported`,
          percent:     100,
          currentFile: '',
          phase: 'done', exported: msg.exported, errors: msg.errors,
        });
      }
    };

    await exportSnapshotToXml(version.snapshotPath, outputDir, progressCb);

    version.xmlExportPath = outputDir;
    store.save();

    for (const key of compareResultCache.keys()) {
      if (key.includes(versionId)) compareResultCache.delete(key);
    }

    return { path: outputDir };
  });

  ipcMain.handle('diff:compareXml', async (_e, { versionIdA, versionIdB }) => {
    const foundA = store.findVersion(versionIdA);
    const foundB = store.findVersion(versionIdB);
    if (!foundA) throw new Error(`Version A not found: ${versionIdA}`);
    if (!foundB) throw new Error(`Version B not found: ${versionIdB}`);
    if (!foundA.version.xmlExportPath || !fs.existsSync(foundA.version.xmlExportPath)) {
      throw new Error(`XML export not available for version A. Generate it first.`);
    }
    if (!foundB.version.xmlExportPath || !fs.existsSync(foundB.version.xmlExportPath)) {
      throw new Error(`XML export not available for version B. Generate it first.`);
    }

    const cacheKey = [versionIdA, versionIdB].sort().join('|');
    if (compareResultCache.has(cacheKey)) {
      return compareResultCache.get(cacheKey);
    }

    const win = getMainWindow();
    const progressCb = ({ done, total, name }) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('diff:compareProgress', { done, total, name });
      }
    };

    const result = await compareXmlExports(
      foundA.version.xmlExportPath,
      foundB.version.xmlExportPath,
      progressCb,
    );
    const payload = {
      versionA: { id: foundA.version.id, label: foundA.version.label, createdAt: foundA.version.createdAt },
      versionB: { id: foundB.version.id, label: foundB.version.label, createdAt: foundB.version.createdAt },
      ...result,
    };
    compareResultCache.set(cacheKey, payload);
    return payload;
  });



  ipcMain.handle('diff:openBlockInCompareTool', (_e, { pathA, pathB }) => {
    const settings = store.get('settings');
    const tool = settings.externalCompareTool || {};
    let exePath = tool.exePath;

    // Check if configured path is valid, otherwise fall back to auto-detection
    if (!exePath || !fs.existsSync(exePath)) {
      exePath = findCompareToolExe();
    }

    if (!exePath) {
      throw new Error(
        'SIMATIC Automation Compare Tool not configured and could not be found in standard installation directories.'
      );
    }

    if (!fs.existsSync(pathA)) throw new Error(`Export file not found: ${pathA}`);
    if (!fs.existsSync(pathB)) throw new Error(`Export file not found: ${pathB}`);

    // Hardcode the argument template (no setting necessary)
    const argTemplate = '"{pathA}" "{pathB}"';
    const args = buildCompareArgs(argTemplate, pathA, pathB);
    const { spawn: spawnRaw } = require('child_process');
    const child = spawnRaw(exePath, args, { detached: true, stdio: 'ignore' });
    child.unref();
  });



  // ─── Labels ──────────────────────────────────────────────────────────────

  ipcMain.handle('labels:getAll', () => store.get('labelDefinitions'));

  ipcMain.handle('labels:create', (_e, { name, color }) => {
    const label = { id: generateId(), name, color: color || '#cba6f7', builtIn: false };
    store.get('labelDefinitions').push(label);
    store.save();
    return label;
  });

  ipcMain.handle('labels:update', (_e, { id, changes }) => {
    const labels = store.get('labelDefinitions');
    const label = labels.find(l => l.id === id);
    if (!label) throw new Error(`Label not found: ${id}`);
    Object.assign(label, changes);
    store.save();
    return label;
  });

  ipcMain.handle('labels:delete', (_e, { id }) => {
    const labels = store.get('labelDefinitions');
    const idx = labels.findIndex(l => l.id === id);
    if (idx === -1) throw new Error(`Label not found: ${id}`);
    labels.splice(idx, 1);
    store.save();
  });

  // ─── Settings ────────────────────────────────────────────────────────────

  ipcMain.handle('settings:get', () => store.get('settings'));

  ipcMain.handle('settings:update', (_e, { changes }) => {
    const settings = store.get('settings');
    Object.assign(settings, changes);
    store.save();
    return settings;
  });

  ipcMain.handle('app:getVersion', () => app.getVersion());

  ipcMain.handle('app:readReadme', () => {
    const readmePath = path.join(app.getAppPath(), 'README.md');
    return fs.readFileSync(readmePath, 'utf8');
  });

  ipcMain.handle('app:readHelp', () => {
    const helpPath = path.join(app.getAppPath(), 'HELP.md');
    return fs.readFileSync(helpPath, 'utf8');
  });

  ipcMain.handle('app:openExternal', (_e, { url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    } else {
      shell.openPath(url);
    }
  });

  // ─── Dialogs ─────────────────────────────────────────────────────────────

  ipcMain.handle('dialog:selectFolder', async () => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('dialog:selectExeFile', async () => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win, {
      title: 'Select Executable',
      properties: ['openFile'],
      filters: [
        { name: 'Executable', extensions: ['exe'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('dialog:selectProjectFile', async () => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win, {
      title: 'Select TIA Portal Project File',
      properties: ['openFile'],
      filters: [
        { name: 'TIA Portal Project', extensions: ['ap14','ap15','ap16','ap17','ap18','ap19','ap20','ap21','ap22','ap23'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const projectFolder = path.dirname(filePath);
    const projectName   = path.basename(filePath, path.extname(filePath));
    return { filePath, projectFolder, projectName };
  });

  ipcMain.handle('dialog:openInExplorer', (_e, { path: folderPath }) => {
    shell.openPath(folderPath);
  });

  ipcMain.handle('project:openInTia', (_e, { folderPath }) => {
    const entries = fs.readdirSync(folderPath);
    const projFile = entries.find(f => /\.ap\d+$/i.test(f));
    if (!projFile) throw new Error('No TIA Portal project file found in this folder.');
    const projectFilePath = path.join(folderPath, projFile);
    const install = pickInstallation(projectFilePath);
    if (!install || !install.portalExe) throw new Error('No compatible TIA Portal installation found.');
    const { spawn } = require('child_process');
    const child = spawn(install.portalExe, [projectFilePath], { detached: true, stdio: 'ignore' });
    child.unref();
  });

  // ─── Window controls ─────────────────────────────────────────────────────

  ipcMain.handle('window:minimize', () => getMainWindow()?.minimize());
  ipcMain.handle('window:maximize', () => {
    const win = getMainWindow();
    if (win?.isMaximized()) win.unmaximize(); else win?.maximize();
  });
  ipcMain.handle('window:close', () => getMainWindow()?.close());
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function randomColor() {
  const colors = ['#cba6f7', '#89b4fa', '#a6e3a1', '#fab387', '#f38ba8', '#89dceb', '#f9e2af'];
  return colors[Math.floor(Math.random() * colors.length)];
}

function findCompareToolExe() {
  const searchRoots = [
    'C:\\Program Files\\Siemens\\Automation\\SIMATIC Automation Compare Tool',
    'C:\\Program Files\\Siemens\\Automation\\SACT',
    'C:\\Program Files (x86)\\Siemens\\Automation\\SIMATIC Automation Compare Tool',
    'C:\\Program Files (x86)\\Siemens\\Automation\\SACT'
  ];
  
  const targetExes = ['ACTool.exe', 'Siemens.Automation.CompareTool.exe'];

  function searchDir(dir) {
    if (!fs.existsSync(dir)) return null;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      // Search files first
      for (const entry of entries) {
        if (entry.isFile() && targetExes.includes(entry.name)) {
          return path.join(dir, entry.name);
        }
      }
      // Then recurse into subdirectories
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
          const found = searchDir(path.join(dir, entry.name));
          if (found) return found;
        }
      }
    } catch (_) {
      // ignore read errors
    }
    return null;
  }

  for (const root of searchRoots) {
    const found = searchDir(root);
    if (found) return found;
  }
  return null;
}

module.exports = { registerHandlers };
