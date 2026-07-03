const fs = require('fs');
const path = require('path');
const { copyFolderRecursive, getFolderStats, checkTiaLockFiles, clearFolderContents, ensureDir } = require('./utils');

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
  store.save();

  return { success: true };
}

function deleteVersion(store, { projectId, versionId }) {
  const project = store.getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const versionIndex = project.versions.findIndex(v => v.id === versionId);
  if (versionIndex === -1) throw new Error(`Version not found: ${versionId}`);

  const version = project.versions[versionIndex];

  if (version.snapshotPath && fs.existsSync(version.snapshotPath)) {
    fs.rmSync(version.snapshotPath, { recursive: true, force: true });
  }

  project.versions.splice(versionIndex, 1);
  store.save();
}

/**
 * Import an external folder as a snapshot for an existing project.
 * sourcePath: the folder to copy in (parent folder of the .ap?? file)
 */
async function importSnapshot(store, { projectId, sourcePath, label, labelIds, note }, progressCb) {
  const snapshotRoot = store.getSnapshotRoot();
  if (!snapshotRoot) throw new Error('No working directory set. Please set a working directory in Settings first.');

  const project = store.getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  if (!fs.existsSync(sourcePath)) throw new Error(`Source path does not exist: ${sourcePath}`);

  const createdAt = new Date();
  const snapshotPath = buildSnapshotPath(snapshotRoot, project.name, label, createdAt);
  const finalPath = fs.existsSync(snapshotPath) ? snapshotPath + '_' + Date.now() : snapshotPath;
  ensureDir(finalPath);

  await copyFolderRecursive(sourcePath, finalPath, progressCb);

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
    imported: true,   // mark as externally imported
  };

  project.versions.push(version);
  store.save();
  return version;
}

module.exports = { createSnapshot, restoreVersion, deleteVersion, importSnapshot };
