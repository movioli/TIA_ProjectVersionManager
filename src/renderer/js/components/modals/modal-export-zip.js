import { el, showToast } from '../../utils/dom.js';
import { api } from '../../api.js';
import { createModal } from './modal-base.js';

export async function exportFolderAsZip({ folderPath, suggestedName }) {
  const { exportRoot } = await api.assertNotOpenInTia(folderPath);
  const choice = await askExportDestination(exportRoot);
  if (!choice) return;

  let destPath = null;
  if (choice === 'other') {
    destPath = await api.saveZipDialog(folderPath, suggestedName);
    if (!destPath) return;
  }

  const progress = openZipProgress();
  try {
    const saved = await api.exportZip({ folderPath, destPath, suggestedName });
    if (saved) showToast(`Exported to ${saved}`, 'success');
  } finally {
    progress.close();
  }
}

function openZipProgress() {
  const progressSection = el('div', { class: 'progress-section' }, [
    el('div', { class: 'progress-label' }, [
      el('span', { class: 'progress-op' }, ['Preparing…']),
      el('span', { class: 'progress-pct' }, ['0%']),
    ]),
    el('div', { class: 'progress-bar' }, [
      el('div', { class: 'progress-bar-fill' }),
    ]),
    el('div', { class: 'progress-file' }, ['']),
  ]);

  const { close } = createModal({
    id: 'export-zip-progress',
    title: 'Export as ZIP',
    size: 'modal-sm',
    bodyContent: progressSection,
  });

  const progressHandler = ({ operation, percent, currentFile }) => {
    progressSection.querySelector('.progress-op').textContent = operation || 'Creating ZIP…';
    progressSection.querySelector('.progress-pct').textContent = `${percent ?? 0}%`;
    progressSection.querySelector('.progress-bar-fill').style.width = `${percent ?? 0}%`;
    progressSection.querySelector('.progress-file').textContent = currentFile || '';
  };
  window.electronAPI.onProgress(progressHandler);

  return {
    close() {
      window.electronAPI.offProgress(progressHandler);
      close();
    },
  };
}

function askExportDestination(exportRoot) {
  return new Promise((resolve) => {
    let choice = null;

    const hint = exportRoot
      ? `Default folder: ${exportRoot}`
      : 'No working directory set. Choose another location, or set one in Settings.';

    const body = el('div', { style: { fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' } }, [
      el('div', {}, ['Export this project as a ZIP archive.']),
      el('div', { style: { marginTop: '8px', wordBreak: 'break-all' } }, [hint]),
    ]);

    const defaultBtn = el('button', { class: 'btn btn-primary', disabled: !exportRoot }, ['Export to default folder']);
    const otherBtn = el('button', { class: 'btn btn-secondary' }, ['Choose another location']);
    const cancelBtn = el('button', { class: 'btn btn-ghost' }, ['Cancel']);
    const footer = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [defaultBtn, otherBtn, cancelBtn]);

    const { close } = createModal({
      id: 'export-zip',
      title: 'Export as ZIP',
      size: 'modal-sm',
      bodyContent: body,
      footerContent: footer,
      onClose: () => resolve(choice),
    });

    defaultBtn.addEventListener('click', () => {
      choice = 'default';
      close();
    });
    otherBtn.addEventListener('click', () => {
      choice = 'other';
      close();
    });
    cancelBtn.addEventListener('click', close);
  });
}
