import { el, empty, showToast } from '../utils/dom.js';
import { on } from '../event-bus.js';
import { getProjects, getLabels, getActiveView, setProjects } from '../state.js';
import { api } from '../api.js';
import { formatDate, formatRelativeDate, formatBytes } from '../utils/format.js';
import { createModal } from './modals/modal-base.js';

const UNIT_MS = {
  days: 86400000,
  weeks: 7 * 86400000,
  months: 30 * 86400000,
  years: 365 * 86400000,
};

const filters = {
  olderAmount: 90,
  olderUnit: 'days',
  projectId: '',
  keepNewest: 1,
  keepNewestEnabled: true,
};

const selectedKeys = new Set();
let busy = false;

export function mountCleanupView(containerEl) {
  render(containerEl);
  on('state:view-changed', () => {
    if (getActiveView() === 'cleanup') render(containerEl);
  });
  on('state:projects-changed', () => {
    if (getActiveView() === 'cleanup') render(containerEl);
  });
  on('state:versions-changed', () => {
    if (getActiveView() === 'cleanup') render(containerEl);
  });
  on('state:labels-changed', () => {
    if (getActiveView() === 'cleanup') render(containerEl);
  });
}

function rowKey(projectId, versionId) {
  return `${projectId}::${versionId}`;
}

function collectRows() {
  const rows = [];
  for (const project of getProjects()) {
    for (const version of project.versions || []) {
      rows.push({ project, version });
    }
  }
  return rows;
}

function applyFilters(rows) {
  let result = rows;
  if (filters.projectId) {
    result = result.filter(r => r.project.id === filters.projectId);
  }

  if (filters.keepNewestEnabled && filters.keepNewest > 0) {
    const byProject = new Map();
    for (const r of result) {
      const list = byProject.get(r.project.id) || [];
      list.push(r);
      byProject.set(r.project.id, list);
    }
    const protectedKeys = new Set();
    for (const list of byProject.values()) {
      list.sort((a, b) => new Date(b.version.createdAt) - new Date(a.version.createdAt));
      for (const r of list.slice(0, filters.keepNewest)) {
        protectedKeys.add(rowKey(r.project.id, r.version.id));
      }
    }
    result = result.filter(r => !protectedKeys.has(rowKey(r.project.id, r.version.id)));
  }

  const amount = Number(filters.olderAmount);
  if (amount > 0) {
    const cutoff = Date.now() - amount * (UNIT_MS[filters.olderUnit] || UNIT_MS.days);
    result = result.filter(r => new Date(r.version.createdAt).getTime() < cutoff);
  }

  result.sort((a, b) => new Date(a.version.createdAt) - new Date(b.version.createdAt));
  return result;
}

function pruneSelection(visibleRows) {
  const visible = new Set(visibleRows.map(r => rowKey(r.project.id, r.version.id)));
  for (const key of [...selectedKeys]) {
    if (!visible.has(key)) selectedKeys.delete(key);
  }
}

function selectedRowsOf(visibleRows) {
  return visibleRows.filter(r => selectedKeys.has(rowKey(r.project.id, r.version.id)));
}

function totalSize(rows) {
  return rows.reduce((sum, r) => sum + (r.version.sizeBytes || 0), 0);
}

function emptyProjectNames(toDelete) {
  const remaining = new Map();
  for (const p of getProjects()) {
    remaining.set(p.id, { name: p.name, count: (p.versions || []).length });
  }
  for (const r of toDelete) {
    const entry = remaining.get(r.project.id);
    if (entry) entry.count -= 1;
  }
  return [...remaining.values()].filter(e => e.count <= 0).map(e => e.name);
}

function render(container) {
  empty(container);

  const visibleRows = applyFilters(collectRows());
  pruneSelection(visibleRows);

  const labels = getLabels();
  const labelMap = new Map(labels.map(l => [l.id, l]));
  const selected = selectedRowsOf(visibleRows);
  const projects = getProjects();

  container.appendChild(buildFilterBar(projects, visibleRows, selected));
  container.appendChild(buildActionBar(visibleRows, selected));
  container.appendChild(buildList(visibleRows, labelMap));

  bindFilters(container);
  bindActions(container, visibleRows);
}

