import { el, empty, showContextMenu, showToast } from '../utils/dom.js';
import { on } from '../event-bus.js';
import { getProjects, getSelectedProjectId, setSelectedProject, removeProject, updateProject, getGroups, setActiveView, getActiveView } from '../state.js';
import { api } from '../api.js';
import { openAddProjectModal } from './modals/modal-add-project.js';

let currentSearch = '';
let currentSortMode = localStorage.getItem('tia-project-sort-mode') || 'alphabetical-asc';
const collapsedGroups = new Set(JSON.parse(localStorage.getItem('tia-collapsed-groups') || '[]'));

let listEl = null;

export function mountSidebar(containerEl) {
  empty(containerEl);

  // 1. Create Header
  const addBtn = el('button', { class: 'btn btn-ghost btn-icon', title: 'Add Project' }, ['+']);
  addBtn.addEventListener('click', () => openAddProjectModal());

  const headerEl = el('div', { id: 'sidebar-header' }, [
    el('span', { class: 'section-label' }, ['Projects']),
    addBtn,
  ]);
  containerEl.appendChild(headerEl);

  // 2. Create Controls (Search & Sort)
  const searchInput = el('input', {
    class: 'sidebar-search-input',
    type: 'text',
    placeholder: 'Search projects...',
    value: currentSearch,
  });

  const clearBtn = el('button', {
    class: 'sidebar-search-clear',
    style: { display: currentSearch ? 'flex' : 'none' },
    title: 'Clear search',
  }, ['✕']);

  searchInput.addEventListener('input', (e) => {
    currentSearch = e.target.value;
    clearBtn.style.display = currentSearch ? 'flex' : 'none';
    renderList();
  });

  clearBtn.addEventListener('click', () => {
    currentSearch = '';
    searchInput.value = '';
    clearBtn.style.display = 'none';
    renderList();
    searchInput.focus();
  });

  const searchContainer = el('div', { class: 'sidebar-search-container' }, [
    searchInput,
    clearBtn,
  ]);

  const sortBtn = el('button', {
    class: 'btn btn-ghost btn-icon btn-sm',
    id: 'btn-sidebar-sort',
    title: 'Sort projects',
  }, ['⇅']);

  sortBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showContextMenu([
      {
        label: getSortLabel('alphabetical-asc'),
        action: () => updateSortMode('alphabetical-asc'),
      },
      {
        label: getSortLabel('alphabetical-desc'),
        action: () => updateSortMode('alphabetical-desc'),
      },
      {
        label: getSortLabel('date-desc'),
        action: () => updateSortMode('date-desc'),
      },
      {
        label: getSortLabel('date-asc'),
        action: () => updateSortMode('date-asc'),
      },
      {
        label: getSortLabel('snapshots-desc'),
        action: () => updateSortMode('snapshots-desc'),
      },
    ], e.clientX, e.clientY);
  });

  const controlsEl = el('div', { id: 'sidebar-controls' }, [
    searchContainer,
    sortBtn,
  ]);
  containerEl.appendChild(controlsEl);

  // Create Root Drop Zone
  const rootDropZone = el('div', {
    class: 'root-drop-zone hidden',
    id: 'sidebar-root-drop',
  }, ['🏠  Drop here to move to Root']);

  rootDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
  });
  rootDropZone.addEventListener('dragenter', () => {
    rootDropZone.classList.add('drag-over');
  });
  rootDropZone.addEventListener('dragleave', () => {
    rootDropZone.classList.remove('drag-over');
  });
  rootDropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    rootDropZone.classList.remove('drag-over');
    const projectId = e.dataTransfer.getData('text/plain');
    if (!projectId) return;

    const p = getProjects().find(proj => proj.id === projectId);
    if (p && p.group === '') return;

    try {
      await api.updateProject(projectId, { group: '' });
      updateProject(projectId, { group: '' });
      showToast(`Moved "${p ? p.name : 'project'}" to Root.`, 'success');
    } catch (err) {
      showToast(err?.message || 'Failed to move project.', 'error');
    }
  });
  containerEl.appendChild(rootDropZone);

  // 3. Create List element
  listEl = el('ul', { id: 'project-list' });
  containerEl.appendChild(listEl);

  // 4. Create Footer
  const footerEl = el('div', { id: 'sidebar-footer' }, [
    el('button', {
      class: 'btn btn-ghost',
      style: { width: '100%', justifyContent: 'flex-start', fontSize: '12px' },
      id: 'btn-cleanup',
    }, ['🧹  Cleanup Snapshots']),
    el('button', {
      class: 'btn btn-ghost',
      style: { width: '100%', justifyContent: 'flex-start', fontSize: '12px' },
      id: 'btn-label-manager',
    }, ['⬡  Manage Labels']),
    el('button', {
      class: 'btn btn-ghost',
      style: { width: '100%', justifyContent: 'flex-start', fontSize: '12px' },
      id: 'btn-settings',
    }, ['⚙  Settings']),
  ]);

  const cleanupBtn = footerEl.querySelector('#btn-cleanup');
  cleanupBtn?.addEventListener('click', () => setActiveView('cleanup'));
  const syncCleanupBtn = () => {
    cleanupBtn?.classList.toggle('active-view-btn', getActiveView() === 'cleanup');
  };
  syncCleanupBtn();
  on('state:view-changed', syncCleanupBtn);

  footerEl.querySelector('#btn-label-manager')?.addEventListener('click', async () => {
    const { openLabelManagerModal } = await import('./modals/modal-label-manager.js');
    openLabelManagerModal();
  });

  footerEl.querySelector('#btn-settings')?.addEventListener('click', async () => {
    const { openSettingsModal } = await import('./modals/modal-settings.js');
    openSettingsModal();
  });

  containerEl.appendChild(footerEl);

  // Right click on empty space in sidebar
  containerEl.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.group-item') || e.target.closest('.project-item') || e.target.closest('.btn') || e.target.closest('input')) {
      return;
    }
    e.preventDefault();
    const allProjects = getProjects();
    showContextMenu([
      {
        label: '➕  Add Project...',
        action: () => openAddProjectModal()
      },
      {
        label: '📁  Add Group...',
        action: () => openAddGroupModal('', allProjects)
      }
    ], e.clientX, e.clientY);
  });

  // Event listeners
  on('state:projects-changed', () => renderList());
  on('state:selection-changed', () => renderList());
  on('state:versions-changed', () => renderList());

  // Add sidebar resizer
  const resizer = el('div', { class: 'sidebar-resizer' });
  containerEl.appendChild(resizer);

  let isResizing = false;
  resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizer.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const newWidth = Math.max(180, Math.min(480, e.clientX));
    containerEl.style.width = `${newWidth}px`;
    localStorage.setItem('tia-sidebar-width', newWidth);
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      resizer.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });

  const savedWidth = localStorage.getItem('tia-sidebar-width');
  if (savedWidth) {
    containerEl.style.width = `${savedWidth}px`;
  }

  // Initial render
  renderList();
}

