import { el, empty } from '../utils/dom.js';
import { on } from '../event-bus.js';
import { getSelectedProject, getDiffSelection } from '../state.js';
import { openSnapshotModal } from './modals/modal-snapshot.js';
import { openImportSnapshotModal } from './modals/modal-import-snapshot.js';
import { openDiffModal } from './modals/modal-diff.js';
import { openLabelManagerModal } from './modals/modal-label-manager.js';

export function mountToolbar(toolbarEl) {
  render(toolbarEl);

  on('state:selection-changed',      () => render(toolbarEl));
  on('state:diff-selection-changed', (ids) => {
    const btn = toolbarEl.querySelector('#btn-compare');
    if (btn) btn.disabled = ids.length !== 2;
  });
}

function render(toolbarEl) {
  empty(toolbarEl);

  const project = getSelectedProject();

  const nameDisplay = el('div', { class: 'project-name-display' }, [
    project ? project.name : 'TIA Project Version Manager',
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
