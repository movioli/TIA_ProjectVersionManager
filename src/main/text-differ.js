// Each trace push stores a v.slice() of size (2*max+1). Assuming 4 bytes per SMI
// element, bail out before the trace exceeds this budget to prevent OOM.
const MAX_TRACE_BYTES = 256 * 1024 * 1024;

/**
 * Myers diff algorithm — produces a minimal edit script between two line arrays.
 * Returns an array of hunks: { type: 'equal'|'add'|'remove', lines: string[] }
 * Returns null if the inputs are too large/different to diff within the memory budget.
 */
function myersDiff(linesA, linesB) {
  const n = linesA.length;
  const m = linesB.length;
  const max = n + m;

  if (max === 0) return [];

  // Compute max allowable edit distance before trace exceeds memory budget
  const maxD = Math.floor(MAX_TRACE_BYTES / ((2 * max + 1) * 4));
  if (maxD < 1) return null;

  // v[k] = furthest x reached on diagonal k
  const v = new Array(2 * max + 1).fill(0);
  const trace = [];

  outer:
  for (let d = 0; d <= max; d++) {
    if (d > maxD) return null;
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const ki = k + max;
      let x;
      if (k === -d || (k !== d && v[ki - 1] < v[ki + 1])) {
        x = v[ki + 1];       // move down (insert from B)
      } else {
        x = v[ki - 1] + 1;   // move right (delete from A)
      }
      let y = x - k;
      // follow snake (matching lines)
      while (x < n && y < m && linesA[x] === linesB[y]) {
        x++; y++;
      }
      v[ki] = x;
      if (x >= n && y >= m) break outer;
    }
  }

  // Backtrack to build edit path
  const edits = [];
  let x = n, y = m;

  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const vv = trace[d];
    const k = x - y;
    const ki = k + max;

    let prevK;
    if (k === -d || (k !== d && vv[ki - 1] < vv[ki + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = vv[prevK + max];
    const prevY = prevX - prevK;

    // snake (equal)
    while (x > prevX + (x - y === prevX - prevY ? 0 : 1) &&
           x > 0 && y > 0 &&
           linesA[x - 1] === linesB[y - 1]) {
      edits.unshift({ type: 'equal', lineA: x, lineB: y, text: linesA[x - 1] });
      x--; y--;
    }

    if (d > 0) {
      if (prevK === k - 1) {
        // delete from A
        edits.unshift({ type: 'remove', lineA: x, lineB: y, text: linesA[x - 1] });
        x--;
      } else {
        // insert from B
        edits.unshift({ type: 'add', lineA: x, lineB: y, text: linesB[y - 1] });
        y--;
      }
    }
  }

  return collapseToHunks(edits);
}

/**
 * Collapse flat edit list into context hunks (±3 lines around changes).
 */
function collapseToHunks(edits, context = 3) {
  if (edits.length === 0) return [];

  // Mark which equal lines are "near" a change
  const changed = edits.map(e => e.type !== 'equal');

  const visible = edits.map((e, i) => {
    if (changed[i]) return true;
    for (let j = Math.max(0, i - context); j <= Math.min(edits.length - 1, i + context); j++) {
      if (changed[j]) return true;
    }
    return false;
  });

  const hunks = [];
  let i = 0;
  while (i < edits.length) {
    if (!visible[i]) {
      // Count skipped lines
      let skip = 0;
      while (i < edits.length && !visible[i]) { skip++; i++; }
      if (skip > 0) hunks.push({ type: 'skip', count: skip });
    } else {
      hunks.push({ type: edits[i].type, lineA: edits[i].lineA, lineB: edits[i].lineB, text: edits[i].text });
      i++;
    }
  }
  return hunks;
}

module.exports = { myersDiff };
