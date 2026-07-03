import { createModal } from './modal-base.js';
import { el, showToast } from '../../utils/dom.js';
import { api } from '../../api.js';
import { getLabels, addVersion } from '../../state.js';
import { emit } from '../../event-bus.js';

export function openSnapshotModal(project) {
  const labels = getLabels();

  const labelInput = el('input', {
    class: 'input',
    type: 'text',
    placeholder: 'e.g. Initial baseline, Before HMI changes...',
  });

  const noteInput = el('textarea', {
    class: 'input',
    placeholder: 'Optional note...',
    rows: 3,
  });

  // Label chips
  const selectedLabelIds = new Set();
  const chipContainer = el('div', { class: 'label-selector' });

  for (const lbl of labels) {
    const chip = el('div', {
      class: 'label-chip',
      style: { background: lbl.color + '33', color: lbl.color },
    }, [lbl.name]);
    chip.addEventListener('click', () => {
      if (selectedLabelIds.has(lbl.id)) {
        selectedLabelIds.delete(lbl.id);
        chip.classList.remove('selected');
      } else {
        selectedLabelIds.add(lbl.id);
        chip.classList.add('selected');
      }
    });
    chipContainer.appendChild(chip);
  }

  const progressSection = el('div', { class: 'progress-section', style: { display: 'none' } }, [
    el('div', { class: 'progress-label' }, [
      el('span', {}, ['Creating snapshot...']),
      el('span', { class: 'progress-pct' }, ['0%']),
    ]),
    el('div', { class: 'progress-bar' }, [
      el('div', { class: 'progress-bar-fill' }),
    ]),
    el('div', { class: 'progress-file' }, ['']),
  ]);

  const bodyEl = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } }, [
    el('div', { class: 'form-group' }, [
      el('label', { class: 'form-label' }, ['Snapshot Label']),
      labelInput,
    ]),
    el('div', { class: 'form-group' }, [
      el('label', { class: 'form-label' }, ['Tags']),
      chipContainer,
    ]),
    el('div', { class: 'form-group' }, [
      el('label', { class: 'form-label' }, ['Note (optional)']),
      noteInput,
    ]),
    progressSection,
  ]);

  const cancelBtn = el('button', { class: 'btn btn-secondary' }, ['Cancel']);
  const confirmBtn = el('button', { class: 'btn btn-primary' }, ['Create Snapshot']);
  const footer = el('div', { style: { display: 'flex', gap: '8px' } }, [cancelBtn, confirmBtn]);

  const { close } = createModal({
    id: 'snapshot',
    title: `Snapshot — ${project.name}`,
    size: 'modal-md',
    bodyContent: bodyEl,
    footerContent: footer,
  });

  cancelBtn.addEventListener('click', close);

  // Listen for progress updates
  const progressHandler = ({ percent, currentFile }) => {
    progressSection.style.display = 'flex';
    progressSection.querySelector('.progress-pct').textContent = percent + '%';
    progressSection.querySelector('.progress-bar-fill').style.width = percent + '%';
    progressSection.querySelector('.progress-file').textContent = currentFile || '';
  };
  window.electronAPI.onProgress(progressHandler);

  confirmBtn.addEventListener('click', async () => {
    const label = labelInput.value.trim() || 'Snapshot';
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    confirmBtn.textContent = 'Working...';

    try {
      const version = await api.createSnapshot({
        projectId: project.id,
        label,
        labelIds: [...selectedLabelIds],
        note: noteInput.value.trim(),
      });
      addVersion(project.id, version);
      showToast(`Snapshot "${label}" created.`, 'success');
      close();
    } catch (_) {
      confirmBtn.disabled = false;
      cancelBtn.disabled = false;
      confirmBtn.textContent = 'Create Snapshot';
    } finally {
      window.electronAPI.offProgress(progressHandler);
    }
  });
}