function getSortLabel(mode) {
  const check = currentSortMode === mode ? '✓ ' : '  ';
  switch (mode) {
    case 'alphabetical-asc':  return `${check}Alphabetical (A-Z)`;
    case 'alphabetical-desc': return `${check}Alphabetical (Z-A)`;
    case 'date-desc':         return `${check}Date Added (Newest)`;
    case 'date-asc':          return `${check}Date Added (Oldest)`;
    case 'snapshots-desc':    return `${check}Snapshots (Most)`;
    default:                  return mode;
  }
}

function updateSortMode(mode) {
  currentSortMode = mode;
  localStorage.setItem('tia-project-sort-mode', mode);
  renderList();
}

function renderList() {
  if (!listEl) return;
  empty(listEl);

  const projects = getProjects();
  const selectedId = getSelectedProjectId();

  if (projects.length === 0) {
    const hint = el('li', {
      style: {
        padding: '16px',
        fontSize: '12px',
        color: 'var(--text-muted)',
        lineHeight: '1.5',
        textAlign: 'center',
      }
    }, ['No projects yet.\nClick + to add a TIA Portal project folder.']);
    hint.style.whiteSpace = 'pre-line';
    listEl.appendChild(hint);
    return;
  }

  // 1. Build and Filter Tree
  const treeRoot = buildTree(projects, currentSearch);

  // 2. Check if search matches anything
  const totalMatchingProjects = countTreeProjects(treeRoot);
  if (totalMatchingProjects === 0 && currentSearch) {
    const hint = el('li', {
      style: {
        padding: '16px',
        fontSize: '12px',
        color: 'var(--text-muted)',
        textAlign: 'center',
      }
    }, ['No matching projects found.']);
    listEl.appendChild(hint);
    return;
  }

  // 3. Render Tree recursively
  renderTree(treeRoot, 0, listEl, selectedId);
}

