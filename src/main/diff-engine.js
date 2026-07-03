const fs = require('fs');
const path = require('path');
const { myersDiff } = require('./text-differ');
const { extractBlockLogic, extractSclSource } = require('./xml-normalizer');

// Combined extracted-logic line count above which we skip Myers diff.
// Prevents O(d * (n+m)) trace array from blowing the heap on giant FBD blocks.
const MAX_DIFF_LINES = 20000;



/**
 * Compare two XML export directories (produced by TiaExporter.exe).
 * Async — yields to the event loop every 10 blocks to keep the main process responsive.
 * Calls progressCb({ done, total }) as each block is processed.
 *
 * @param {string}   pathA
 * @param {string}   pathB
 * @param {Function} progressCb  Called with { done, total, name }
 */
async function compareXmlExports(pathA, pathB, progressCb = () => {}) {
  const indexA = buildXmlBlockIndex(pathA);
  const indexB = buildXmlBlockIndex(pathB);

  const blocks    = [];
  let   unchanged = 0;

  // Build a unified key list: present in A, B, or both
  const allKeys = new Set([...indexA.keys(), ...indexB.keys()]);
  const total   = allKeys.size;
  let   done    = 0;

  for (const key of allKeys) {
    const infoA = indexA.get(key);
    const infoB = indexB.get(key);

    if (!infoA) {
      blocks.push({ ...infoB, status: 'added',   hunks: null, linesA: 0,          linesB: infoB.lines });
    } else if (!infoB) {
      blocks.push({ ...infoA, status: 'removed', hunks: null, linesA: infoA.lines, linesB: 0 });
    } else {
      const diff = diffXmlFiles(infoA.fullPath, infoB.fullPath);
      if (diff.identical) {
        unchanged++;
      } else {
        blocks.push({
          ...infoB,
          fullPathA: infoA.fullPath,
          fullPathB: infoB.fullPath,
          status:    'modified',
          hunks:     diff.hunks,
          linesA:    diff.linesA,
          linesB:    diff.linesB,
          isSclDiff: diff.isSclDiff,
          tooLarge:  diff.tooLarge || false,
        });
      }
    }

    done++;
    progressCb({ done, total, name: key });

    // Yield every 10 blocks so the main process can handle other events
    if (done % 10 === 0) await new Promise(resolve => setImmediate(resolve));
  }

  blocks.sort((a, b) => a.name.localeCompare(b.name));
  return { blocks, unchanged, totalA: indexA.size, totalB: indexB.size };
}

/**
 * Build a map of  "<blockType>/<blockName>" → { name, blockType, fullPath, lines }
 * from an XML export directory.
 */
function buildXmlBlockIndex(exportDir) {
  const index = new Map();

  let types;
  try { types = fs.readdirSync(exportDir, { withFileTypes: true }); }
  catch (_) { return index; }

  for (const typeEntry of types) {
    if (!typeEntry.isDirectory()) continue;
    const blockType = typeEntry.name;
    const typeDir   = path.join(exportDir, blockType);

    let files;
    try { files = fs.readdirSync(typeDir, { withFileTypes: true }); }
    catch (_) { continue; }

    for (const file of files) {
      if (!file.isFile() || path.extname(file.name).toLowerCase() !== '.xml') continue;
      const name     = path.basename(file.name, '.xml');
      const fullPath = path.join(typeDir, file.name);
      const key      = `${blockType}/${name}`;

      let lines = 0;
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        lines = content.split('\n').length;
      } catch (_) {}

      index.set(key, { name, blockType, fullPath, lines, key });
    }
  }

  return index;
}

/**
 * Diff two XML export files, comparing only logic content.
 * Uses extractBlockLogic() which discards all metadata and extracts
 * only Interface + NetworkSource (or plain SCL source for SCL blocks).
 */
function diffXmlFiles(fileA, fileB) {
  let xmlA, xmlB;
  try { xmlA = fs.readFileSync(fileA, 'utf-8'); } catch (_) { xmlA = ''; }
  try { xmlB = fs.readFileSync(fileB, 'utf-8'); } catch (_) { xmlB = ''; }

  const logicA    = extractBlockLogic(xmlA);
  const logicB    = extractBlockLogic(xmlB);
  const isSclDiff = extractSclSource(xmlA) !== null;

  if (logicA === logicB) return { identical: true };

  const linesA = logicA.split('\n');
  const linesB = logicB.split('\n');

  // Guard: skip Myers diff if the extracted logic is too large to diff safely.
  // Giant FBD blocks (250K+ lines) would cause the trace array to OOM the heap.
  if (linesA.length + linesB.length > MAX_DIFF_LINES) {
    return { identical: false, tooLarge: true, hunks: null, linesA: linesA.length, linesB: linesB.length, isSclDiff };
  }

  const hunks = myersDiff(linesA, linesB);

  // myersDiff returns null if the edit distance exceeds the memory budget
  if (hunks === null) {
    return { identical: false, tooLarge: true, hunks: null, linesA: linesA.length, linesB: linesB.length, isSclDiff };
  }

  return { identical: false, hunks, linesA: linesA.length, linesB: linesB.length, isSclDiff };
}

module.exports = { compareXmlExports };
