import { createModal } from './modal-base.js';
import { el, empty } from '../../utils/dom.js';

export async function openDiffModal(versionA, versionB) {
  const pane = el('div', { class: 'diff-semantic-pane' });

  const { body } = createModal({
    id: 'diff-view',
    title: `Compare: ${versionA.label}  ↔  ${versionB.label}`,
    size: 'modal-xl',
    bodyContent: pane,
  });

  body.style.padding  = '0';
  body.style.overflow = 'hidden';

  initSemanticPane(pane, versionA, versionB);
}

// ── Semantic pane ──────────────────────────────────────────────────────────

async function initSemanticPane(pane, versionA, versionB) {
  empty(pane);
  pane.innerHTML = '<div class="diff-loading">Checking…</div>';

  let installations, checkA, checkB;
  try {
    [installations, checkA, checkB] = await Promise.all([
      window.electronAPI.detectTia(),
      window.electronAPI.checkXmlExport(versionA.id),
      window.electronAPI.checkXmlExport(versionB.id),
    ]);
  } catch (err) {
    pane.innerHTML = `<div class="diff-placeholder" style="color:var(--danger)">${err.message}</div>`;
    return;
  }

  const tiaAvailable = installations && installations.length > 0;
  const bothReady    = checkA.available && checkB.available;

  empty(pane);

  if (bothReady) {
    await loadSemanticDiff(pane, versionA, versionB);
    return;
  }

  // ── Generate prompt ──────────────────────────────────────────────────
  const missingLabel = [
    !checkA.available ? versionA.label : null,
    !checkB.available ? versionB.label : null,
  ].filter(Boolean).join(' and ');

  const notice = el('div', { class: 'diff-semantic-notice' }, [
    el('p', {}, ['Semantic diff compares PLC block source code exported via TIA Openness.']),
    el('p', {}, ['Export not yet generated for: ', el('strong', {}, [missingLabel])]),
    !tiaAvailable
      ? el('p', { style: { color: 'var(--danger)' } }, ['⚠ No TIA Portal installation detected on this machine.'])
      : el('p', { style: { color: 'var(--text-muted)', fontSize: '12px' } }, [
          `TIA Portal V${installations.map(i => i.version).join(', V')} detected.`,
          el('br', {}),
          'TIA Portal will launch headless — this may take 1–3 minutes.',
        ]),
  ]);

  const generateBtn = el('button', { class: 'btn btn-primary' }, ['Generate Semantic Diff']);
  generateBtn.disabled = !tiaAvailable;

  // Live status display (shown while generating)
  const statusLine    = el('div', { class: 'diff-export-status-line' });
  const progressBar   = el('div', { class: 'diff-export-progress-fill' });
  const progressWrap  = el('div', { class: 'diff-export-progress-bar' }, [progressBar]);
  const statusArea    = el('div', { class: 'diff-export-status', style: { display: 'none' } }, [
    progressWrap,
    statusLine,
  ]);

  notice.appendChild(generateBtn);
  notice.appendChild(statusArea);
  pane.appendChild(notice);

  generateBtn.addEventListener('click', async () => {
    generateBtn.disabled    = true;
    generateBtn.textContent = 'Starting…';
    statusArea.style.display = '';
    statusLine.textContent   = 'Preparing…';
    progressBar.style.width  = '0%';

    const onStatus = (msg) => {
      if (msg.phase === 'done') {
        statusLine.textContent  = `Done — ${msg.exported} blocks exported${msg.errors ? `, ${msg.errors} errors` : ''}.`;
        progressBar.style.width = '100%';
        generateBtn.textContent = 'Done';
        return;
      }
      const labels = {
        launch:  'Launching TIA Portal (headless)…',
        open:    'Opening project…',
        scan:    'Scanning PLC devices…',
        compile: 'Compiling PLC software…',
        export:  msg.total ? `Exporting blocks (${msg.done}/${msg.total})…` : 'Exporting blocks…',
      };
      statusLine.textContent  = labels[msg.phase] || msg.message || msg.phase;
      progressBar.style.width = (msg.percent ?? 0) + '%';
      if (msg.phase === 'export') generateBtn.textContent = `Exporting (${msg.done}/${msg.total})…`;
    };

    window.electronAPI.onExportStatus(onStatus);

    try {
      if (!checkA.available) await window.electronAPI.generateXmlExport(versionA.id);
      if (!checkB.available) await window.electronAPI.generateXmlExport(versionB.id);
    } catch (err) {
      window.electronAPI.offExportStatus(onStatus);
      empty(pane);
      pane.appendChild(el('div', { class: 'diff-placeholder', style: { color: 'var(--danger)' } }, [
        `Export failed: ${err.message}`,
      ]));
      return;
    }

    window.electronAPI.offExportStatus(onStatus);
    await initSemanticPane(pane, versionA, versionB);
  });
}