function buildTree(projects, search) {
  const root = { name: '', fullName: '', groups: {}, projects: [] };
  const searchLower = search.trim().toLowerCase();

  // Seed empty/custom groups from localStorage
  const customGroups = JSON.parse(localStorage.getItem('tia-custom-groups') || '[]');
  for (const groupPathStr of customGroups) {
    if (searchLower && !groupPathStr.toLowerCase().includes(searchLower)) {
      continue;
    }
    const groupPath = groupPathStr.split('/').map(g => g.trim()).filter(Boolean);
    let current = root;
    let fullGroupPath = '';
    for (const segment of groupPath) {
      fullGroupPath = fullGroupPath ? `${fullGroupPath}/${segment}` : segment;
      if (!current.groups[segment]) {
        current.groups[segment] = {
          name: segment,
          fullName: fullGroupPath,
          groups: {},
          projects: []
        };
      }
      current = current.groups[segment];
    }
  }

  for (const project of projects) {
    const nameMatches = project.name.toLowerCase().includes(searchLower);
    const groupMatches = project.group && project.group.toLowerCase().includes(searchLower);

    if (searchLower && !nameMatches && !groupMatches) {
      continue;
    }

    const groupPath = project.group
      ? project.group.split('/').map(g => g.trim()).filter(Boolean)
      : [];

    let current = root;
    let fullGroupPath = '';
    for (const segment of groupPath) {
      fullGroupPath = fullGroupPath ? `${fullGroupPath}/${segment}` : segment;
      if (!current.groups[segment]) {
        current.groups[segment] = {
          name: segment,
          fullName: fullGroupPath,
          groups: {},
          projects: []
        };
      }
      current = current.groups[segment];
    }
    current.projects.push(project);
  }

  return root;
}

function countTreeProjects(node) {
  let count = node.projects.length;
  for (const key in node.groups) {
    count += countTreeProjects(node.groups[key]);
  }
  return count;
}

function getProjectSorter(sortMode) {
  switch (sortMode) {
    case 'alphabetical-desc':
      return (a, b) => b.name.localeCompare(a.name);
    case 'date-desc':
      return (a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0);
    case 'date-asc':
      return (a, b) => new Date(a.addedAt || 0) - new Date(b.addedAt || 0);
    case 'snapshots-desc':
      return (a, b) => (b.versions?.length || 0) - (a.versions?.length || 0);
    case 'alphabetical-asc':
    default:
      return (a, b) => a.name.localeCompare(b.name);
  }
}

function getGroupSorter(sortMode) {
  if (sortMode === 'alphabetical-desc') {
    return (a, b) => b.localeCompare(a);
  }
  return (a, b) => a.localeCompare(b);
}

