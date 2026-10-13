/** DOM insertion helpers shared by images, pasted content and HTML snippets. */
import { sanitizeBlogHtml } from './blog-html';

const TEXT_BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
const FLOW_BLOCKS = new Set(['DIV', 'LI', 'BLOCKQUOTE', 'TD', 'TH', 'DD', 'DT']);
const ATOMIC_BLOCKS = new Set(['PRE', 'FIGURE', 'TABLE', 'UL', 'OL', 'THEAD', 'TBODY', 'TR', 'DL']);
const INLINE_TAGS = new Set(['A', 'BR', 'CODE', 'DEL', 'EM', 'S', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'U']);

export function rangeIsInEditor(editor: HTMLElement, range: Range | null): range is Range {
  return Boolean(range && editor.contains(range.startContainer) && editor.contains(range.endContainer));
}

export function editorSelection(editor: HTMLElement): Range | null {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  return rangeIsInEditor(editor, range) ? range.cloneRange() : null;
}

export function editorEnd(editor: HTMLElement): Range {
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  return range;
}

function emptyParagraph(): HTMLParagraphElement {
  const paragraph = document.createElement('p');
  paragraph.appendChild(document.createElement('br'));
  return paragraph;
}

function hasContent(node: Node): boolean {
  return Boolean((node.textContent ?? '').replace(/[\s\u200b]/g, '') ||
    (node instanceof Element || node instanceof DocumentFragment) && node.querySelector('img, hr, table, pre, [data-cms-bookmark]'));
}

function closestBlock(editor: HTMLElement, node: Node): Element | null {
  let element = node instanceof Element ? node : node.parentElement;
  while (element && element !== editor) {
    if (TEXT_BLOCKS.has(element.tagName) || FLOW_BLOCKS.has(element.tagName) || ATOMIC_BLOCKS.has(element.tagName)) return element;
    element = element.parentElement;
  }
  return null;
}

/** Wrap bare inline runs, but never put a table/list/figure inside a paragraph. */
function blockNodes(nodes: Node[]): Node[] {
  const blocks: Node[] = [];
  let paragraph: HTMLParagraphElement | null = null;
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE || node instanceof Element && INLINE_TAGS.has(node.tagName)) {
      if (!paragraph) paragraph = document.createElement('p');
      paragraph.appendChild(node);
    } else {
      if (paragraph && hasContent(paragraph)) blocks.push(paragraph);
      paragraph = null;
      blocks.push(node);
    }
  }
  if (paragraph && hasContent(paragraph)) blocks.push(paragraph);
  return blocks;
}

function insertionReference(host: Element, nodes: Node[]): ChildNode | null {
  let reference = host.nextSibling;
  // An internally dragged figure may already be the next sibling. Inserting
  // a node before itself is a no-op and would leave the split text before it.
  while (reference && nodes.includes(reference)) reference = reference.nextSibling;
  return reference;
}

function caretAtStart(element: Element): Range {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(true);
  return range;
}

/**
 * Split at the insertion point, not at the end of the article. The returned
 * caret lives immediately after the inserted blocks, so the next tutorial
 * instruction is typed beside its screenshot, even in a list item or table.
 * This function does not focus the surface or change the browser selection.
 */
export function insertEditorBlocks(editor: HTMLElement, range: Range, nodes: Node[]): Range | null {
  if (!rangeIsInEditor(editor, range) || !nodes.length) return null;
  range.deleteContents();
  const host = closestBlock(editor, range.startContainer);

  if (host && TEXT_BLOCKS.has(host.tagName)) {
    const tail = document.createRange();
    tail.selectNodeContents(host);
    tail.setStart(range.startContainer, range.startOffset);
    const fragment = tail.extractContents();
    const parent = host.parentNode!;
    const reference = insertionReference(host, nodes);
    nodes.forEach(node => parent.insertBefore(node, reference));

    const continuation = hasContent(fragment) ? host.cloneNode(false) as Element : emptyParagraph();
    if (hasContent(fragment)) continuation.appendChild(fragment);
    parent.insertBefore(continuation, reference);
    if (!hasContent(host)) host.remove();
    return caretAtStart(continuation);
  }

  if (host && ATOMIC_BLOCKS.has(host.tagName)) {
    const parent = host.parentNode!;
    const reference = insertionReference(host, nodes);
    nodes.forEach(node => parent.insertBefore(node, reference));
    const continuation = emptyParagraph();
    parent.insertBefore(continuation, reference);
    return caretAtStart(continuation);
  }

  // A bare-text <li> (and the browser's <div> paragraphs) can hold blocks.
  // Keep the screenshot in that step rather than moving it after the list.
  const container = host ?? editor;
  const tail = document.createRange();
  tail.selectNodeContents(container);
  tail.setStart(range.startContainer, range.startOffset);
  const fragment = tail.extractContents();
  nodes.forEach(node => container.appendChild(node));
  const remaining = blockNodes(Array.from(fragment.childNodes));
  const first = remaining[0];
  const continuation = first instanceof Element && TEXT_BLOCKS.has(first.tagName) ? first : emptyParagraph();
  if (continuation !== first) container.appendChild(continuation);
  remaining.forEach(node => container.appendChild(node));
  return caretAtStart(continuation);
}

/** Inserts safe inline markup inline, or splits the paragraph for block markup. */
export function insertEditorHtml(editor: HTMLElement, range: Range, html: string): Range | null {
  const clean = sanitizeBlogHtml(html);
  if (!clean || !rangeIsInEditor(editor, range)) return null;
  const template = document.createElement('template');
  template.innerHTML = clean;
  const nodes = Array.from(template.content.childNodes);
  const hasBlocks = nodes.some(node => node instanceof Element && !INLINE_TAGS.has(node.tagName));
  if (hasBlocks) return insertEditorBlocks(editor, range, blockNodes(nodes));

  range.deleteContents();
  const last = nodes.at(-1);
  range.insertNode(template.content);
  if (!last) return null;
  const caret = document.createRange();
  caret.setStartAfter(last);
  caret.collapse(true);
  return caret;
}

/** True if two carets/selections still describe the same insertion point. */
export function sameRange(a: Range | null, b: Range | null): boolean {
  return Boolean(a && b && a.startContainer === b.startContainer && a.startOffset === b.startOffset &&
    a.endContainer === b.endContainer && a.endOffset === b.endOffset);
}

/**
 * Live Ranges collapse when their text is extracted during a paragraph split.
 * Invisible, temporary bookmarks travel with that text, letting an upload
 * finish without moving a cursor that the writer has since placed elsewhere.
 */
export function bookmarkEditorRange(editor: HTMLElement, range: Range): () => Range | null {
  const start = document.createElement('span');
  const end = document.createElement('span');
  start.setAttribute('data-cms-bookmark', '');
  end.setAttribute('data-cms-bookmark', '');
  const endRange = range.cloneRange();
  endRange.collapse(false);
  endRange.insertNode(end);
  const startRange = range.cloneRange();
  startRange.collapse(true);
  startRange.insertNode(start);

  return () => {
    let restored: Range | null = null;
    if (editor.contains(start) && editor.contains(end)) {
      restored = document.createRange();
      restored.setStartAfter(start);
      restored.setEndBefore(end);
    }
    start.remove();
    end.remove();
    return restored;
  };
}