async function loadSemanticDiff(pane, versionA, versionB) {
  empty(pane);

  // ── Progress UI ──────────────────────────────────────────────────────
  const statusLine   = el('div', { class: 'diff-export-status-line' }, ['Preparing comparison…']);
  const progressFill = el('div', { class: 'diff-export-progress-fill' });
  const progressBar  = el('div', { class: 'diff-export-progress-bar' }, [progressFill]);

  pane.appendChild(el('div', { class: 'diff-loading', style: { flexDirection: 'column', gap: '12px' } }, [
    progressBar,
    statusLine,
  ]));

  const onProgress = ({ done, total, name }) => {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    progressFill.style.width = pct + '%';
    statusLine.textContent   = `Comparing blocks (${done}/${total})…`;
  };

  window.electronAPI.onCompareProgress(onProgress);

  let result;
  try {
    result = await window.electronAPI.compareXml(versionA.id, versionB.id);
  } catch (err) {
    window.electronAPI.offCompareProgress(onProgress);
    empty(pane);
    pane.innerHTML = `<div class="diff-placeholder" style="color:var(--danger)">${err.message}</div>`;
    return;
  }

  window.electronAPI.offCompareProgress(onProgress);
  empty(pane);

  const blockTree    = el('div', { class: 'diff-tree-panel' });
  const blockContent = el('div', { class: 'diff-content-panel' });

  blockContent.innerHTML = '<div class="diff-placeholder">Select a block on the left to view changes.</div>';

  pane.appendChild(el('div', { class: 'diff-split' }, [blockTree, blockContent]));

  renderBlockTree(blockTree, blockContent, result);
}

// ── Block tree ─────────────────────────────────────────────────────────────

function renderBlockTree(panel, contentPanel, result) {
  const changed = result.blocks.filter(b => b.status !== 'unchanged');

  const added    = changed.filter(b => b.status === 'added').length;
  const removed  = changed.filter(b => b.status === 'removed').length;
  const modified = changed.filter(b => b.status === 'modified').length;

  panel.appendChild(el('div', { class: 'diff-tree-summary' }, [
    stat(added,           'added',     'var(--success)'),
    stat(modified,        'modified',  'var(--warning)'),
    stat(removed,         'removed',   'var(--danger)'),
    stat(result.unchanged,'unchanged', 'var(--text-muted)'),
  ]));

  if (changed.length === 0) {
    panel.appendChild(el('div', { class: 'diff-placeholder', style: { padding: '20px' } }, [
      'All PLC blocks are identical.',
    ]));
    return;
  }

  const scrollArea = el('div', { style: { overflowY: 'auto', flex: '1' } });

  // Group by blockType
  const byType = {};
  for (const b of changed) {
    if (!byType[b.blockType]) byType[b.blockType] = [];
    byType[b.blockType].push(b);
  }

  for (const [typeName, blocks] of Object.entries(byType).sort()) {
    const children = el('div', {});

    const groupRow = el('div', { class: 'diff-tree-row', style: { paddingLeft: '8px' } }, [
      el('span', { class: 'diff-tree-toggle' }, ['▾']),
      el('span', { class: 'diff-tree-icon' }, ['📂']),
      el('span', { class: 'diff-tree-name' }, [typeName]),
      el('span', { class: 'diff-tree-badge', style: { color: 'var(--text-muted)' } }, [`${blocks.length}`]),
    ]);

    let expanded = true;
    groupRow.addEventListener('click', () => {
      expanded = !expanded;
      children.style.display = expanded ? '' : 'none';
      groupRow.querySelector('.diff-tree-toggle').textContent = expanded ? '▾' : '▸';
    });

    for (const block of blocks.sort((a, b) => a.name.localeCompare(b.name))) {
      const color    = statusColor(block.status);
      const blockRow = el('div', { class: 'diff-tree-row diff-tree-file', style: { paddingLeft: '22px' } }, [
        el('span', { class: 'diff-tree-toggle', style: { visibility: 'hidden' } }, ['▸']),
        el('span', { class: 'diff-tree-icon' }, ['⬡']),
        el('span', { class: 'diff-tree-name' }, [block.name]),
        el('span', { class: 'diff-tree-badge', style: { color } }, [block.status]),
      ]);

      blockRow.addEventListener('click', () => {
        document.querySelectorAll('.diff-tree-file.active').forEach(r => r.classList.remove('active'));
        blockRow.classList.add('active');
        renderBlockDiff(contentPanel, block);
      });

      children.appendChild(blockRow);
    }

    scrollArea.appendChild(groupRow);
    scrollArea.appendChild(children);
  }

  panel.appendChild(scrollArea);
}

