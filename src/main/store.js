const fs = require('fs');
const path = require('path');

const DEFAULT_LABELS = [
  { id: 'label-release',   name: 'Release',   color: '#a6e3a1', builtIn: true },
  { id: 'label-milestone', name: 'Milestone', color: '#89b4fa', builtIn: true },
  { id: 'label-wip',       name: 'WIP',       color: '#fab387', builtIn: true },
  { id: 'label-backup',    name: 'Backup',    color: '#9399b2', builtIn: true },
];

const DEFAULT_DATA = {
  schemaVersion: 2,
  projects: [],
  labelDefinitions: DEFAULT_LABELS,
  settings: {
    workingDirectory: null,       // Parent folder where active projects live
    confirmBeforeRestore: true,
    maxVersionsPerProject: 0,
    externalCompareTool: { exePath: null, argTemplate: '"{pathA}" "{pathB}"' },
  },
};

class Store {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'app-data.json');
    this.tmpPath = this.filePath + '.tmp';
    this.data = null;
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      this.data = JSON.parse(raw);
      if (!this.data.labelDefinitions) this.data.labelDefinitions = DEFAULT_LABELS;
      if (!this.data.settings) this.data.settings = {};
      // Migrate: remove old snapshotRootDir key
      delete this.data.settings.snapshotRootDir;
      // Ensure all default setting keys exist
      for (const [k, v] of Object.entries(DEFAULT_DATA.settings)) {
        if (!(k in this.data.settings)) this.data.settings[k] = v;
      }
      if (!this.data.projects) this.data.projects = [];
      // Schema v1 → v2: add xmlExportPath to all versions
      if ((this.data.schemaVersion || 1) < 2) {
        for (const project of this.data.projects) {
          for (const version of (project.versions || [])) {
            if (!('xmlExportPath' in version)) version.xmlExportPath = null;
          }
        }
        this.data.schemaVersion = 2;
      }
    } catch (_) {
      this.data = JSON.parse(JSON.stringify(DEFAULT_DATA));
    }
    return this;
  }

  save() {
    const json = JSON.stringify(this.data, null, 2);
    fs.writeFileSync(this.tmpPath, json, 'utf-8');
    fs.renameSync(this.tmpPath, this.filePath);
    return this;
  }

  get(key) { return this.data[key]; }
  set(key, value) { this.data[key] = value; return this; }

  getProject(projectId) {
    return this.data.projects.find(p => p.id === projectId) || null;
  }

  getVersion(projectId, versionId) {
    const project = this.getProject(projectId);
    if (!project) return null;
    return project.versions.find(v => v.id === versionId) || null;
  }

  findVersion(versionId) {
    for (const project of this.data.projects) {
      const v = project.versions.find(v => v.id === versionId);
      if (v) return { project, version: v };
    }
    return null;
  }

  /** Returns <workingDir>/_snapshots or null if workingDirectory not set */
  getSnapshotRoot() {
    const wd = this.data.settings.workingDirectory;
    return wd ? require('path').join(wd, '_snapshots') : null;
  }
}

module.exports = Store;
