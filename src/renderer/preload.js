const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Projects
  getProjects:    ()           => ipcRenderer.invoke('projects:getAll'),
  removeProject:  (id)         => ipcRenderer.invoke('projects:remove', { projectId: id }),
  updateProject:  (id, changes)=> ipcRenderer.invoke('projects:update', { projectId: id, changes }),
  importProject:  (data)       => ipcRenderer.invoke('projects:import', data),

  // Versions
  createSnapshot:  (data)      => ipcRenderer.invoke('versions:create', data),
  importSnapshot:  (data)      => ipcRenderer.invoke('versions:import', data),
  deleteVersion:  (pid, vid)   => ipcRenderer.invoke('versions:delete', { projectId: pid, versionId: vid }),
  restoreVersion: (pid, vid, createBackup) => ipcRenderer.invoke('versions:restore', { projectId: pid, versionId: vid, createBackup }),

  // Diff
  compareVersions:(a, b)       => ipcRenderer.invoke('diff:compare', { versionIdA: a, versionIdB: b }),
  getFileDiff:    (a, b, fp)   => ipcRenderer.invoke('diff:getFileDiff', { versionIdA: a, versionIdB: b, filePath: fp }),

  // Semantic (Openness) Diff
  detectTia:         ()        => ipcRenderer.invoke('diff:detectTia'),
  checkXmlExport:    (vid)     => ipcRenderer.invoke('diff:checkXmlExport', { versionId: vid }),
  generateXmlExport: (vid)     => ipcRenderer.invoke('diff:generateXmlExport', { versionId: vid }),
  compareXml:        (a, b)    => ipcRenderer.invoke('diff:compareXml', { versionIdA: a, versionIdB: b }),
  openBlockInCompareTool: (pA, pB)     => ipcRenderer.invoke('diff:openBlockInCompareTool', { pathA: pA, pathB: pB }),

  // Labels
  getLabels:      ()           => ipcRenderer.invoke('labels:getAll'),
  createLabel:    (data)       => ipcRenderer.invoke('labels:create', data),
  updateLabel:    (id, changes)=> ipcRenderer.invoke('labels:update', { id, changes }),
  deleteLabel:    (id)         => ipcRenderer.invoke('labels:delete', { id }),

  // Settings
  getSettings:    ()           => ipcRenderer.invoke('settings:get'),
  updateSettings: (changes)    => ipcRenderer.invoke('settings:update', { changes }),
  getAppVersion:  ()           => ipcRenderer.invoke('app:getVersion'),
  readReadme:     ()           => ipcRenderer.invoke('app:readReadme'),
  readHelp:       ()           => ipcRenderer.invoke('app:readHelp'),
  openExternal:   (url)        => ipcRenderer.invoke('app:openExternal', { url }),

  // Dialogs
  selectFolder:      ()        => ipcRenderer.invoke('dialog:selectFolder'),
  selectProjectFile: ()        => ipcRenderer.invoke('dialog:selectProjectFile'),
  selectExeFile:     ()        => ipcRenderer.invoke('dialog:selectExeFile'),
  openInExplorer: (path)       => ipcRenderer.invoke('dialog:openInExplorer', { path }),
  openInTia:      (folderPath) => ipcRenderer.invoke('project:openInTia', { folderPath }),

  // Window controls
  minimize:       ()           => ipcRenderer.invoke('window:minimize'),
  maximize:       ()           => ipcRenderer.invoke('window:maximize'),
  closeWindow:    ()           => ipcRenderer.invoke('window:close'),

  // Progress stream
  onProgress:        (cb) => ipcRenderer.on('progress:update',    (_e, data) => cb(data)),
  offProgress:       (cb) => ipcRenderer.removeListener('progress:update', cb),

  // Detailed export status for the diff modal
  onExportStatus:    (cb) => ipcRenderer.on('diff:exportStatus',    (_e, data) => cb(data)),
  offExportStatus:   (cb) => ipcRenderer.removeListener('diff:exportStatus', cb),

  // Block-by-block comparison progress
  onCompareProgress: (cb) => ipcRenderer.on('diff:compareProgress', (_e, data) => cb(data)),
  offCompareProgress:(cb) => ipcRenderer.removeListener('diff:compareProgress', cb),
});
