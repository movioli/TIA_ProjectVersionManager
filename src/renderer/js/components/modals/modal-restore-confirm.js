import { createModal } from './modal-base.js';
import { el } from '../../utils/dom.js';
import { api } from '../../api.js';
import { setProjects, updateProjectVersions } from '../../state.js';
import { showToast } from '../../utils/dom.js';

export function openRestoreConfirmModal(project, version) {
  const progressSection = el('div', { class: 'progress-section', style: { display: 'none' } }, [
    el('div', { class: 'progress-label' }, [
      el('span', { class: 'progress-op' }, ['Preparing...']),
      el('span', { class: 'progress-pct' }, ['0%']),
    ]),
    el('div', { class: 'progress-bar' }, [
      el('div', { class: 'progress-bar-fill' }),
    ]),
    el('div', { class: 'progress-file' }, ['']),
  ]);

  const backupCheckbox = el('input', { type: 'checkbox', id: 'backup-before-restore' });
  backupCheckbox.checked = true;
  const backupLabel = el('label', {
    for: 'backup-before-restore',
    style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer' },
  }, [backupCheckbox, 'Create backup before restoring']);

  const bodyEl = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } }, [
    el('div', { class: 'warning-box' }, [
      el('span', {}, ['⚠']),
      el('div', {}, [
        `This will overwrite the current project folder with the snapshot `,
        el('strong', {}, [`"${version.label}"`]),
        `.`,
      ]),
    ]),
    el('div', { style: { fontSize: '13px', color: 'var(--text-secondary)' } }, [
      el('div', {}, [`Project: ${project.name}`]),
      el('div', {}, [`Restoring: ${version.label}`]),
      el('div', {}, [`Folder: ${project.sourcePath}`]),
    ]),
    backupLabel,
    progressSection,
  ]);

  const cancelBtn = el('button', { class: 'btn btn-secondary' }, ['Cancel']);
  const confirmBtn = el('button', { class: 'btn btn-danger' }, ['Restore Version']);
  const footer = el('div', { style: { display: 'flex', gap: '8px' } }, [cancelBtn, confirmBtn]);

  const { close } = createModal({
    id: 'restore-confirm',
    title: 'Restore Version',
    size: 'modal-md',
    bodyContent: bodyEl,
    footerContent: footer,
  });

  cancelBtn.addEventListener('click', close);

  const progressHandler = ({ operation, percent, currentFile }) => {
    progressSection.style.display = 'flex';
    progressSection.querySelector('.progress-op').textContent = operation || 'Working...';
    progressSection.querySelector('.progress-pct').textContent = percent + '%';
    progressSection.querySelector('.progress-bar-fill').style.width = percent + '%';
    progressSection.querySelector('.progress-file').textContent = currentFile || '';
  };
  window.electronAPI.onProgress(progressHandler);

  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    backupCheckbox.disabled = true;
    confirmBtn.textContent = 'Restoring...';

    const createBackup = backupCheckbox.checked;

    try {
      await api.restoreVersion(project.id, version.id, createBackup);
      const projects = await api.getProjects();
      setProjects(projects);
      const updated = projects.find(p => p.id === project.id);
      if (updated) updateProjectVersions(project.id, updated.versions);
      const toastMsg = createBackup
        ? `Restored to "${version.label}". Auto-backup was saved.`
        : `Restored to "${version.label}".`;
      showToast(toastMsg, 'success');
      close();
    } catch (_) {
      confirmBtn.disabled = false;
      cancelBtn.disabled = false;
      backupCheckbox.disabled = false;
      confirmBtn.textContent = 'Restore Version';
    } finally {
      window.electronAPI.offProgress(progressHandler);
    }
  });
}
