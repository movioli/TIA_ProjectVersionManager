import { createModal } from './modal-base.js';
import { el, empty } from '../../utils/dom.js';
import { api } from '../../api.js';
import { getLabels, setLabels } from '../../state.js';
import { showToast } from '../../utils/dom.js';

const PALETTE = [
  '#cba6f7','#b4befe','#89b4fa','#87ceeb','#89dceb',
  '#a6e3a1','#94e2d5','#f9e2af','#fab387','#eba0ac',
  '#f38ba8','#ff6b9d','#9399b2','#7f849c','#cdd6f4',
];

export function openLabelManagerModal() {
  const listContainer = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } });

  let pickerTarget = null;

  function renderList() {
    empty(listContainer);
    const labels = getLabels();
    for (const lbl of labels) {
      renderLabelRow(lbl);
    }
  }

  function renderLabelRow(lbl) {
    const dot = el('div', {
      class: 'label-color-dot',
      style: { background: lbl.color },
      title: 'Change color',
    });

    const nameInput = el('input', {
      class: 'label-name-input',
      type: 'text',
      value: lbl.name,
    });

    const deleteBtn = el('button', { class: 'btn btn-ghost btn-sm btn-icon', title: 'Delete', style: { color: 'var(--danger)' } }, ['✕']);

    const row = el('div', { class: 'label-list-item' }, [dot, nameInput, deleteBtn]);
    listContainer.appendChild(row);

    dot.addEventListener('click', (e) => {
      pickerTarget = { id: lbl.id, dotEl: dot };
      showColorPicker(e.clientX, e.clientY);
    });

    nameInput.addEventListener('blur', async () => {
      const newName = nameInput.value.trim();
      if (!lbl.builtIn && newName && newName !== lbl.name) {
        try {
          await api.updateLabel(lbl.id, { name: newName });
          const labels = await api.getLabels();
          setLabels(labels);
          renderList();
        } catch (_) {}
      }
    });

    deleteBtn.addEventListener('click', async () => {
      try {
        await api.deleteLabel(lbl.id);
        const labels = await api.getLabels();
        setLabels(labels);
        renderList();
        showToast('Label deleted.', 'info');
      } catch (_) {}
    });
  }

  function showColorPicker(x, y) {
    const existing = document.querySelector('.color-picker-popup');
    if (existing) existing.remove();

    const swatches = el('div', { class: 'color-swatches', style: { position: 'fixed', left: x + 'px', top: y + 'px', zIndex: 9000, width: '200px' } });

    for (const color of PALETTE) {
      const sw = el('div', { class: 'color-swatch', style: { background: color }, title: color });
      sw.addEventListener('click', async () => {
        swatches.remove();
        if (!pickerTarget) return;
        try {
          await api.updateLabel(pickerTarget.id, { color });
          const labels = await api.getLabels();
          setLabels(labels);
          renderList();
        } catch (_) {}
      });
      swatches.appendChild(sw);
    }

    swatches.classList.add('color-picker-popup');
    document.body.appendChild(swatches);

    const close = (e) => {
      if (!swatches.contains(e.target)) {
        swatches.remove();
        document.removeEventListener('mousedown', close);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
  }

  // Add label row
  const newNameInput = el('input', {
    class: 'input',
    type: 'text',
    placeholder: 'New label name...',
    style: { flex: 1 },
  });
  const addBtn = el('button', { class: 'btn btn-primary btn-sm' }, ['Add']);
  const addRow = el('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } }, [newNameInput, addBtn]);

  addBtn.addEventListener('click', async () => {
    const name = newNameInput.value.trim();
    if (!name) return;
    try {
      await api.createLabel({ name });
      const labels = await api.getLabels();
      setLabels(labels);
      newNameInput.value = '';
      renderList();
      showToast(`Label "${name}" created.`, 'success');
    } catch (_) {}
  });

  newNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addBtn.click();
  });

  const bodyEl = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, [
    el('div', { style: { fontSize: '12px', color: 'var(--text-muted)' } }, [
      'Click a name to edit it. Click the color dot to change color.',
    ]),
    listContainer,
    el('div', { class: 'divider' }),
    addRow,
  ]);

  renderList();

  createModal({
    id: 'label-manager',
    title: 'Manage Labels',
    size: 'modal-sm',
    bodyContent: bodyEl,
  });
}
