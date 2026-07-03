const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('./store');
const { registerHandlers } = require('./ipc-handlers');
const { ensureDir } = require('./utils'); // still needed for userDataPath

app.setName('TIAVersionManager');

let mainWindow = null;

function getMainWindow() {
  return mainWindow;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, '../renderer/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: path.join(__dirname, '../../assets/icon.png'),
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // F12 or Ctrl+Shift+I opens DevTools
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.key === 'F12' ||
        (input.control && input.shift && input.key === 'I')) {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  const userDataPath = app.getPath('userData');
  ensureDir(userDataPath);

  // Determine snapshot root dir
  const store = new Store(userDataPath).load();
  registerHandlers(store, getMainWindow);
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
