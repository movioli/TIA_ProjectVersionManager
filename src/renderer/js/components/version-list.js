import { el, empty, showContextMenu, showToast } from '../utils/dom.js';
import { on } from '../event-bus.js';
import { getSelectedProject, getLabels, getDiffSelection, toggleDiffSelection, removeVersion } from '../state.js';
import { api } from '../api.js';
import { formatDate, formatRelativeDate, formatBytes } from '../utils/format.js';
import { openRestoreConfirmModal } from './modals/modal-restore-confirm.js';
import { openDiffModal } from './modals/modal-diff.js';

export function mountVersionList(containerEl, toolbarEl) {
  render(containerEl);

  on('state:selection-changed',      () => render(containerEl));
  on('state:versions-changed',       () => render(containerEl));
  on('state:projects-changed',       () => render(containerEl));
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

  let highlightId;
  if (project.lastRestoredAt) {
    const newestCreatedAt = versions[0]?.createdAt;
    if (newestCreatedAt && new Date(newestCreatedAt) > new Date(project.lastRestoredAt)) {
      highlightId = versions[0].id;
    } else {
      highlightId = project.lastRestoredVersionId;
    }
  } else {
    highlightId = versions[0]?.id;
  }

  for (const version of versions) {
    container.appendChild(renderVersionCard(project, version, labelMap, diffSelection, highlightId));
  }
}

function renderVersionCard(project, version, labelMap, diffSelection, highlightId) {
  const isSelectedForDiff = diffSelection.includes(version.id);
  const isHighlighted = version.id === highlightId;

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

  const metaEl = el('div', { class: 'card-meta' }, [
    el('span', {}, [`${version.fileCount ?? '?'} files`]),
    el('span', {}, [formatBytes(version.sizeBytes ?? 0)]),
    el('span', { title: formatDate(version.createdAt) }, [formatRelativeDate(version.createdAt)]),
  ]);

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
    class: `version-card${isSelectedForDiff ? ' selected-for-diff' : ''}${isHighlighted ? ' current-version' : ''}`,
  }, [checkbox, cardBody, actions]);

  checkbox.addEventListener('change', () => {
    toggleDiffSelection(version.id);
  });

  restoreBtn.addEventListener('click', () => {
    openRestoreConfirmModal(project, version);
  });

  moreBtn.addEventListener('click', (e) => {
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
  });

  return card;
}

function updateToolbarDiffBtn(toolbarEl, diffIds) {
  const diffBtn = toolbarEl?.querySelector('#btn-compare');
  if (diffBtn) {
    diffBtn.disabled = diffIds.length !== 2;
  }
}
