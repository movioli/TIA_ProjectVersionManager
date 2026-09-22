const fs = require('fs');
const path = require('path');
const { copyFolderRecursive, getFolderStats, checkTiaLockFiles, clearFolderContents, ensureDir } = require('./utils');
const { findProjectFile } = require('./openness-exporter');

const APXX_MTIME_TOLERANCE_MS = 2000;

/**
 * Generate a human-readable, Windows-safe timestamp string.
 * Format: "2026-03-13_16.12.47"
 */
function makeTimestamp(date) {
  date = date || new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_` +
         `${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
}

/**
 * Sanitize a label string for use in a folder name.
 * Removes Windows-illegal characters, trims, caps length.
 */
function sanitizeForPath(str, maxLen = 60) {
  return str
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/**
 * Build the snapshot folder path.
 * Structure: <snapshotRoot>/<ProjectName>/<YYYY-MM-DD_HH.MM.SS> - <Label>/
 */
function buildSnapshotPath(snapshotRoot, projectName, label, date) {
  const ts = makeTimestamp(date);
  const cleanLabel = sanitizeForPath(label || 'Snapshot');
  const folderName = `${ts} - ${cleanLabel}`;
  return path.join(snapshotRoot, sanitizeForPath(projectName, 80), folderName);
}

async function createSnapshot(store, { projectId, label, labelIds, note }, progressCb) {
  const snapshotRoot = store.getSnapshotRoot();
  if (!snapshotRoot) {
    throw new Error('No working directory set. Please set a working directory in Settings first.');
  }

  const project = store.getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const sourcePath = project.sourcePath;
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source path does not exist: ${sourcePath}`);
  }

  const locks = checkTiaLockFiles(sourcePath);
  if (locks.length > 0) {
    throw new Error(
      `TIA Portal appears to have this project open (${locks.length} .lck file(s) found). ` +
      `Please close TIA Portal before creating a snapshot.`
    );
  }

  const createdAt = new Date();
  const snapshotPath = buildSnapshotPath(snapshotRoot, project.name, label, createdAt);

  // Handle rare case of duplicate (same second)
  const finalPath = fs.existsSync(snapshotPath) ? snapshotPath + '_' + Date.now() : snapshotPath;
  ensureDir(finalPath);

  await copyFolderRecursive(sourcePath, finalPath, progressCb);

  const { sizeBytes, fileCount } = getFolderStats(finalPath);

  const version = {
    id: path.basename(finalPath),   // human-readable folder name IS the id
    projectId,
    label: label || 'Snapshot',
    labelIds: labelIds || [],
    note: note || '',
    createdAt: createdAt.toISOString(),
    snapshotPath: finalPath,
    sizeBytes,
    fileCount,
  };

  project.versions.push(version);
  captureWorkingCopy(project, version.id);
  store.save();

  return version;
}

async function restoreVersion(store, { projectId, versionId, createBackup = true }, progressCb) {
  const snapshotRoot = store.getSnapshotRoot();
  if (!snapshotRoot) throw new Error('No working directory set.');

  const project = store.getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const version = store.getVersion(projectId, versionId);
  if (!version) throw new Error(`Version not found: ${versionId}`);

  if (!fs.existsSync(version.snapshotPath)) {
    throw new Error(`Snapshot data missing at: ${version.snapshotPath}`);
  }

  const sourcePath = project.sourcePath;

  if (fs.existsSync(sourcePath)) {
    const locks = checkTiaLockFiles(sourcePath);
    if (locks.length > 0) {
      throw new Error(`TIA Portal appears to have this project open. Please close it before restoring.`);
    }

    if (createBackup) {
      const backupLabel = `Auto-backup before restore`;
      const backupCreatedAt = new Date();
      const backupPath = buildSnapshotPath(snapshotRoot, project.name, backupLabel, backupCreatedAt);
      ensureDir(backupPath);

      if (progressCb) progressCb({ phase: 'backup', currentFile: '', copied: 0, total: 0 });
      await copyFolderRecursive(sourcePath, backupPath, null);

      const { sizeBytes, fileCount } = getFolderStats(backupPath);
      const backupVersion = {
        id: path.basename(backupPath),
        projectId,
        label: backupLabel,
        labelIds: ['label-backup'],
        note: `Automatically created before restoring "${version.label}"`,
        createdAt: backupCreatedAt.toISOString(),
        snapshotPath: backupPath,
        sizeBytes,
        fileCount,
      };
      project.versions.push(backupVersion);
      store.save();
    }

    clearFolderContents(sourcePath);
  } else {
    ensureDir(sourcePath);
  }

  if (progressCb) progressCb({ phase: 'restore', currentFile: '', copied: 0, total: 0 });
  await copyFolderRecursive(version.snapshotPath, sourcePath, progressCb);

  project.lastRestoredVersionId = versionId;
  project.lastRestoredAt = new Date().toISOString();
  captureWorkingCopy(project, versionId);
  store.save();

  return { success: true };
}

function captureWorkingCopy(project, versionId) {
  let apxxMtimeMs = null;
  try {
    const apxx = findProjectFile(project.sourcePath);
    if (apxx) apxxMtimeMs = fs.statSync(apxx).mtimeMs;
  } catch (_) {}
  project.workingCopy = {
    basedOnVersionId: versionId,
    apxxMtimeMs,
    capturedAt: new Date().toISOString(),
  };
}

function getWorkingState(store, projectId) {
  const project = store.getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const wc = project.workingCopy;
  const empty = {
    status: 'unknown',
    basedOnVersionId: wc?.basedOnVersionId || null,
    editedAt: null,
    apxxName: null,
  };
  if (!wc?.basedOnVersionId || wc.apxxMtimeMs == null) return empty;

  let apxx;
  try { apxx = findProjectFile(project.sourcePath); } catch (_) { apxx = null; }
  if (!apxx) return empty;

  const stat = fs.statSync(apxx);
  const apxxName = path.basename(apxx);
  const delta = stat.mtimeMs - wc.apxxMtimeMs;
  if (Math.abs(delta) <= APXX_MTIME_TOLERANCE_MS) {
    return { status: 'equal', basedOnVersionId: wc.basedOnVersionId, editedAt: null, apxxName };
  }
  return {
    status: 'edited',
    basedOnVersionId: wc.basedOnVersionId,
    editedAt: stat.mtime.toISOString(),
    apxxName,
  };
}

function deleteVersion(store, { projectId, versionId }) {
  const result = deleteVersions(store, [{ projectId, versionId }]);
  if (result.errors.length) throw new Error(result.errors[0].message);
}

function deleteVersions(store, items, progressCb) {
  const deleted = [];
  const errors = [];
  const total = items.length;

  for (let i = 0; i < items.length; i++) {
    const { projectId, versionId } = items[i];
    try {
      const project = store.getProject(projectId);
      if (!project) throw new Error(`Project not found: ${projectId}`);

      const versionIndex = project.versions.findIndex(v => v.id === versionId);
      if (versionIndex === -1) throw new Error(`Version not found: ${versionId}`);

      const version = project.versions[versionIndex];
      if (version.snapshotPath && fs.existsSync(version.snapshotPath)) {
        fs.rmSync(version.snapshotPath, { recursive: true, force: true });
      }
      project.versions.splice(versionIndex, 1);
      deleted.push({ projectId, versionId });
      if (progressCb) progressCb({ done: deleted.length + errors.length, total, label: version.label });
    } catch (err) {
      errors.push({ projectId, versionId, message: err.message });
      if (progressCb) progressCb({ done: deleted.length + errors.length, total, label: versionId });
    }
  }

  if (deleted.length) store.save();
  return { deleted, errors };
}

/**
 * Import an external folder as a snapshot for an existing project.
 * sourcePath: parent folder of the .ap?? file.
 * mode: 'move' (default) or 'copy'.
 */
async function importSnapshot(store, { projectId, sourcePath, label, labelIds, note, mode }, progressCb) {
  const snapshotRoot = store.getSnapshotRoot();
  if (!snapshotRoot) throw new Error('No working directory set. Please set a working directory in Settings first.');

  const project = store.getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  if (!fs.existsSync(sourcePath)) throw new Error(`Source path does not exist: ${sourcePath}`);

  const move = mode !== 'copy';
  if (move) {
    if (pathsOverlap(sourcePath, project.sourcePath)) {
      throw new Error('Cannot move the project working directory into the snapshot store. Choose "Keep a copy" instead.');
    }
    if (isInside(sourcePath, snapshotRoot)) {
      throw new Error('This folder is already inside the snapshot store. Choose "Keep a copy" instead.');
    }
  }

  const locks = checkTiaLockFiles(sourcePath);
  if (locks.length > 0) {
    throw new Error(
      `TIA Portal appears to have this project open (${locks.length} .lck file(s) found). ` +
      `Please close TIA Portal before importing.`
    );
  }

  const createdAt = new Date();
  const snapshotPath = buildSnapshotPath(snapshotRoot, project.name, label, createdAt);
  const finalPath = fs.existsSync(snapshotPath) ? snapshotPath + '_' + Date.now() : snapshotPath;

  await placeImportedFolder(sourcePath, finalPath, move, progressCb);

  const { sizeBytes, fileCount } = getFolderStats(finalPath);

  const version = {
    id: path.basename(finalPath),
    projectId,
    label: label || 'Imported Snapshot',
    labelIds: labelIds || [],
    note: note || '',
    createdAt: createdAt.toISOString(),
    snapshotPath: finalPath,
    sizeBytes,
    fileCount,
    imported: true,
  };

  project.versions.push(version);
  store.save();
  return version;
}

function pathsOverlap(a, b) {
  if (!a || !b) return false;
  return isInside(a, b) || isInside(b, a);
}

function isInside(child, parent) {
  const c = path.resolve(child).toLowerCase();
  const p = path.resolve(parent).toLowerCase();
  return c === p || c.startsWith(p + path.sep);
}

async function placeImportedFolder(sourcePath, finalPath, move, progressCb) {
  if (!move) {
    ensureDir(finalPath);
    await copyFolderRecursive(sourcePath, finalPath, progressCb);
    return;
  }

  ensureDir(path.dirname(finalPath));
  try {
    fs.renameSync(sourcePath, finalPath);
    if (progressCb) progressCb({ currentFile: path.basename(finalPath), copied: 1, total: 1 });
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    ensureDir(finalPath);
    await copyFolderRecursive(sourcePath, finalPath, progressCb);
    fs.rmSync(sourcePath, { recursive: true, force: true });
  }
}

module.exports = { createSnapshot, restoreVersion, deleteVersion, deleteVersions, importSnapshot, getWorkingState };
