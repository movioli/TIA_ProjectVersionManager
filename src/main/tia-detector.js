/**
 * tia-detector.js
 * Scans the local machine for TIA Portal installations and their Openness DLLs.
 */

const fs   = require('fs');
const path = require('path');

const SIEMENS_BASE = 'C:\\Program Files\\Siemens\\Automation';

// Map project file extension number → Portal version number (same in practice)
// e.g. .ap19 → version 19
function versionFromExtension(projectFilePath) {
  const ext = path.extname(projectFilePath).toLowerCase(); // e.g. ".ap19"
  const match = ext.match(/^\.ap(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Returns an array of detected installations, sorted descending by version:
 * [{ version: 20, portalExe, engineeringDll, hmiDll }]
 */
function detectTiaInstallations() {
  const results = [];

  let entries;
  try { entries = fs.readdirSync(SIEMENS_BASE, { withFileTypes: true }); }
  catch (_) { return results; }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(/^Portal V(\d+)$/i);
    if (!match) continue;

    const version = parseInt(match[1], 10);
    const portalDir = path.join(SIEMENS_BASE, entry.name);
    const dllDir    = path.join(portalDir, 'PublicAPI', `V${version}`);
    const engDll    = path.join(dllDir, 'Siemens.Engineering.dll');
    const hmiDll    = path.join(dllDir, 'Siemens.Engineering.Hmi.dll');
    const portalExe = path.join(portalDir, 'Bin', 'Siemens.Automation.Portal.exe');

    if (!fs.existsSync(engDll)) continue;

    results.push({
      version,
      portalExe: fs.existsSync(portalExe) ? portalExe : null,
      engineeringDll: engDll,
      hmiDll: fs.existsSync(hmiDll) ? hmiDll : null,
    });
  }

  results.sort((a, b) => b.version - a.version);
  return results;
}

/**
 * Pick the best installation for a given project file.
 * Exact version match preferred; falls back to highest installed version ≥ project version.
 * Returns null if no suitable installation is found.
 */
function pickInstallation(projectFilePath) {
  const projectVersion = versionFromExtension(projectFilePath);
  const installations  = detectTiaInstallations();

  if (installations.length === 0) return null;
  if (projectVersion === null)    return installations[0]; // best guess

  // Exact match first
  const exact = installations.find(i => i.version === projectVersion);
  if (exact) return exact;

  // Highest version that is ≥ project version (TIA Openness is forward-compatible within major)
  const compatible = installations.filter(i => i.version >= projectVersion);
  return compatible.length > 0 ? compatible[compatible.length - 1] : null;
}

module.exports = { detectTiaInstallations, pickInstallation, versionFromExtension };
