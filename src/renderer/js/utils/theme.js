import { emit } from '../event-bus.js';

const STORAGE_KEY = 'tia-theme';

export function getTheme() {
  return localStorage.getItem(STORAGE_KEY) || 'dark';
}

export function setTheme(theme) {
  const targetTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', targetTheme);
  localStorage.setItem(STORAGE_KEY, targetTheme);
  emit('state:theme-changed', { theme: targetTheme });
  return targetTheme;
}

export function toggleTheme() {
  const current = getTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  return setTheme(next);
}

export function initTheme() {
  const current = getTheme();
  document.documentElement.setAttribute('data-theme', current);
  return current;
}
