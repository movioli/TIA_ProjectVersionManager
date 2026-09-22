import { createModal } from './modal-base.js';
import { el, showToast } from '../../utils/dom.js';
import { getLabels, setProjects } from '../../state.js';
import { api } from '../../api.js';

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

  const keepCopyCheck = el('input', { type: 'checkbox', id: 'import-keep-copy' });
  const baselineCheck = el('input', { type: 'checkbox', id: 'import-as-baseline' });
  const backupCheck = el('input', { type: 'checkbox', id: 'import-baseline-backup' });
  backupCheck.disabled = true;

  const infoText = el('span', {}, [
    ' — the external folder will be moved into this project\'s snapshot history.',
  ]);

  function syncImportOptions() {
    const keepCopy = keepCopyCheck.checked;
    infoText.textContent = keepCopy
      ? ' — the external folder will be copied into this project\'s snapshot history. The original stays in place.'
      : ' — the external folder will be moved into this project\'s snapshot history.';
    backupCheck.disabled = !baselineCheck.checked;
    if (!baselineCheck.checked) backupCheck.checked = false;
    const warn = document.getElementById('import-baseline-warn');
    if (warn) warn.style.display = baselineCheck.checked ? 'flex' : 'none';
  }

  keepCopyCheck.addEventListener('change', syncImportOptions);
  baselineCheck.addEventListener('change', syncImportOptions);

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
      infoText,
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
    el('label', {
      style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer' },
    }, [keepCopyCheck, 'Keep a copy (slower)']),
    el('label', {
      style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer' },
    }, [baselineCheck, 'Copy into the working directory and set as baseline']),
    el('div', { class: 'warning-box', id: 'import-baseline-warn', style: { display: 'none' } }, [
      el('span', {}, ['⚠']),
      el('div', {}, [
        'The current project folder will be overwritten with this snapshot and set as the working-copy baseline.',
      ]),
    ]),
    el('label', {
      style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer' },
    }, [backupCheck, 'Create backup before copying']),
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
    keepCopyCheck.disabled = true;
    baselineCheck.disabled = true;
    backupCheck.disabled = true;
    confirmBtn.textContent = 'Importing...';

    window.electronAPI.onProgress(progressHandler);

    let imported = null;
    try {
      imported = await window.electronAPI.importSnapshot({
        projectId: project.id,
        sourcePath: sourceFolder,
        label: labelInput.value.trim() || 'Imported Snapshot',
        labelIds: [...selectedLabelIds],
        note: noteInput.value.trim(),
        mode: keepCopyCheck.checked ? 'copy' : 'move',
      });
      if (baselineCheck.checked) {
        await api.restoreVersion(project.id, imported.id, backupCheck.checked);
      }
      setProjects(await api.getProjects());
      showToast(
        baselineCheck.checked
          ? `Snapshot "${imported.label}" imported and set as baseline.`
          : `Snapshot "${imported.label}" imported.`,
        'success',
      );
      close();
    } catch (err) {
      if (imported) {
        try { setProjects(await api.getProjects()); } catch (_) {}
      } else {
        showToast(err?.message || 'Import failed.', 'error');
      }
      confirmBtn.disabled = false;
      cancelBtn.disabled = false;
      keepCopyCheck.disabled = false;
      baselineCheck.disabled = false;
      syncImportOptions();
      confirmBtn.textContent = 'Import Snapshot';
    } finally {
      window.electronAPI.offProgress(progressHandler);
    }
  });
}
