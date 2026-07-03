import { showToast } from './utils/dom.js';

async function call(fn, ...args) {
  try {
    return await fn(...args);
  } catch (err) {
    const message = err?.message || String(err);
    showToast(message, 'error');
    throw err;
  }
}

export const api = {
  getProjects:    ()           => call(window.electronAPI.getProjects),
  importProject:  (data)       => call(window.electronAPI.importProject, data),
  removeProject:  (id)         => call(window.electronAPI.removeProject, id),
  updateProject:  (id, ch)     => call(window.electronAPI.updateProject, id, ch),

  createSnapshot: (data)       => call(window.electronAPI.createSnapshot, data),
  deleteVersion:  (pid, vid)   => call(window.electronAPI.deleteVersion, pid, vid),
  restoreVersion: (pid, vid, createBackup) => call(window.electronAPI.restoreVersion, pid, vid, createBackup),

  getLabels:      ()           => call(window.electronAPI.getLabels),
  createLabel:    (data)       => call(window.electronAPI.createLabel, data),
  updateLabel:    (id, ch)     => call(window.electronAPI.updateLabel, id, ch),
  deleteLabel:    (id)         => call(window.electronAPI.deleteLabel, id),

  selectFolder:   ()           => call(window.electronAPI.selectFolder),
  openInExplorer: (path)       => call(window.electronAPI.openInExplorer, path),
  openInTia:      (folderPath) => call(window.electronAPI.openInTia, folderPath),
};