function buildFilterBar(projects, visibleRows, selected) {
  const olderInput = el('input', {
    class: 'input cleanup-num',
    type: 'number',
    min: '0',
    value: String(filters.olderAmount),
    title: '0 = no age filter',
    id: 'cleanup-older-amount',
  });
  const unitSelect = el('select', { class: 'input cleanup-select', id: 'cleanup-older-unit' }, [
    el('option', { value: 'days' }, ['Days']),
    el('option', { value: 'weeks' }, ['Weeks']),
    el('option', { value: 'months' }, ['Months']),
    el('option', { value: 'years' }, ['Years']),
  ]);
  unitSelect.value = filters.olderUnit;

  const projectSelect = el('select', { class: 'input cleanup-select', id: 'cleanup-project' }, [
    el('option', { value: '' }, ['All projects']),
    ...projects.map(p => el('option', { value: p.id }, [
      `${p.name} (${p.versions?.length || 0})`,
    ])),
  ]);
  projectSelect.value = filters.projectId;

  const keepCheck = el('input', { type: 'checkbox', id: 'cleanup-keep-enabled' });
  keepCheck.checked = filters.keepNewestEnabled;
  const keepInput = el('input', {
    class: 'input cleanup-num',
    type: 'number',
    min: '0',
    value: String(filters.keepNewest),
    disabled: !filters.keepNewestEnabled,
    id: 'cleanup-keep-count',
  });

  const summaryKids = [`${visibleRows.length} shown · ${formatBytes(totalSize(visibleRows))}`];
  if (selected.length) {
    summaryKids.push(` · ${selected.length} selected · ${formatBytes(totalSize(selected))}`);
  }

  return el('div', { class: 'cleanup-filters' }, [
    el('div', { class: 'cleanup-filter-group' }, [
      el('label', { class: 'form-label' }, ['Older than']),
      el('div', { class: 'cleanup-filter-row' }, [olderInput, unitSelect]),
    ]),
    el('div', { class: 'cleanup-filter-group' }, [
      el('label', { class: 'form-label' }, ['Project']),
      projectSelect,
    ]),
    el('label', { class: 'cleanup-keep-toggle' }, [
      keepCheck,
      el('span', {}, ['Keep newest']),
      keepInput,
      el('span', {}, ['per project']),
    ]),
    el('div', { class: 'cleanup-summary' }, summaryKids),
  ]);
}

function buildActionBar(visibleRows, selected) {
  const canKeep = selected.length > 0 && selected.length < visibleRows.length && !busy;
  return el('div', { class: 'cleanup-actions' }, [
    el('div', { class: 'cleanup-actions-left' }, [
      el('button', {
        class: 'btn btn-ghost btn-sm',
        type: 'button',
        id: 'cleanup-select-all',
        disabled: visibleRows.length === 0,
      }, ['Select all']),
      el('button', {
        class: 'btn btn-ghost btn-sm',
        type: 'button',
        id: 'cleanup-select-none',
        disabled: selected.length === 0,
      }, ['Select none']),
      el('button', {
        class: 'btn btn-ghost btn-sm',
        type: 'button',
        id: 'cleanup-invert',
        disabled: visibleRows.length === 0,
      }, ['Invert']),
    ]),
    el('div', { class: 'cleanup-actions-right' }, [
      el('button', {
        class: 'btn btn-secondary btn-sm',
        type: 'button',
        id: 'cleanup-keep',
        disabled: !canKeep,
        title: 'Delete every shown snapshot that is not selected',
      }, ['Keep selected']),
      el('button', {
        class: 'btn btn-danger btn-sm',
        type: 'button',
        id: 'cleanup-delete',
        disabled: selected.length === 0 || busy,
      }, ['Delete selected']),
    ]),
  ]);
}

function buildList(visibleRows, labelMap) {
  if (visibleRows.length === 0) {
    return el('div', { class: 'empty-state' }, [
      el('div', { class: 'icon' }, ['🧹']),
      el('div', { class: 'title' }, ['No snapshots match']),
      el('div', { class: 'subtitle' }, ['Relax the age filter or disable “Keep newest” to see more.']),
    ]);
  }

  const list = el('div', { class: 'cleanup-list' });
  for (const row of visibleRows) {
    list.appendChild(buildRow(row, labelMap));
  }
  return list;
}

function buildRow(row, labelMap) {
  const { project, version } = row;
  const key = rowKey(project.id, version.id);
  const checked = selectedKeys.has(key);

  const checkbox = el('input', {
    type: 'checkbox',
    class: 'card-checkbox',
    'data-key': key,
  });
  checkbox.checked = checked;

  const tags = el('div', { class: 'card-tags' });
  if (version.labelIds?.length) {
    for (const lid of version.labelIds) {
      const lbl = labelMap.get(lid);
      if (lbl) {
        tags.appendChild(el('span', {
          class: 'label-badge',
          style: { background: lbl.color + '33', color: lbl.color },
        }, [lbl.name]));
      }
    }
  }

  return el('label', { class: `cleanup-row${checked ? ' selected' : ''}` }, [
    checkbox,
    el('div', { class: 'cleanup-row-main' }, [
      el('div', { class: 'cleanup-row-top' }, [
        el('span', { class: 'cleanup-row-project' }, [project.name]),
        el('span', { class: 'cleanup-row-label' }, [version.label || 'Snapshot']),
      ]),
      tags.childNodes.length ? tags : null,
      el('div', { class: 'card-meta' }, [
        el('span', { title: formatDate(version.createdAt) }, [formatRelativeDate(version.createdAt)]),
        el('span', {}, [formatBytes(version.sizeBytes ?? 0)]),
        el('span', {}, [`${version.fileCount ?? '?'} files`]),
      ]),
    ]),
  ]);
}

