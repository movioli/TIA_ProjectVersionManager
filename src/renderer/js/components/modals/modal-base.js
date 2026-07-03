import { el } from '../../utils/dom.js';

export function createModal({ id, title, size = 'modal-md', bodyContent, footerContent, onClose }) {
  const overlay = el('div', { class: 'modal-overlay', id: id + '-overlay' });
  const modal = el('div', { class: `modal ${size}` });

  const header = el('div', { class: 'modal-header' }, [
    el('div', { class: 'modal-title' }, [title]),
    el('button', { class: 'modal-close', 'aria-label': 'Close' }, ['×']),
  ]);

  const body = el('div', { class: 'modal-body' });
  if (bodyContent) {
    if (typeof bodyContent === 'string') body.innerHTML = bodyContent;
    else body.appendChild(bodyContent);
  }

  modal.appendChild(header);
  modal.appendChild(body);

  if (footerContent) {
    const footer = el('div', { class: 'modal-footer' });
    footer.appendChild(footerContent);
    modal.appendChild(footer);
  }

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const closeBtn = header.querySelector('.modal-close');

  function close() {
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 150ms';
    setTimeout(() => {
      overlay.remove();
      onClose?.();
    }, 150);
  }

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });

  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', escHandler);
    }
  });

  return { overlay, modal, body, close };
}
