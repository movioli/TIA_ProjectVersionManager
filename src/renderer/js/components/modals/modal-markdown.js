import { createModal } from './modal-base.js';
import { el } from '../../utils/dom.js';

export function openMarkdownModal(title, markdownContent) {
  const htmlContent = parseMarkdown(markdownContent);
  const container = el('div', { class: 'markdown-body' });
  container.innerHTML = htmlContent;

  // Add click listener for links
  container.addEventListener('click', (e) => {
    const link = e.target.closest('.md-link');
    if (link) {
      e.preventDefault();
      const url = link.getAttribute('data-url');
      if (url) {
        window.electronAPI.openExternal(url);
      }
    }
  });

  const closeBtn = el('button', { class: 'btn btn-primary' }, ['Close']);
  const footer = el('div', { style: { display: 'flex', justifyContent: 'flex-end' } }, [closeBtn]);

  const { close } = createModal({
    id: 'markdown-viewer',
    title: title,
    size: 'modal-lg',
    bodyContent: container,
    footerContent: footer,
  });

  closeBtn.addEventListener('click', close);
}

function parseMarkdown(md) {
  // 1. Escape HTML
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 2. Code blocks (store temporarily)
  const codeBlocks = [];
  html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push(code.trim());
    return placeholder;
  });

  // 3. Inline code (store temporarily)
  const inlineCodes = [];
  html = html.replace(/`([^`]+)`/g, (match, code) => {
    const placeholder = `__INLINE_CODE_${inlineCodes.length}__`;
    inlineCodes.push(code);
    return placeholder;
  });

  // 4. Headers
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // 5. Bold & Italic
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // 6. Horizontal Rules
  html = html.replace(/^---$/gim, '<hr>');

  // 7. Lists
  html = html.replace(/^\* (.*$)/gim, '<li>$1</li>');
  html = html.replace(/^- (.*$)/gim, '<li>$1</li>');
  // Group lists together
  html = html.replace(/(<li>.*?<\/li>(\s*<li>.*?<\/li>)*)/gs, '<ul>$1</ul>');

  // 8. Links
  html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="#" class="md-link" data-url="$2">$1</a>');

  // 9. Restore Inline Code and Code Blocks
  inlineCodes.forEach((code, i) => {
    html = html.replace(`__INLINE_CODE_${i}__`, `<code>${code}</code>`);
  });
  codeBlocks.forEach((code, i) => {
    html = html.replace(`__CODE_BLOCK_${i}__`, `<pre><code>${code}</code></pre>`);
  });

  // 10. Paragraphs & line breaks
  html = html.replace(/\n\n/g, '<p></p>');
  html = html.replace(/\n/g, '<br>');

  return html;
}