function renderBlockDiff(contentPanel, block) {
  empty(contentPanel);

  const subtitle = block.isSclDiff ? 'SCL source' : 'SimaticML (normalized XML)';

  // Build header: title + optional "Open in Compare Tool" button
  const headerRight = [];
  if (block.status === 'modified' && block.fullPathA && block.fullPathB) {
    const openBtn = el('button', { class: 'btn btn-secondary', style: { fontSize: '12px', padding: '3px 10px' } }, ['Open in Compare Tool']);
    openBtn.addEventListener('click', async () => {
      openBtn.disabled = true;
      openBtn.textContent = 'Opening…';
      try {
        await window.electronAPI.openBlockInCompareTool(block.fullPathA, block.fullPathB);
        openBtn.textContent = 'Opened';
      } catch (err) {
        openBtn.textContent = 'Open in Compare Tool';
        openBtn.disabled = false;
        // Show error inline below header
        const existing = contentPanel.querySelector('.diff-compare-tool-error');
        if (existing) existing.remove();
        const errEl = el('div', { class: 'diff-compare-tool-error', style: { color: 'var(--danger)', fontSize: '12px', padding: '6px 14px' } }, [
          err.message,
        ]);
        contentPanel.insertBefore(errEl, contentPanel.children[1] || null);
      }
    });
    headerRight.push(openBtn);
  }

  contentPanel.appendChild(el('div', { class: 'diff-file-header' }, [
    el('span', { class: 'diff-file-header-path' }, [`${block.blockType} / ${block.name}`]),
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
      el('span', { class: 'diff-file-header-meta' }, [subtitle]),
      ...headerRight,
    ]),
  ]));

  if (block.status === 'added') {
    contentPanel.appendChild(el('div', { class: 'diff-placeholder' }, ['Block added in this version — no prior version to compare.']));
    return;
  }
  if (block.status === 'removed') {
    contentPanel.appendChild(el('div', { class: 'diff-placeholder' }, ['Block removed — not present in the newer version.']));
    return;
  }
  if (block.tooLarge) {
    contentPanel.appendChild(el('div', { class: 'diff-placeholder' }, [
      'Block is too large to diff inline (',
      el('code', {}, [`${block.linesA?.toLocaleString()} / ${block.linesB?.toLocaleString()} lines`]),
      '). Use "Open in Compare Tool" to view changes.',
    ]));
    return;
  }
  if (!block.hunks || block.hunks.length === 0) {
    contentPanel.appendChild(el('div', { class: 'diff-placeholder' }, ['No differences found.']));
    return;
  }

  contentPanel.appendChild(renderHunks(block.hunks));
}

// ── Helpers ────────────────────────────────────────────────────────────────

function stat(count, label, color) {
  if (count === 0) return el('span', {});
  return el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } }, [
    el('span', { style: { fontWeight: 700, color } }, [String(count)]),
    el('span', { style: { color: 'var(--text-muted)', fontSize: '11px' } }, [label]),
  ]);
}

function statusColor(status) {
  return status === 'added'    ? 'var(--success)' :
         status === 'removed'  ? 'var(--danger)'  :
         status === 'modified' ? 'var(--warning)'  : 'var(--text-muted)';
}

function renderHunks(hunks) {
  const table = el('table', { class: 'diff-table' });
  let lineA = 1, lineB = 1;

  for (const hunk of hunks) {
    if (hunk.type === 'skip') {
      const row = el('tr', { class: 'diff-skip-row' }, [
        el('td', { class: 'diff-ln', colspan: 2 }, []),
        el('td', { class: 'diff-skip-label' }, [`··· ${hunk.count} unchanged lines ···`]),
      ]);
      table.appendChild(row);
      lineA += hunk.count;
      lineB += hunk.count;
      continue;
    }

    const lnA    = hunk.type === 'add'    ? '' : String(lineA);
    const lnB    = hunk.type === 'remove' ? '' : String(lineB);
    const prefix = hunk.type === 'add'    ? '+' : hunk.type === 'remove' ? '−' : ' ';
    const cls    = hunk.type === 'add'    ? 'diff-add' : hunk.type === 'remove' ? 'diff-remove' : 'diff-equal';

    const row = el('tr', { class: cls }, [
      el('td', { class: 'diff-ln diff-ln-a' }, [lnA]),
      el('td', { class: 'diff-ln diff-ln-b' }, [lnB]),
      el('td', { class: 'diff-code' }, [
        el('span', { class: 'diff-prefix' }, [prefix]),
        hunk.text,
      ]),
    ]);

    table.appendChild(row);

    if (hunk.type !== 'add')    lineA++;
    if (hunk.type !== 'remove') lineB++;
  }

  const wrap = el('div', { class: 'diff-table-wrap' });
  wrap.appendChild(table);
  return wrap;
}