function bindFilters(container) {
  const olderInput = container.querySelector('#cleanup-older-amount');
  const unitSelect = container.querySelector('#cleanup-older-unit');
  const projectSelect = container.querySelector('#cleanup-project');
  const keepCheck = container.querySelector('#cleanup-keep-enabled');
  const keepInput = container.querySelector('#cleanup-keep-count');

  olderInput?.addEventListener('change', () => {
    filters.olderAmount = Math.max(0, Number(olderInput.value) || 0);
    render(container);
  });
  unitSelect?.addEventListener('change', () => {
    filters.olderUnit = unitSelect.value;
    render(container);
  });
  projectSelect?.addEventListener('change', () => {
    filters.projectId = projectSelect.value;
    render(container);
  });
  keepCheck?.addEventListener('change', () => {
    filters.keepNewestEnabled = keepCheck.checked;
    render(container);
  });
  keepInput?.addEventListener('change', () => {
    filters.keepNewest = Math.max(0, Number(keepInput.value) || 0);
    render(container);
  });
}

function bindActions(container, visibleRows) {
  container.querySelector('#cleanup-select-all')?.addEventListener('click', () => {
    for (const r of visibleRows) selectedKeys.add(rowKey(r.project.id, r.version.id));
    render(container);
  });
  container.querySelector('#cleanup-select-none')?.addEventListener('click', () => {
    selectedKeys.clear();
    render(container);
  });
  container.querySelector('#cleanup-invert')?.addEventListener('click', () => {
    for (const r of visibleRows) {
      const key = rowKey(r.project.id, r.version.id);
      if (selectedKeys.has(key)) selectedKeys.delete(key);
      else selectedKeys.add(key);
    }
    render(container);
  });
  container.querySelector('#cleanup-delete')?.addEventListener('click', () => {
    confirmDelete(container, selectedRowsOf(visibleRows), 'Delete selected snapshots?');
  });
  container.querySelector('#cleanup-keep')?.addEventListener('click', () => {
    const toDelete = visibleRows.filter(r => !selectedKeys.has(rowKey(r.project.id, r.version.id)));
    confirmDelete(container, toDelete, 'Keep selected snapshots and delete the rest of the filtered list?');
  });

  container.querySelectorAll('.cleanup-row input[type="checkbox"]').forEach((box) => {
    box.addEventListener('change', () => {
      const key = box.getAttribute('data-key');
      if (!key) return;
      if (box.checked) selectedKeys.add(key);
      else selectedKeys.delete(key);
      render(container);
    });
  });
}

function confirmDelete(container, rows, title) {
  if (!rows.length || busy) return;

  const emptyNames = emptyProjectNames(rows);
  const body = el('div', { class: 'cleanup-confirm-body' }, [
    el('p', {}, [
      `This will permanently delete ${rows.length} snapshot${rows.length === 1 ? '' : 's'} (${formatBytes(totalSize(rows))}).`,
    ]),
    emptyNames.length
      ? el('p', { class: 'cleanup-confirm-warn' }, [
          `These projects will have no snapshots left: ${emptyNames.join(', ')}.`,
        ])
      : null,
    el('p', { class: 'form-hint' }, ['This cannot be undone.']),
  ]);

  const cancelBtn = el('button', { class: 'btn btn-secondary' }, ['Cancel']);
  const confirmBtn = el('button', { class: 'btn btn-danger' }, [`Delete ${rows.length}`]);
  const footer = el('div', { style: { display: 'flex', gap: '8px' } }, [cancelBtn, confirmBtn]);

  const { close } = createModal({
    id: 'cleanup-confirm',
    title,
    size: 'modal-sm',
    bodyContent: body,
    footerContent: footer,
  });

  cancelBtn.addEventListener('click', close);
  confirmBtn.addEventListener('click', async () => {
    close();
    await runDelete(container, rows);
  });
}

async function runDelete(container, rows) {
  busy = true;
  render(container);
  try {
    const items = rows.map(r => ({ projectId: r.project.id, versionId: r.version.id }));
    const result = await api.deleteVersions(items);
    for (const item of result.deleted || []) {
      selectedKeys.delete(rowKey(item.projectId, item.versionId));
    }
    const projects = await api.getProjects();
    setProjects(projects);
    const failed = result.errors?.length || 0;
    if (failed) {
      showToast(`Deleted ${result.deleted.length}, ${failed} failed.`, 'error');
    } else {
      showToast(`Deleted ${result.deleted.length} snapshot${result.deleted.length === 1 ? '' : 's'}.`, 'success');
    }
  } catch (_) {
    // api already toasts
  } finally {
    busy = false;
    if (getActiveView() === 'cleanup') render(container);
  }
}
