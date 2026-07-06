import { createModal } from './modal-base.js';
import { el, showToast } from '../../utils/dom.js';
import { updateProject, getProjects, getGroups } from '../../state.js';
import { api } from '../../api.js';


export function openEditProjectModal(project) {
  // Name Input
  const nameInput = el('input', {
    class: 'input',
    type: 'text',
    placeholder: 'Project name',
    value: project.name || '',
  });

  // Extract all unique group names (active + empty custom groups)
  const existingGroups = getGroups();

  const datalistId = 'group-suggestions-' + Date.now();
  const datalistEl = el('datalist', { id: datalistId }, 
    existingGroups.map(g => el('option', { value: g }))
  );

  // Group Input
  const groupInput = el('input', {
    class: 'input',
    type: 'text',
    placeholder: 'e.g., Line 1/Cell A (optional)',
    value: project.group || '',
    list: datalistId,
  });

  const bodyEl = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } }, [
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
  ]);

  const cancelBtn = el('button', { class: 'btn btn-secondary' }, ['Cancel']);
  const saveBtn   = el('button', { class: 'btn btn-primary' }, ['Save Changes']);

  const footer = el('div', { style: { display: 'flex', gap: '8px' } }, [cancelBtn, saveBtn]);

  const { close } = createModal({
    id: 'edit-project',
    title: 'Edit Project Details',
    size: 'modal-md',
    bodyContent: bodyEl,
    footerContent: footer,
  });

  cancelBtn.addEventListener('click', close);

  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      showToast('Project name cannot be empty.', 'error');
      return;
    }

    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    const group = groupInput.value.trim();

    try {
      await api.updateProject(project.id, { name, group });
      updateProject(project.id, { name, group });
      showToast('Project details updated.', 'success');
      close();
    } catch (err) {
      showToast(err?.message || 'Failed to update project details.', 'error');
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  });
}
