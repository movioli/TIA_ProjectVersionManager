import { emit } from './event-bus.js';

const state = {
  projects: [],
  labels: [],
  selectedProjectId: null,
  diffSelectionIds: [],   // max 2 version IDs checked for diff
};

export function getProjects()          { return state.projects; }
export function getLabels()            { return state.labels; }
export function getSelectedProjectId() { return state.selectedProjectId; }
export function getDiffSelection()     { return state.diffSelectionIds; }

export function getSelectedProject() {
  return state.projects.find(p => p.id === state.selectedProjectId) || null;
}

export function setProjects(projects) {
  state.projects = projects;
  emit('state:projects-changed', projects);
}

export function setLabels(labels) {
  state.labels = labels;
  emit('state:labels-changed', labels);
}

export function setSelectedProject(id) {
  state.selectedProjectId = id;
  state.diffSelectionIds = [];
  emit('state:selection-changed', id);
}

export function addProject(project) {
  state.projects.push(project);
  emit('state:projects-changed', state.projects);
  // Auto-select the newly added project
  state.selectedProjectId = project.id;
  state.diffSelectionIds = [];
  emit('state:selection-changed', project.id);
}

export function removeProject(id) {
  state.projects = state.projects.filter(p => p.id !== id);
  if (state.selectedProjectId === id) {
    state.selectedProjectId = state.projects[0]?.id || null;
    state.diffSelectionIds = [];
    emit('state:selection-changed', state.selectedProjectId);
  }
  emit('state:projects-changed', state.projects);
}

export function updateProjectVersions(projectId, versions) {
  const project = state.projects.find(p => p.id === projectId);
  if (project) {
    project.versions = versions;
    emit('state:versions-changed', { projectId, versions });
  }
}

export function addVersion(projectId, version) {
  const project = state.projects.find(p => p.id === projectId);
  if (project) {
    project.versions.push(version);
    emit('state:versions-changed', { projectId, versions: project.versions });
  }
}

export function removeVersion(projectId, versionId) {
  const project = state.projects.find(p => p.id === projectId);
  if (project) {
    project.versions = project.versions.filter(v => v.id !== versionId);
    state.diffSelectionIds = state.diffSelectionIds.filter(id => id !== versionId);
    emit('state:versions-changed', { projectId, versions: project.versions });
  }
}

export function toggleDiffSelection(versionId) {
  const idx = state.diffSelectionIds.indexOf(versionId);
  if (idx !== -1) {
    state.diffSelectionIds.splice(idx, 1);
  } else {
    if (state.diffSelectionIds.length >= 2) {
      state.diffSelectionIds.shift();
    }
    state.diffSelectionIds.push(versionId);
  }
  emit('state:diff-selection-changed', [...state.diffSelectionIds]);
  return [...state.diffSelectionIds];
}

export function clearDiffSelection() {
  state.diffSelectionIds = [];
  emit('state:diff-selection-changed', []);
}

export function updateProject(id, changes) {
  const project = state.projects.find(p => p.id === id);
  if (project) {
    Object.assign(project, changes);
    emit('state:projects-changed', state.projects);
    if (state.selectedProjectId === id) {
      emit('state:selection-changed', id);
    }
  }
}

