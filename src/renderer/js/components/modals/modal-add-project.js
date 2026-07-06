import { createModal } from './modal-base.js';
import { el, showToast } from '../../utils/dom.js';
import { addProject, getProjects, getGroups } from '../../state.js';


export async function openAddProjectModal(defaultGroupPath = '') {
  const settings = await window.electronAPI.getSettings();

  if (!settings.workingDirectory) {
    const { openSettingsModal } = await import('./modal-settings.js');
    showToast('Set a working directory in Settings before adding projects.', 'info');
    openSettingsModal();
    return;
  }

  const workingDir = settings.workingDirectory;
  let projectFolder = null;

  // ── File picker display ──────────────────────────────────────────────
  const fileDisplay   = el('div', { class: 'path-display placeholder' }, ['No file selected']);
  const folderDisplay = el('div', {
    style: { fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: '4px', wordBreak: 'break-all' },
  }, ['']);
  const browseBtn = el('button', { class: 'btn btn-secondary' }, ['Browse...']);

  browseBtn.addEventListener('click', async () => {
    const result = await window.electronAPI.selectProjectFile();
    if (!result) return;

    projectFolder = result.projectFolder;
    fileDisplay.textContent = result.filePath.split(/[\\/]/).pop(); // filename only
    fileDisplay.classList.remove('placeholder');
    folderDisplay.textContent = `📁 ${result.projectFolder}`;
    nameInput.value = result.projectName;
    confirmBtn.disabled = false;
  });

  // ── Name ─────────────────────────────────────────────────────────────
  const nameInput = el('input', { class: 'input', type: 'text', placeholder: 'Project name' });

  // Extract all unique group names (active + empty custom groups)
  const existingGroups = getGroups();

  const datalistId = 'group-suggestions-' + Date.now();
  const datalistEl = el('datalist', { id: datalistId }, 
    existingGroups.map(g => el('option', { value: g }))
  );

  // ── Group Path ───────────────────────────────────────────────────────
  const groupInput = el('input', {
    class: 'input',
    type: 'text',
    placeholder: 'e.g., Line 1/Cell A (optional)',
    value: defaultGroupPath,
    list: datalistId
  });

  // ── Copy / Move ───────────────────────────────────────────────────────
  const modeCopy = makeRadio('add-mode', 'copy', 'Copy  (keep original)', true);
  const modeMove = makeRadio('add-mode', 'move', 'Move  (delete original after)', false);

  // ── Progress ──────────────────────────────────────────────────────────
  const progressSection = el('div', { class: 'progress-section', style: { display: 'none' } }, [
    el('div', { class: 'progress-label' }, [
      el('span', { class: 'progress-op' }, ['Working...']),
      el('span', { class: 'progress-pct' }, ['0%']),
    ]),
    el('div', { class: 'progress-bar' }, [el('div', { class: 'progress-bar-fill' })]),
    el('div', { class: 'progress-file' }, ['']),
  ]);

  const bodyEl = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } }, [
    el('div', { class: 'form-group' }, [
      el('label', { class: 'form-label' }, ['TIA Portal Project File (.ap??)'] ),
      el('div', { class: 'path-picker' }, [fileDisplay, browseBtn]),
      folderDisplay,
    ]),
    el('div', { class: 'form-group' }, [
      el('label', { class: 'form-label' }, ['Project Name']),
      nameInput,
    ]),
    el('div', { class: 'form-group' }, [
      el('label', { class: 'form-label' }, ['Group Path']),
      groupInput,
      datalistEl,
      el('div', { class: 'form-hint' }, ['Use slashes (/) to build nested folder tree hierarchy (e.g. Area 1/Line 2)']),
    ]),
    el('div', { class: 'form-group' }, [
      el('label', { class: 'form-label' }, ['Action']),
      el('div', { style: { display: 'flex', gap: '8px' } }, [modeCopy, modeMove]),
      el('div', { class: 'form-hint' }, [`Destination: ${workingDir}`]),
    ]),
    progressSection,
  ]);

  const cancelBtn  = el('button', { class: 'btn btn-secondary' }, ['Cancel']);
  const confirmBtn = el('button', { class: 'btn btn-primary' }, ['Add Project']);
  confirmBtn.disabled = true;

  const footer = el('div', { style: { display: 'flex', gap: '8px' } }, [cancelBtn, confirmBtn]);

  const { close } = createModal({
    id: 'add-project',
    title: 'Add Project to Workspace',
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

  confirmBtn.addEventListener('click', async () => {
    if (!projectFolder) return;
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    confirmBtn.textContent = 'Working...';

    const mode = document.querySelector('input[name="add-mode"]:checked')?.value || 'copy';
    window.electronAPI.onProgress(progressHandler);

    try {
      const project = await window.electronAPI.importProject({
        sourcePath: projectFolder,
        name: nameInput.value.trim() || undefined,
        mode,
        group: groupInput.value.trim() || undefined,
      });
      addProject(project);
      const verb = mode === 'move' ? 'moved' : 'copied';
      showToast(`"${project.name}" ${verb} into workspace.`, 'success');
      close();
    } catch (err) {
      showToast(err?.message || 'Failed to add project.', 'error');
      confirmBtn.disabled = false;
      cancelBtn.disabled = false;
      confirmBtn.textContent = 'Add Project';
    } finally {
      window.electronAPI.offProgress(progressHandler);
    }
  });
}

function makeRadio(name, value, label, checked) {
  const id = `radio-${name}-${value}`;
  const input = el('input', { type: 'radio', name, value, id, style: { accentColor: 'var(--accent)' } });
  input.checked = checked;
  return el('label', {
    for: id,
    style: {
      display: 'flex', alignItems: 'center', gap: '6px',
      fontSize: '13px', cursor: 'pointer',
      padding: '5px 12px', borderRadius: '6px',
      border: '1px solid var(--border)', background: 'var(--bg-input)',
    },
  }, [input, label]);
}
