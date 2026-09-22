import { el, empty } from '../utils/dom.js';
import { on } from '../event-bus.js';
import { getSelectedProject, getDiffSelection, getWorkingState } from '../state.js';
import { openSnapshotModal } from './modals/modal-snapshot.js';
import { openImportSnapshotModal } from './modals/modal-import-snapshot.js';
import { openDiffModal } from './modals/modal-diff.js';
import { openLabelManagerModal } from './modals/modal-label-manager.js';
import { formatRelativeDate, formatDate } from '../utils/format.js';

export function mountToolbar(toolbarEl) {
  render(toolbarEl);

  on('state:selection-changed',      () => render(toolbarEl));
  on('state:projects-changed',       () => render(toolbarEl));
  on('state:working-state-changed',  () => render(toolbarEl));
  on('state:diff-selection-changed', (ids) => {
    const btn = toolbarEl.querySelector('#btn-compare');
    if (btn) btn.disabled = ids.length !== 2;
  });
}

function render(toolbarEl) {
  empty(toolbarEl);

  const project = getSelectedProject();

  const nameDisplay = el('div', { class: 'project-name-display' }, [
    el('div', { class: 'project-title' }, [
      project ? project.name : 'TIA Project Version Manager',
    ]),
    project ? renderWorkingStatus(project) : null,
  ]);

  const snapshotBtn = el('button', {
    class: 'btn btn-primary',
    id: 'btn-snapshot',
    disabled: !project,
  }, ['📷  Take Snapshot']);

  const importSnapshotBtn = el('button', {
    class: 'btn btn-secondary',
    id: 'btn-import-snapshot',
    disabled: !project,
    title: 'Import an external project as a snapshot',
  }, ['📥  Import Snapshot']);

  const compareBtn = el('button', {
    class: 'btn btn-secondary',
    id: 'btn-compare',
    disabled: true,
    title: 'Select exactly 2 versions to compare',
  }, ['⟺  Compare Selected']);

  const labelsBtn = el('button', {
    class: 'btn btn-ghost',
    id: 'btn-labels',
  }, ['⬡  Labels']);

  toolbarEl.appendChild(nameDisplay);
  toolbarEl.appendChild(el('div', { class: 'toolbar-actions' }, [snapshotBtn, importSnapshotBtn, compareBtn, labelsBtn]));

  snapshotBtn.addEventListener('click', () => {
    const p = getSelectedProject();
    if (p) openSnapshotModal(p);
  });

  importSnapshotBtn.addEventListener('click', () => {
    const p = getSelectedProject();
    if (p) openImportSnapshotModal(p);
  });

  compareBtn.addEventListener('click', async () => {
    const ids = getDiffSelection();
    if (ids.length !== 2) return;
    const p = getSelectedProject();
    if (!p) return;
    const vA = p.versions.find(v => v.id === ids[0]);
    const vB = p.versions.find(v => v.id === ids[1]);
    if (vA && vB) await openDiffModal(vA, vB);
  });

  labelsBtn.addEventListener('click', () => openLabelManagerModal());
}

function renderWorkingStatus(project) {
  const ws = getWorkingState();
  const mine = ws && ws.projectId === project.id ? ws : null;
  const version = mine?.basedOnVersionId
    ? (project.versions || []).find(v => v.id === mine.basedOnVersionId)
    : null;
  const label = version?.label || 'snapshot';

  if (!mine || mine.status === 'unknown') {
    return el('div', { class: 'working-status unknown' }, ['Not tracked yet']);
  }
  if (mine.status === 'equal') {
    return el('div', { class: 'working-status equal', title: mine.apxxName || '' }, [
      `✓  Equal to ${label}`,
    ]);
  }
  const when = mine.editedAt ? formatRelativeDate(mine.editedAt) : '';
  const exact = mine.editedAt ? formatDate(mine.editedAt) : '';
  return el('div', {
    class: 'working-status edited',
    title: exact ? `Saved ${exact}${mine.apxxName ? ` · ${mine.apxxName}` : ''}` : '',
  }, [`✎  Edited since ${label}${when ? ` · ${when}` : ''}`]);
}
