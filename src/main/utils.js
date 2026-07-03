const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function generateId() {
  return crypto.randomUUID();
}

function normalizePath(p) {
  return path.normalize(p).replace(/[/\\]$/, '');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Recursively copy a folder from src to dest.
 * progressCb receives { currentFile, copied, total }
 * Progress is tracked across ALL subdirectories.
 */
async function copyFolderRecursive(src, dest, progressCb) {
  const total = progressCb ? countFiles(src) : 0;
  const counter = { copied: 0 };

  console.log(`[copy] Starting: ${src} -> ${dest} (${total} files)`);
  await _copyRecursive(src, dest, progressCb, counter, total);
  console.log(`[copy] Done: ${counter.copied} files copied`);
}

async function _copyRecursive(src, dest, progressCb, counter, total) {
  ensureDir(dest);
  let entries;
  try {
    entries = fs.readdirSync(src, { withFileTypes: true });
  } catch (err) {
    console.error(`[copy] Cannot read dir: ${src}`, err.message);
    return;
  }

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await _copyRecursive(srcPath, destPath, progressCb, counter, total);
    } else {
      console.log(`[copy] Copying: ${entry.name}`);
      await copyFileAsync(srcPath, destPath);
      counter.copied++;
      if (progressCb) {
        progressCb({
          currentFile: entry.name,
          copied: counter.copied,
          total,
        });
      }
    }
  }
}

function copyFileAsync(src, dest) {
  return new Promise((resolve, reject) => {
    const rd = fs.createReadStream(src);
    const wr = fs.createWriteStream(dest);
    rd.on('error', reject);
    wr.on('error', reject);
    wr.on('finish', resolve);
    rd.pipe(wr);
  });
}

function countFiles(dir) {
  let count = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        count += countFiles(path.join(dir, entry.name));
      } else {
        count++;
      }
    }
  } catch (_) {}
  return count;
}

/**
 * Get total size and file count of a folder recursively.
 */
function getFolderStats(folderPath) {
  let sizeBytes = 0;
  let fileCount = 0;

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        try {
          const stat = fs.statSync(full);
          sizeBytes += stat.size;
          fileCount++;
        } catch (_) {}
      }
    }
  }

  walk(folderPath);
  return { sizeBytes, fileCount };
}

/**
 * Check if any .lck files exist (TIA Portal open indicator).
 */
function checkTiaLockFiles(sourcePath) {
  const locks = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name));
      } else if (entry.name.endsWith('.lck')) {
        locks.push(path.join(dir, entry.name));
      }
    }
  }
  walk(sourcePath);
  return locks;
}

/**
 * Delete all contents inside a folder without removing the folder itself.
 */
function clearFolderContents(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      fs.rmSync(full, { recursive: true, force: true });
    } else {
      fs.unlinkSync(full);
    }
  }
}

module.exports = {
  generateId,
  normalizePath,
  ensureDir,
  copyFolderRecursive,
  getFolderStats,
  checkTiaLockFiles,
  clearFolderContents,
};
