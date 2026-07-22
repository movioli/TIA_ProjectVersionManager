import { createModal } from './modal-base.js';
import { el, showToast } from '../../utils/dom.js';
import { emit } from '../../event-bus.js';
import { getTheme, setTheme } from '../../utils/theme.js';

export async function openSettingsModal() {
  const [settings, version] = await Promise.all([
    window.electronAPI.getSettings(),
    window.electronAPI.getAppVersion(),
  ]);

  const wdDisplay = el('div', { class: 'path-display' + (settings.workingDirectory ? '' : ' placeholder') }, [
    settings.workingDirectory || 'Not set',
  ]);
  const wdBrowseBtn = el('button', { class: 'btn btn-secondary' }, ['Browse...']);

  let pendingWorkingDir = settings.workingDirectory;

  wdBrowseBtn.addEventListener('click', async () => {
    const p = await window.electronAPI.selectFolder();
    if (p) {
      pendingWorkingDir = p;
      wdDisplay.textContent = p;
      wdDisplay.classList.remove('placeholder');
    }
  });

  // ── Compare Tool ────────────────────────────────────────────────────────
  const tool = settings.externalCompareTool || {};
  let pendingCompareToolExe = tool.exePath || null;

  const ctExeDisplay = el('div', { class: 'path-display' + (pendingCompareToolExe ? '' : ' placeholder') }, [
    pendingCompareToolExe || 'Not configured',
  ]);
  const ctBrowseBtn = el('button', { class: 'btn btn-secondary' }, ['Browse...']);
  ctBrowseBtn.addEventListener('click', async () => {
    const p = await window.electronAPI.selectExeFile();
    if (p) {
      pendingCompareToolExe = p;
      ctExeDisplay.textContent = p;
      ctExeDisplay.classList.remove('placeholder');
    }
  });

  const confirmRestoreCb = el('input', { type: 'checkbox', id: 'cb-confirm-restore', style: { accentColor: 'var(--accent)' } });
  confirmRestoreCb.checked = settings.confirmBeforeRestore !== false;

  const readmeBtn = el('button', { class: 'btn btn-secondary', style: { flex: 1, justifyContent: 'center' } }, ['📖  View README']);
  const helpBtn = el('button', { class: 'btn btn-secondary', style: { flex: 1, justifyContent: 'center' } }, ['❓  Open Help Guide']);

  readmeBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      const content = await window.electronAPI.readReadme();
      const { openMarkdownModal } = await import('./modal-markdown.js');
      openMarkdownModal('README.md', content);
    } catch (err) {
      showToast(err?.message || 'Failed to read README.', 'error');
    }
  });

  helpBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      const content = await window.electronAPI.readHelp();
      const { openMarkdownModal } = await import('./modal-markdown.js');
      openMarkdownModal('User Help Guide', content);
    } catch (err) {
      showToast(err?.message || 'Failed to read Help Guide.', 'error');
    }
  });

  const bodyEl = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '20px' } }, [

    el('div', { class: 'form-group' }, [
      el('label', { class: 'form-label' }, ['Working Directory']),
      el('div', { class: 'path-picker' }, [wdDisplay, wdBrowseBtn]),
      el('div', { class: 'form-hint' }, [
        'The folder where your TIA Portal projects are kept. ' +
        'Snapshots are stored in a "_snapshots" subfolder here. ' +
        'Required before taking snapshots.',
      ]),
    ]),

    el('div', { class: 'divider' }),

    el('div', { class: 'form-group' }, [
      el('label', { class: 'form-label' }, ['Snapshot Folder Structure']),
      el('div', {
        style: {
          background: 'var(--bg-input)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '12px 14px',
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          color: 'var(--text-secondary)',
          lineHeight: '1.8',
        }
      }, [
        el('div', {}, ['📁 WorkingDirectory/']),
        el('div', { style: { paddingLeft: '20px' } }, ['📁 ProjectName/']),
        el('div', { style: { paddingLeft: '20px' } }, ['📁 _snapshots/']),
        el('div', { style: { paddingLeft: '40px' } }, ['📁 ProjectName/']),
        el('div', { style: { paddingLeft: '60px', color: 'var(--accent)' } }, ['📁 2026-03-13_16.12.47 - My Label/']),
        el('div', { style: { paddingLeft: '60px' } }, ['📁 2026-03-13_09.00.00 - Initial baseline/']),
      ]),
    ]),

    el('div', { class: 'divider' }),

    el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
      confirmRestoreCb,
      el('label', { for: 'cb-confirm-restore', style: { fontSize: '13px', cursor: 'pointer' } }, [
        'Show confirmation dialog before restoring a version',
      ]),
    ]),

    el('div', { class: 'divider' }),

    el('div', { class: 'form-group' }, [
      el('label', { class: 'form-label' }, ['Application Theme']),
      (() => {
        const sel = el('select', { class: 'input', style: { width: 'auto', minWidth: '160px' } }, [
          el('option', { value: 'dark', selected: getTheme() === 'dark' }, ['🌙  Dark Theme']),
          el('option', { value: 'light', selected: getTheme() === 'light' }, ['☀️  Light Theme']),
        ]);
        sel.addEventListener('change', (e) => setTheme(e.target.value));
        return sel;
      })(),
      el('div', { class: 'form-hint' }, ['Choose between Dark (Obsidian) and Light visual themes.']),
    ]),

    el('div', { class: 'divider' }),

    el('div', { class: 'form-group' }, [
      el('label', { class: 'form-label' }, ['SIMATIC Automation Compare Tool']),
      el('div', { class: 'path-picker' }, [ctExeDisplay, ctBrowseBtn]),
      el('div', { class: 'form-hint' }, [
        'Optional — used to open individual blocks side-by-side. ' +
        'Typically installed at: C:\\Program Files\\Siemens\\Automation\\SACT\\...',
      ]),
    ]),

    el('div', { class: 'divider' }),

    el('div', { class: 'form-group' }, [
      el('label', { class: 'form-label' }, ['Documentation & Help']),
      el('div', { style: { display: 'flex', gap: '8px', marginTop: '4px' } }, [readmeBtn, helpBtn]),
    ]),

    el('div', { class: 'divider' }),

    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--text-muted)', fontSize: '11px', marginTop: '5px' } }, [
      el('span', {}, ['TIA Project Version Manager']),
      el('span', { style: { fontFamily: 'var(--font-mono)' } }, [`v${version}`]),
    ]),

  ]);

  const cancelBtn = el('button', { class: 'btn btn-secondary' }, ['Cancel']);
  const saveBtn   = el('button', { class: 'btn btn-primary' },   ['Save Settings']);
  const footer = el('div', { style: { display: 'flex', gap: '8px' } }, [cancelBtn, saveBtn]);

  const { close } = createModal({
    id: 'settings',
    title: 'Settings',
    size: 'modal-md',
    bodyContent: bodyEl,
    footerContent: footer,
  });

  cancelBtn.addEventListener('click', close);

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try {
      await window.electronAPI.updateSettings({
        workingDirectory: pendingWorkingDir,
        confirmBeforeRestore: confirmRestoreCb.checked,
        externalCompareTool: {
          exePath:     pendingCompareToolExe,
          argTemplate: settings.externalCompareTool?.argTemplate || '"{pathA}" "{pathB}"',
        },
      });
      showToast('Settings saved.', 'success');
      emit('state:settings-changed', { workingDirectory: pendingWorkingDir });
      close();
    } catch (err) {
      showToast(err?.message || 'Failed to save settings.', 'error');
      saveBtn.disabled = false;
    }
  });
}
