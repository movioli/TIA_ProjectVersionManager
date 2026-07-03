/**
 * openness-exporter.js
 * Spawns the TiaExporter.exe C# shim to export PLC blocks as SimaticML XML
 * from a snapshot directory via TIA Openness API.
 */

const { spawn }    = require('child_process');
const fs           = require('fs');
const path         = require('path');
const { pickInstallation, versionFromExtension } = require('./tia-detector');

const SHIM_EXE = path.join(__dirname, '..', 'shims', 'TiaExporter', 'TiaExporter.exe')
  .replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);

// How long to wait for TIA Portal to launch + export (ms)
const EXPORT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Find the .ap* project file inside a snapshot directory.
 * Returns the full path, or null if not found.
 */
function findProjectFile(snapshotPath) {
  let entries;
  try { entries = fs.readdirSync(snapshotPath, { withFileTypes: true }); }
  catch (_) { return null; }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (/^\.ap\d+$/i.test(path.extname(entry.name))) {
      return path.join(snapshotPath, entry.name);
    }
  }
  // TIA projects can nest one level deep
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sub = findProjectFile(path.join(snapshotPath, entry.name));
    if (sub) return sub;
  }
  return null;
}

/**
 * Export all PLC blocks from snapshotPath to outputDir using the C# shim.
 *
 * @param {string}   snapshotPath  - Root of the snapshot folder copy
 * @param {string}   outputDir     - Where SimaticML XML files will be written
 * @param {Function} progressCb    - Called with { phase, block, done, total }
 * @returns {Promise<{ exportedFiles: string[] }>}
 */
async function exportSnapshotToXml(snapshotPath, outputDir, progressCb = () => {}) {
  if (!fs.existsSync(SHIM_EXE)) {
    throw new Error(
      `TiaExporter.exe not found at ${SHIM_EXE}. ` +
      `Run "npm run build-shim" to compile the C# shim first.`
    );
  }

  const projectFile = findProjectFile(snapshotPath);
  if (!projectFile) {
    throw new Error(`No TIA Portal project file (.apXX) found in snapshot: ${snapshotPath}`);
  }

  const installation = pickInstallation(projectFile);
  if (!installation) {
    throw new Error(
      `No compatible TIA Portal installation found for ${path.basename(projectFile)}. ` +
      `Please install TIA Portal V${versionFromExtension(projectFile) || 'XX'} or later.`
    );
  }

  fs.mkdirSync(outputDir, { recursive: true });

  progressCb({ phase: 'launch', message: 'Launching TIA Portal (headless)…' });

  return new Promise((resolve, reject) => {
    const args = [
      '--project-file', projectFile,
      '--output-dir',   outputDir,
      '--dll-path',     installation.engineeringDll,
    ];

    const proc = spawn(SHIM_EXE, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderrBuf = '';
    const exportedFiles = [];

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('TIA export timed out after 10 minutes.'));
    }, EXPORT_TIMEOUT_MS);

    proc.stdout.setEncoding('utf-8');
    proc.stdout.on('data', chunk => {
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          if (msg.type === 'file') {
            exportedFiles.push(msg.path);
          }
          // Forward every message to the callback so the IPC handler can act on each type
          progressCb(msg);
        } catch (_) {
          // Non-JSON stdout line — ignore
        }
      }
    });

    proc.stderr.setEncoding('utf-8');
    proc.stderr.on('data', chunk => { stderrBuf += chunk; });

    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ exportedFiles });
      } else {
        reject(new Error(
          `TiaExporter.exe exited with code ${code}.\n${stderrBuf.trim()}`
        ));
      }
    });

    proc.on('error', err => {
      clearTimeout(timer);
      reject(new Error(`Failed to start TiaExporter.exe: ${err.message}`));
    });
  });
}

module.exports = { exportSnapshotToXml, findProjectFile };