function renderTree(node, depth, container, selectedId) {
  // 1. Render groups
  const groupKeys = Object.keys(node.groups).sort(getGroupSorter(currentSortMode));
  for (const key of groupKeys) {
    const subGroup = node.groups[key];
    const totalProjectsInSubGroup = countTreeProjects(subGroup);

    // Auto-expand all groups if searching, otherwise use collapsedGroups state
    const isCollapsed = currentSearch ? false : collapsedGroups.has(subGroup.fullName);

    const arrow = el('span', { class: `group-arrow${isCollapsed ? ' collapsed' : ''}` }, [
      isCollapsed ? '▶' : '▼'
    ]);
    const folderIcon = el('span', { class: 'group-icon' }, [
      isCollapsed ? '📁' : '📂'
    ]);
    const nameEl = el('span', { class: 'group-name' }, [subGroup.name]);
    const countEl = el('span', { class: 'group-count' }, [`(${totalProjectsInSubGroup})`]);

    const groupRow = el('div', {
      class: 'group-item',
      style: { paddingLeft: `${depth * 12 + 16}px` }
    }, [
      arrow,
      folderIcon,
      nameEl,
      countEl
    ]);

    // Drop listeners for folders
    groupRow.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    groupRow.addEventListener('dragenter', (e) => {
      e.preventDefault();
      groupRow.classList.add('drag-over');
    });
    groupRow.addEventListener('dragleave', () => {
      groupRow.classList.remove('drag-over');
    });
    groupRow.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      groupRow.classList.remove('drag-over');

      const projectId = e.dataTransfer.getData('text/plain');
      if (!projectId) return;

      const p = getProjects().find(proj => proj.id === projectId);
      if (p && p.group === subGroup.fullName) return;

      try {
        await api.updateProject(projectId, { group: subGroup.fullName });
        updateProject(projectId, { group: subGroup.fullName });
        showToast(`Moved "${p ? p.name : 'project'}" to ${subGroup.name}.`, 'success');
      } catch (err) {
        showToast(err?.message || 'Failed to move project.', 'error');
      }
    });

    groupRow.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const allProjects = getProjects();

      showContextMenu([
        {
          label: '➕  Add Project...',
          action: () => {
            openAddProjectModal(subGroup.fullName);
          }
        },
        'sep',
        {
          label: '➕  Add Subgroup...',
          action: () => {
            openAddGroupModal(subGroup.fullName, allProjects);
          }
        },
        {
          label: '✏️  Rename Group...',
          action: () => {
            openRenameGroupModal(subGroup.fullName, allProjects);
          }
        },
        {
          label: '✕  Delete Group',
          danger: true,
          action: () => {
            showConfirmModal(
              'Delete Group',
              `Are you sure you want to delete the group "${subGroup.name}"? Projects inside will be moved to the parent group.`,
              async () => {
                const parentPath = subGroup.fullName.includes('/') 
                  ? subGroup.fullName.substring(0, subGroup.fullName.lastIndexOf('/')) 
                  : '';
                
                const targetProjects = allProjects.filter(p => 
                  p.group === subGroup.fullName || p.group.startsWith(subGroup.fullName + '/')
                );
                
                try {
                  for (const p of targetProjects) {
                    let newPath = parentPath;
                    if (p.group.startsWith(subGroup.fullName + '/')) {
                      newPath = parentPath ? parentPath + p.group.substring(subGroup.fullName.length) : p.group.substring(subGroup.fullName.length + 1);
                    }
                    await api.updateProject(p.id, { group: newPath });
                    updateProject(p.id, { group: newPath });
                  }

                  // Clean up empty groups list in localStorage
                  let customGroups = JSON.parse(localStorage.getItem('tia-custom-groups') || '[]');
                  customGroups = customGroups.filter(g => g !== subGroup.fullName && !g.startsWith(subGroup.fullName + '/'));
                  localStorage.setItem('tia-custom-groups', JSON.stringify(customGroups));

                  showToast(`Group "${subGroup.name}" deleted.`, 'success');
                  renderList();
                } catch (err) {
                  showToast(err?.message || 'Failed to delete group.', 'error');
                }
              }
            );
          }
        }
      ], e.clientX, e.clientY);
    });

    groupRow.addEventListener('click', (e) => {
      e.stopPropagation();
      if (collapsedGroups.has(subGroup.fullName)) {
        collapsedGroups.delete(subGroup.fullName);
      } else {
        collapsedGroups.add(subGroup.fullName);
      }
      localStorage.setItem('tia-collapsed-groups', JSON.stringify([...collapsedGroups]));
      renderList();
    });

    container.appendChild(groupRow);

    if (!isCollapsed) {
      renderTree(subGroup, depth + 1, container, selectedId);
    }
  }

  // 2. Render projects
  const sortedProjects = [...node.projects].sort(getProjectSorter(currentSortMode));
  for (const project of sortedProjects) {
    const projectItem = renderProjectItem(project, project.id === selectedId, depth);
    container.appendChild(projectItem);
  }
}

