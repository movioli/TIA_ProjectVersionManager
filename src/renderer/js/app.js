import { setProjects, setLabels } from './state.js';
import { api } from './api.js';
import { mountSidebar } from './components/sidebar.js';
import { mountVersionList } from './components/version-list.js';
import { mountToolbar } from './components/toolbar.js';
import { $, el } from './utils/dom.js';
import { on } from './event-bus.js';
import { initTheme } from './utils/theme.js';

async function init() {
  // Initialize theme
  initTheme();
  // Load data
  const [projects, labels, settings] = await Promise.all([
    window.electronAPI.getProjects(),
    window.electronAPI.getLabels(),
    window.electronAPI.getSettings(),
  ]);
  setLabels(labels);
  setProjects(projects);

  // Auto-select first project on startup
  if (projects.length > 0) {
    const { setSelectedProject } = await import('./state.js');
    setSelectedProject(projects[0].id);
  }

  // Show/hide the working-directory banner
  renderSetupBanner(settings.workingDirectory);
  on('state:settings-changed', ({ workingDirectory }) => renderSetupBanner(workingDirectory));

  // Mount UI components
  mountSidebar($('#sidebar'));
  mountToolbar($('#main-toolbar'));
  mountVersionList($('#version-list-container'), $('#main-toolbar'));

  // Global progress bar (thin line under toolbar)
  const progressWrap = $('#progress-bar-wrap');
  const progressFill = $('#progress-bar-fill');

  let hideTimer = null;
  window.electronAPI.onProgress(({ percent }) => {
    if (progressWrap) {
      progressWrap.classList.remove('hidden');
      progressFill.style.width = percent + '%';
      clearTimeout(hideTimer);
      if (percent >= 100) {
        hideTimer = setTimeout(() => {
          progressWrap.classList.add('hidden');
          progressFill.style.width = '0%';
        }, 600);
      }
    }
  });

  // Window control buttons
  $('#btn-minimize')?.addEventListener('click', () => window.electronAPI.minimize());
  $('#btn-maximize')?.addEventListener('click', () => window.electronAPI.maximize());
  $('#btn-close')?.addEventListener('click', () => window.electronAPI.closeWindow());
}

function renderSetupBanner(workingDirectory) {
  const existing = $('#setup-banner');
  if (existing) existing.remove();

  if (workingDirectory) return;

  const banner = el('div', { id: 'setup-banner' }, [
    el('span', {}, ['⚙  No working directory set. Snapshots cannot be created until you configure one.']),
    el('button', { class: 'btn btn-primary btn-sm', id: 'btn-setup-settings' }, ['Open Settings']),
  ]);

  const mainPanel = $('#main-panel');
  if (mainPanel) mainPanel.prepend(banner);

  document.getElementById('btn-setup-settings')?.addEventListener('click', async () => {
    const { openSettingsModal } = await import('./components/modals/modal-settings.js');
    openSettingsModal();
  });
}

init().catch(console.error);
