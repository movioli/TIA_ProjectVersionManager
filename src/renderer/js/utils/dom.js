export const $ = (sel, ctx = document) => ctx.querySelector(sel);
export const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (typeof v === 'boolean') {
      // Boolean attributes: set the property directly, don't use setAttribute
      // setAttribute('disabled', false) still disables the element in HTML
      node[k] = v;
    } else {
      node.setAttribute(k, v);
    }
  }
  for (const child of children) {
    if (typeof child === 'string') node.appendChild(document.createTextNode(child));
    else if (child) node.appendChild(child);
  }
  return node;
}

export function empty(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function showToast(message, type = 'info', duration = 4000) {
  let container = $('#toast-container');
  if (!container) {
    container = el('div', { id: 'toast-container' });
    document.body.appendChild(container);
  }
  const toast = el('div', { class: `toast ${type}` }, [message]);
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 300ms';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

export function showContextMenu(items, x, y) {
  // Remove existing
  $$('.context-menu').forEach(m => m.remove());

  const menu = el('div', { class: 'context-menu' });
  for (const item of items) {
    if (item === 'sep') {
      menu.appendChild(el('div', { class: 'context-menu-sep' }));
    } else {
      const menuItem = el('div', { class: `context-menu-item${item.danger ? ' danger' : ''}` }, [
        item.label,
      ]);
      menuItem.addEventListener('click', () => {
        menu.remove();
        item.action();
      });
      menu.appendChild(menuItem);
    }
  }

  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';
  document.body.appendChild(menu);

  // Adjust if off-screen
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth)  menu.style.left = (x - rect.width) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = (y - rect.height) + 'px';

  const close = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('mousedown', close);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', close), 0);
  return menu;
}