function renderProjectItem(project, isActive, depth) {
  const versionCount = project.versions?.length || 0;

  const ctxBtn = el('button', { class: 'ctx-btn', title: 'Options' }, ['⋯']);

  const item = el('li', {
    class: `project-item${isActive ? ' active' : ''}`,
    style: { paddingLeft: `${depth * 12 + 16}px` },
    draggable: 'true'
  }, [
    el('div', { class: 'project-dot', style: { background: project.color } }),
    el('div', { class: 'project-info' }, [
      el('div', { class: 'name' }, [project.name]),
      el('div', { class: 'meta' }, [`${versionCount} snapshot${versionCount !== 1 ? 's' : ''}`]),
    ]),
    ctxBtn,
  ]);

  function openProjectContextMenu(x, y) {
    showContextMenu([
      {
        label: '📂  Open in Explorer',
        action: () => api.openInExplorer(project.sourcePath),
      },
      {
        label: '🔧  Open in TIA Portal',
        action: () => api.openInTia(project.sourcePath),
      },
      {
        label: '✏️  Edit Project Details',
        action: async () => {
          const { openEditProjectModal } = await import('./modals/modal-edit-project.js');
          openEditProjectModal(project);
        }
      },
      {
        label: '⇄  Move to Group...',
        action: () => {
          const allGroups = getGroups();

          const choices = [
            {
              label: '🏠  Root (Ungrouped)',
              action: async () => {
                try {
                  await api.updateProject(project.id, { group: '' });
                  updateProject(project.id, { group: '' });
                  showToast(`Moved "${project.name}" to Root.`, 'success');
                } catch (err) {
                  showToast(err?.message || 'Failed to move project to Root.', 'error');
                }
              }
            },
            'sep'
          ];

          allGroups.forEach(g => {
            choices.push({
              label: `📁  ${g}`,
              action: async () => {
                try {
                  await api.updateProject(project.id, { group: g });
                  updateProject(project.id, { group: g });
                  showToast(`Moved "${project.name}" to ${g}.`, 'success');
                } catch (err) {
                  showToast(err?.message || `Failed to move project to ${g}.`, 'error');
                }
              }
            });
          });

          choices.push('sep');
          choices.push({
            label: '➕  New Group...',
            action: async () => {
              const { openEditProjectModal } = await import('./modals/modal-edit-project.js');
              openEditProjectModal(project);
            }
          });

          showContextMenu(choices, x, y);
        }
      },
      'sep',
      {
        label: '✕  Remove Project',
        danger: true,
        action: async () => {
          removeProject(project.id);
          await api.removeProject(project.id);
          showToast(`Project "${project.name}" removed.`, 'info');
        },
      },
    ], x, y);
  }

  // Right click context menu on project item
  item.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openProjectContextMenu(e.clientX, e.clientY);
  });

  // Drag listeners on project items
  item.addEventListener('dragstart', (e) => {
    item.classList.add('dragging');
    e.dataTransfer.setData('text/plain', project.id);
    e.dataTransfer.effectAllowed = 'move';
    document.getElementById('sidebar-root-drop')?.classList.remove('hidden');
  });

  item.addEventListener('dragend', () => {
    item.classList.remove('dragging');
    document.getElementById('sidebar-root-drop')?.classList.add('hidden');
  });

  item.addEventListener('click', (e) => {
    if (e.target === ctxBtn) return;
    setSelectedProject(project.id);
  });

  ctxBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const rect = ctxBtn.getBoundingClientRect();
    openProjectContextMenu(rect.left, rect.bottom);
  });

  return item;
}

function openRenameGroupModal(groupPath, projects) {
  const groupName = groupPath.split('/').pop();
  showPromptModal(
    'Rename Group',
    'Enter new name for the group:',
    groupName,
    (newName) => {
      if (!newName) {
        showToast('Group name cannot be empty.', 'error');
        return;
      }
      if (newName.includes('/')) {
        showToast('Group name cannot contain slashes.', 'error');
        return;
      }

      const segments = groupPath.split('/');
      segments[segments.length - 1] = newName;
      const newPath = segments.join('/');

      // Update custom groups in localStorage
      const customGroups = JSON.parse(localStorage.getItem('tia-custom-groups') || '[]');
      const updatedCustom = customGroups.map(g => {
        if (g === groupPath) return newPath;
        if (g.startsWith(groupPath + '/')) return newPath + g.substring(groupPath.length);
        return g;
      });
      localStorage.setItem('tia-custom-groups', JSON.stringify(updatedCustom));

      const targetProjects = projects.filter(p => 
        p.group === groupPath || p.group.startsWith(groupPath + '/')
      );

      renameGroupProjects(targetProjects, groupPath, newPath);
    }
  );
}

