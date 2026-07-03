import { createModal } from './modal-base.js';
import { el, showToast } from '../../utils/dom.js';
import { getLabels, addVersion } from '../../state.js';

export function openImportSnapshotModal(project) {
  const labels = getLabels();
  let sourceFolder = null;

  // ── File picker ──────────────────────────────────────────────────────
  const fileDisplay   = el('div', { class: 'path-display placeholder' }, ['No file selected']);
  const folderDisplay = el('div', {
    style: { fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: '4px', wordBreak: 'break-all' },
  }, ['']);
  const browseBtn = el('button', { class: 'btn btn-secondary' }, ['Browse...']);

  browseBtn.addEventListener('click', async () => {
    const result = await window.electronAPI.selectProjectFile();
    if (!result) return;
    sourceFolder = result.projectFolder;
    fileDisplay.textContent = result.filePath.split(/[\\/]/).pop();
    fileDisplay.classList.remove('placeholder');
    folderDisplay.textContent = `📁 ${result.projectFolder}`;
    if (!labelInput.value.trim()) labelInput.value = result.projectName;
    confirmBtn.disabled = false;
  });

  // ── Label ────────────────────────────────────────────────────────────
  const labelInput = el('input', { class: 'input', type: 'text', placeholder: 'e.g. Received from contractor, v2.1 from customer…' });

  // ── Tag chips ────────────────────────────────────────────────────────
  const selectedLabelIds = new Set();
  const chipContainer = el('div', { class: 'label-selector' });

  for (const lbl of labels) {
    const chip = el('div', { class: 'label-chip', style: { background: lbl.color + '33', color: lbl.color } }, [lbl.name]);
    chip.addEventListener('click', () => {
      if (selectedLabelIds.has(lbl.id)) { selectedLabelIds.delete(lbl.id); chip.classList.remove('selected'); }
      else { selectedLabelIds.add(lbl.id); chip.classList.add('selected'); }
    });
    chipContainer.appendChild(chip);
  }

  // ── Note ─────────────────────────────────────────────────────────────
  const noteInput = el('textarea', { class: 'input', placeholder: 'Source, version number, contact person…', rows: 3 });

  // ── Progress ──────────────────────────────────────────────────────────
  const progressSection = el('div', { class: 'progress-section', style: { display: 'none' } }, [
    el('div', { class: 'progress-label' }, [
      el('span', { class: 'progress-op' }, ['Importing...']),
      el('span', { class: 'progress-pct' }, ['0%']),
    ]),
    el('div', { class: 'progress-bar' }, [el('div', { class: 'progress-bar-fill' })]),
    el('div', { class: 'progress-file' }, ['']),
  ]);

  const bodyEl = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } }, [
    el('div', {
      style: { background: 'var(--info-bg)', border: '1px solid var(--info)', borderRadius: '8px', padding: '10px 14px', fontSize: '12px', color: 'var(--info)' }
    }, [
      `Importing into: `,
      el('strong', {}, [project.name]),
      ` — the external project will be copied as a new snapshot in this project's history.`,
    ]),
    el('div', { class: 'form-group' }, [
      el('label', { class: 'form-label' }, ['External Project File (.ap??)']),
      el('div', { class: 'path-picker' }, [fileDisplay, browseBtn]),
      folderDisplay,
    ]),
    el('div', { class: 'form-group' }, [
      el('label', { class: 'form-label' }, ['Snapshot Label']),
      labelInput,
    ]),
    labels.length > 0 ? el('div', { class: 'form-group' }, [
      el('label', { class: 'form-label' }, ['Tags']),
      chipContainer,
    ]) : null,
    el('div', { class: 'form-group' }, [
      el('label', { class: 'form-label' }, ['Note (optional)']),
      noteInput,
    ]),
    progressSection,
  ].filter(Boolean));

  const cancelBtn  = el('button', { class: 'btn btn-secondary' }, ['Cancel']);
  const confirmBtn = el('button', { class: 'btn btn-primary' }, ['Import Snapshot']);
  confirmBtn.disabled = true;

  const footer = el('div', { style: { display: 'flex', gap: '8px' } }, [cancelBtn, confirmBtn]);

  const { close } = createModal({
    id: 'import-snapshot',
    title: `Import External Snapshot — ${project.name}`,
    size: 'modal-md',
    bodyContent: bodyEl,
    footerContent: footer,
  });

  cancelBtn.addEventListener('click', close);

  const progressHandler = ({ operation, percent, currentFile }) => {
    progressSection.style.display = 'flex';
    progressSection.querySelector('.progress-op').textContent = operation || 'Importing...';
    progressSection.querySelector('.progress-pct').textContent = percent + '%';
    progressSection.querySelector('.progress-bar-fill').style.width = percent + '%';
    progressSection.querySelector('.progress-file').textContent = currentFile || '';
  };

  confirmBtn.addEventListener('click', async () => {
    if (!sourceFolder) return;
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    confirmBtn.textContent = 'Importing...';

    window.electronAPI.onProgress(progressHandler);

    try {
      const version = await window.electronAPI.importSnapshot({
        projectId: project.id,
        sourcePath: sourceFolder,
        label: labelInput.value.trim() || 'Imported Snapshot',
        labelIds: [...selectedLabelIds],
        note: noteInput.value.trim(),
      });
      addVersion(project.id, version);
      showToast(`Snapshot "${version.label}" imported.`, 'success');
      close();
    } catch (err) {
      showToast(err?.message || 'Import failed.', 'error');
      confirmBtn.disabled = false;
      cancelBtn.disabled = false;
      confirmBtn.textContent = 'Import Snapshot';
    } finally {
      window.electronAPI.offProgress(progressHandler);
    }
  });
}
