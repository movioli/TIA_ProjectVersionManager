import { el, empty, showContextMenu, showToast } from '../utils/dom.js';
import { on } from '../event-bus.js';
import { getSelectedProject, getLabels, getDiffSelection, toggleDiffSelection, removeVersion, getWorkingState } from '../state.js';
import { api } from '../api.js';
import { formatDate, formatRelativeDate, formatBytes } from '../utils/format.js';
import { openRestoreConfirmModal } from './modals/modal-restore-confirm.js';
import { openDiffModal } from './modals/modal-diff.js';
import { exportFolderAsZip } from './modals/modal-export-zip.js';

export function mountVersionList(containerEl, toolbarEl) {
  render(containerEl);

  on('state:selection-changed',      () => render(containerEl));
  on('state:versions-changed',       () => render(containerEl));
  on('state:projects-changed',       () => render(containerEl));
  on('state:working-state-changed',  () => render(containerEl));
  on('state:diff-selection-changed', (ids) => updateToolbarDiffBtn(toolbarEl, ids));
}

function render(container) {
  empty(container);

  const project = getSelectedProject();

  if (!project) {
    container.appendChild(
      el('div', { class: 'empty-state' }, [
        el('div', { class: 'icon' }, ['📁']),
        el('div', { class: 'title' }, ['No project selected']),
        el('div', { class: 'subtitle' }, ['Select a project from the sidebar or add a new one.']),
      ])
    );
    return;
  }

  const versions = [...(project.versions || [])].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  if (versions.length === 0) {
    container.appendChild(
      el('div', { class: 'empty-state' }, [
        el('div', { class: 'icon' }, ['📷']),
        el('div', { class: 'title' }, ['No snapshots yet']),
        el('div', { class: 'subtitle' }, ['Click "Take Snapshot" to save the current state of this project.']),
      ])
    );
    return;
  }

  const labels = getLabels();
  const labelMap = new Map(labels.map(l => [l.id, l]));
  const diffSelection = getDiffSelection();
  const ws = getWorkingState();
  const baselineId = project.workingCopy?.basedOnVersionId || null;
  const live = ws && ws.projectId === project.id ? ws : null;

  for (const version of versions) {
    container.appendChild(renderVersionCard(project, version, labelMap, diffSelection, baselineId, live));
  }
}

function renderVersionCard(project, version, labelMap, diffSelection, baselineId, live) {
  const isSelectedForDiff = diffSelection.includes(version.id);
  const isBaseline = version.id === baselineId;
  const status = isBaseline && live ? live.status : null;

  const checkbox = el('input', { type: 'checkbox', class: 'card-checkbox', title: 'Select for diff comparison' });
  checkbox.checked = isSelectedForDiff;

  // Tags
  const tagsEl = el('div', { class: 'card-tags' });
  if (version.labelIds?.length) {
    for (const lid of version.labelIds) {
      const lbl = labelMap.get(lid);
      if (lbl) {
        tagsEl.appendChild(
          el('span', {
            class: 'label-badge',
            style: { background: lbl.color + '33', color: lbl.color },
          }, [lbl.name])
        );
      }
    }
  }

  const metaBits = [
    el('span', {}, [`${version.fileCount ?? '?'} files`]),
    el('span', {}, [formatBytes(version.sizeBytes ?? 0)]),
    el('span', { title: formatDate(version.createdAt) }, [formatRelativeDate(version.createdAt)]),
  ];
  if (isBaseline && status === 'equal') {
    metaBits.push(el('span', { class: 'wc-mark equal', title: 'Working copy matches this snapshot' }, ['✓']));
  }
  if (isBaseline && status === 'edited') {
    const when = live.editedAt ? formatRelativeDate(live.editedAt) : '';
    const exact = live.editedAt ? formatDate(live.editedAt) : '';
    metaBits.push(el('span', {
      class: 'wc-mark edited',
      title: exact ? `Saved ${exact}` : 'Working copy was edited',
    }, [`✎${when ? ` ${when}` : ''}`]));
  }

  const metaEl = el('div', { class: 'card-meta' }, metaBits);

  const cardBody = el('div', { class: 'card-body' }, [
    el('div', { class: 'card-header' }, [
      el('div', { class: 'card-label' }, [version.label || 'Snapshot']),
      version.imported ? el('span', { class: 'label-badge', style: { background: 'var(--info-bg)', color: 'var(--info)', marginLeft: '4px' } }, ['📥 imported']) : null,
      el('div', { class: 'card-date' }, [formatDate(version.createdAt)]),
    ]),
    tagsEl,
    metaEl,
  ]);

  if (version.note) {
    cardBody.appendChild(el('div', { class: 'card-note' }, [version.note]));
  }

  const restoreBtn = el('button', { class: 'btn btn-secondary btn-sm', title: 'Restore to this version' }, ['↩ Restore']);
  const moreBtn = el('button', { class: 'btn btn-ghost btn-sm btn-icon', title: 'More options' }, ['⋯']);

  const actions = el('div', { class: 'card-actions' }, [restoreBtn, moreBtn]);

  const card = el('div', {
    class: `version-card${isSelectedForDiff ? ' selected-for-diff' : ''}${isBaseline ? ' current-version' : ''}${status === 'edited' ? ' edited-version' : ''}`,
  }, [checkbox, cardBody, actions]);

  checkbox.addEventListener('change', () => {
    toggleDiffSelection(version.id);
  });

  restoreBtn.addEventListener('click', () => {
    openRestoreConfirmModal(project, version);
  });

  function openVersionMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu([
      {
        label: '📂  Open snapshot folder',
        action: () => api.openInExplorer(version.snapshotPath),
      },
      {
        label: '🔧  Open in TIA Portal',
        action: () => api.openInTia(version.snapshotPath),
      },
      {
        label: '📦  Export as ZIP',
        action: () => exportFolderAsZip({
          folderPath: version.snapshotPath,
          suggestedName: version.label || 'Snapshot',
        }),
      },
      'sep',
      {
        label: '🗑  Delete snapshot',
        danger: true,
        action: async () => {
          try {
            await api.deleteVersion(project.id, version.id);
            removeVersion(project.id, version.id);
            showToast('Snapshot deleted.', 'info');
          } catch (_) {}
        },
      },
    ], e.clientX, e.clientY);
  }

  moreBtn.addEventListener('click', openVersionMenu);
  card.addEventListener('contextmenu', openVersionMenu);

  return card;
}

function updateToolbarDiffBtn(toolbarEl, diffIds) {
  const diffBtn = toolbarEl?.querySelector('#btn-compare');
  if (diffBtn) {
    diffBtn.disabled = diffIds.length !== 2;
  }
}