async function renameGroupProjects(targetProjects, oldPath, newPath) {
  try {
    for (const p of targetProjects) {
      let updatedPath = newPath;
      if (p.group.startsWith(oldPath + '/')) {
        updatedPath = newPath + p.group.substring(oldPath.length);
      }
      await api.updateProject(p.id, { group: updatedPath });
      updateProject(p.id, { group: updatedPath });
    }
    showToast('Group renamed successfully.', 'success');
  } catch (err) {
    showToast(err?.message || 'Failed to rename group.', 'error');
  }
}

function openAddGroupModal(parentGroupPath = '', projects) {
  const isRoot = !parentGroupPath;
  const title = isRoot ? 'Add Group' : 'Add Subgroup';
  const label = isRoot 
    ? 'Enter name for the new group:' 
    : `Enter name for the new subgroup under "${parentGroupPath}":`;
    
  showPromptModal(
    title,
    label,
    '',
    (groupName) => {
      if (!groupName) {
        showToast('Group name cannot be empty.', 'error');
        return;
      }
      if (groupName.includes('/')) {
        showToast('Group name cannot contain slashes.', 'error');
        return;
      }

      const newGroupPath = isRoot ? groupName : `${parentGroupPath}/${groupName}`;

      // Save to custom groups in localStorage
      const customGroups = JSON.parse(localStorage.getItem('tia-custom-groups') || '[]');
      if (!customGroups.includes(newGroupPath)) {
        customGroups.push(newGroupPath);
        localStorage.setItem('tia-custom-groups', JSON.stringify(customGroups));
      }

      showToast(`${isRoot ? 'Group' : 'Subgroup'} "${groupName}" created.`, 'success');
      renderList();
    }
  );
}

async function showPromptModal(title, fieldLabel, defaultValue, onSubmit) {
  const { createModal } = await import('./modals/modal-base.js');

  const inputEl = el('input', {
    class: 'input',
    type: 'text',
    value: defaultValue || '',
    style: { width: '100%' }
  });

  const bodyEl = el('div', { class: 'form-group' }, [
    el('label', { class: 'form-label' }, [fieldLabel]),
    inputEl
  ]);

  const cancelBtn = el('button', { class: 'btn btn-secondary' }, ['Cancel']);
  const okBtn = el('button', { class: 'btn btn-primary' }, ['OK']);

  const footerEl = el('div', { style: { display: 'flex', gap: '8px' } }, [cancelBtn, okBtn]);

  const { close } = createModal({
    id: 'custom-prompt',
    title: title,
    size: 'modal-sm',
    bodyContent: bodyEl,
    footerContent: footerEl
  });

  // Focus input automatically
  setTimeout(() => inputEl.focus(), 100);

  cancelBtn.addEventListener('click', close);
  okBtn.addEventListener('click', () => {
    const val = inputEl.value.trim();
    onSubmit(val);
    close();
  });

  // Allow pressing Enter key to submit
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = inputEl.value.trim();
      onSubmit(val);
      close();
    }
  });
}

async function showConfirmModal(title, text, onConfirm) {
  const { createModal } = await import('./modals/modal-base.js');

  const bodyEl = el('div', { style: { fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' } }, [text]);

  const cancelBtn = el('button', { class: 'btn btn-secondary' }, ['Cancel']);
  const confirmBtn = el('button', { class: 'btn btn-danger' }, ['Delete']);

  const footerEl = el('div', { style: { display: 'flex', gap: '8px' } }, [cancelBtn, confirmBtn]);

  const { close } = createModal({
    id: 'custom-confirm',
    title: title,
    size: 'modal-sm',
    bodyContent: bodyEl,
    footerContent: footerEl
  });

  cancelBtn.addEventListener('click', close);
  confirmBtn.addEventListener('click', () => {
    onConfirm();
    close();
  });
}
