/**
 * Conversion between the two content formats the blog API stores:
 *
 *  - `contentHtml` — sanitized HTML, what a renderer can print directly
 *  - `content`     — rich editor document JSON (ProseMirror/Tiptap shaped)
 *
 * The editor works in HTML because that is what `contenteditable` speaks, and
 * the document JSON is derived from it on save so a post stays readable by
 * either kind of client. Everything is defensive: documents produced by other
 * tools (or an older schema) render instead of throwing.
 */

import { sanitizeBlogHtml, sanitizeUrl } from './blog-html';

export type RichMark = { type: string; attrs?: Record<string, unknown> };
export type RichNode = {
  type: string;
  attrs?: Record<string, unknown>;
  marks?: RichMark[];
  text?: string;
  content?: RichNode[];
};

const INLINE_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'bdi',
  'bdo',
  'cite',
  'code',
  'del',
  'em',
  'font',
  'i',
  'ins',
  'mark',
  'q',
  's',
  'small',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'time',
  'u',
  'wbr',
]);

/** Generic wrappers carry no meaning of their own, so we look through them. */
const CONTAINER_TAGS = new Set([
  'div',
  'section',
  'article',
  'main',
  'aside',
  'header',
  'footer',
  'nav',
  'dl',
  'dd',
  'dt',
  'body',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
}

/* ------------------------------------------------------------------ */
/* HTML → document JSON                                                */
/* ------------------------------------------------------------------ */

function markFor(tag: string, element?: Element): RichMark | null {
  switch (tag) {
    case 'strong':
    case 'b':
      return { type: 'bold' };
    case 'em':
    case 'i':
    case 'cite':
    case 'q':
      return { type: 'italic' };
    case 'u':
    case 'ins':
      return { type: 'underline' };
    case 's':
    case 'del':
    case 'strike':
      return { type: 'strike' };
    case 'code':
    case 'mark':
      return { type: 'code' };
    case 'a': {
      const href = element?.getAttribute('href');
      if (!href) return null;
      const safe = sanitizeUrl(href, true);
      if (!safe) return null;
      const attrs: Record<string, unknown> = { href: safe };
      if (element?.getAttribute('target') === '_blank') attrs.target = '_blank';
      return { type: 'link', attrs };
    }
    default:
      return null;
  }
}

function withMark(marks: RichMark[], mark: RichMark | null): RichMark[] {
  if (!mark) return marks;
  // Nested identical marks (a <b> inside a <strong>) would only add noise.
  if (marks.some(existing => existing.type === mark.type && sameAttrs(existing.attrs, mark.attrs))) return marks;
  return [...marks, mark];
}

function sameAttrs(a?: Record<string, unknown>, b?: Record<string, unknown>): boolean {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}

function imageFromElement(element: Element): RichNode | null {
  const src = element.getAttribute('src');
  if (!src) return null;
  const safe = sanitizeUrl(src, false);
  if (!safe) return null;

  const attrs: Record<string, unknown> = { src: safe };
  const alt = element.getAttribute('alt')?.trim();
  const title = element.getAttribute('title')?.trim();
  if (alt) attrs.alt = alt;
  if (title) attrs.title = title;
  const width = Number(element.getAttribute('width'));
  const height = Number(element.getAttribute('height'));
  if (Number.isFinite(width) && width > 0) attrs.width = Math.round(width);
  if (Number.isFinite(height) && height > 0) attrs.height = Math.round(height);
  return { type: 'image', attrs };
}

function figureFromElement(element: Element): RichNode | null {
  const image = element.querySelector('img');
  if (!image) {
    // A figure with no image is just a block of text.
    const inlines = inlinesFrom(element);
    return inlines.length ? { type: 'paragraph', content: inlines } : null;
  }
  const node = imageFromElement(image);
  if (!node) return null;
  const caption = element.querySelector('figcaption')?.textContent?.replace(/\s+/g, ' ').trim();
  node.attrs = { ...(node.attrs ?? {}), ...(caption ? { caption } : {}) };
  return node;
}

function inlinesFromNodes(nodes: Node[], marks: RichMark[]): RichNode[] {
  const out: RichNode[] = [];

  for (const node of nodes) {
    if (node.nodeType === 3 /* text */) {
      const text = node.textContent ?? '';
      if (!text) continue;
      out.push(marks.length ? { type: 'text', text, marks } : { type: 'text', text });
      continue;
    }
    if (node.nodeType !== 1 /* element */) continue;

    const element = node as Element;
    const tag = element.tagName.toLowerCase();

    if (tag === 'br') {
      out.push({ type: 'hardBreak' });
      continue;
    }
    if (tag === 'img') {
      const image = imageFromElement(element);
      if (image) out.push(image);
      continue;
    }
    if (tag === 'hr') {
      out.push({ type: 'horizontalRule' });
      continue;
    }

    const mark = markFor(tag, element);
    out.push(...inlinesFromNodes(Array.from(element.childNodes), withMark(marks, mark)));
  }

  return out;
}

function inlinesFrom(element: Element): RichNode[] {
  return inlinesFromNodes(Array.from(element.childNodes), []);
}

/** A paragraph holding nothing but an image becomes a standalone image block. */
function paragraphFrom(element: Element): RichNode[] {
  const hasElementChild = Array.from(element.childNodes).some(
    child => child.nodeType === 1 && (child as Element).tagName.toLowerCase() !== 'br',
  );
  if (hasElementChild) {
    const images = element.querySelectorAll('img');
    const text = (element.textContent ?? '').trim();
    if (images.length === 1 && !text) {
      const image = imageFromElement(images[0]);
      if (image) return [image];
    }
  }
  const inlines = inlinesFrom(element);
  if (!inlines.some(node => node.type !== 'text' || (node.text ?? '').trim())) return [];
  return [{ type: 'paragraph', content: inlines }];
}

function listFrom(element: Element, ordered: boolean): RichNode | null {
  const items: RichNode[] = [];
  for (const child of Array.from(element.children)) {
    if (child.tagName.toLowerCase() !== 'li') continue;
    const content = blocksFrom(child);
    items.push({ type: 'listItem', content: content.length ? content : [{ type: 'paragraph' }] });
  }
  if (!items.length) return null;

  const node: RichNode = { type: ordered ? 'orderedList' : 'bulletList', content: items };
  if (ordered) {
    const start = Number(element.getAttribute('start'));
    if (Number.isFinite(start) && start > 1) node.attrs = { start: Math.round(start) };
  }
  return node;
}

function tableFrom(element: Element): RichNode | null {
  const rows: RichNode[] = [];
  for (const row of Array.from(element.querySelectorAll('tr'))) {
    const cells: RichNode[] = [];
    for (const cell of Array.from(row.children)) {
      const tag = cell.tagName.toLowerCase();
      if (tag !== 'td' && tag !== 'th') continue;
      const inlines = inlinesFrom(cell);
      cells.push({
        type: tag === 'th' ? 'tableHeader' : 'tableCell',
        content: [{ type: 'paragraph', ...(inlines.length ? { content: inlines } : {}) }],
      });
    }
    if (cells.length) rows.push({ type: 'tableRow', content: cells });
  }
  if (!rows.length) return null;
  return { type: 'table', content: rows };
}

function blocksFrom(container: Element): RichNode[] {
  const blocks: RichNode[] = [];
  let pending: Node[] = [];

  const flushPending = () => {
    if (!pending.length) return;
    const inlines = inlinesFromNodes(pending, []);
    pending = [];
    if (inlines.some(node => node.type !== 'text' || (node.text ?? '').trim())) {
      blocks.push({ type: 'paragraph', content: inlines });
    }
  };

  for (const child of Array.from(container.childNodes)) {
    if (child.nodeType === 3 /* text */) {
      if ((child.textContent ?? '').trim()) pending.push(child);
      continue;
    }
    if (child.nodeType !== 1 /* element */) continue;

    const element = child as Element;
    const tag = element.tagName.toLowerCase();

    if (INLINE_TAGS.has(tag) || tag === 'br') {
      pending.push(element);
      continue;
    }

    flushPending();

    if (CONTAINER_TAGS.has(tag)) {
      blocks.push(...blocksFrom(element));
      continue;
    }

    if (/^h[1-6]$/.test(tag)) {
      const inlines = inlinesFrom(element);
      if (inlines.length) blocks.push({ type: 'heading', attrs: { level: Number(tag[1]) }, content: inlines });
      continue;
    }

    switch (tag) {
      case 'p':
        blocks.push(...paragraphFrom(element));
        break;
      case 'blockquote': {
        const inner = blocksFrom(element);
        blocks.push({ type: 'blockquote', content: inner.length ? inner : [{ type: 'paragraph' }] });
        break;
      }
      case 'ul':
      case 'ol': {
        const list = listFrom(element, tag === 'ol');
        if (list) blocks.push(list);
        break;
      }
      case 'pre': {
        const text = element.textContent ?? '';
        if (text.trim()) blocks.push({ type: 'codeBlock', content: [{ type: 'text', text }] });
        break;
      }
      case 'hr':
        blocks.push({ type: 'horizontalRule' });
        break;
      case 'figure': {
        const figure = figureFromElement(element);
        if (figure) blocks.push(figure);
        break;
      }
      case 'img': {
        const image = imageFromElement(element);
        if (image) blocks.push(image);
        break;
      }
      case 'table': {
        const table = tableFrom(element);
        if (table) blocks.push(table);
        break;
      }
      case 'caption':
      case 'figcaption':
      case 'small': {
        // Standalone caption-ish text still deserves a paragraph.
        blocks.push(...paragraphFrom(element));
        break;
      }
      default:
        // Unknown block: keep whatever text it holds rather than losing content.
        blocks.push(...paragraphFrom(element));
        break;
    }
  }

  flushPending();
  return blocks;
}

/** Builds the rich document that matches a block of sanitized HTML. */
export function htmlToDocument(html: string | null | undefined): RichNode | null {
  const clean = sanitizeBlogHtml(html);
  if (!clean) return null;
  const content = blocksFrom(parse(clean).body);
  if (!content.length) return null;
  return { type: 'doc', content };
}

/* ------------------------------------------------------------------ */
/* Document JSON → HTML                                                */
/* ------------------------------------------------------------------ */

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function attrsToString(attrs: Record<string, string | number | undefined>): string {
  return Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => ` ${key}="${escapeHtml(String(value))}"`)
    .join('');
}

function stringAttr(attrs: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = attrs?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberAttr(attrs: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = Number(attrs?.[key]);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
}

function wrapWithMarks(html: string, marks: unknown): string {
  if (!html || !Array.isArray(marks)) return html;
  return marks.reduce((acc, mark) => {
    if (!isRecord(mark) || typeof mark.type !== 'string') return acc;
    const attrs = isRecord(mark.attrs) ? mark.attrs : {};
    switch (mark.type.toLowerCase()) {
      case 'bold':
        return `<strong>${acc}</strong>`;
      case 'italic':
        return `<em>${acc}</em>`;
      case 'underline':
        return `<u>${acc}</u>`;
      case 'strike':
        return `<s>${acc}</s>`;
      case 'code':
        return `<code>${acc}</code>`;
      case 'link': {
        const href = typeof attrs.href === 'string' ? sanitizeUrl(attrs.href, true) : null;
        if (!href) return acc;
        const target = attrs.target === '_blank' ? '_blank' : undefined;
        const rel = target ? 'noopener noreferrer nofollow' : undefined;
        return `<a${attrsToString({ href, target, rel })}>${acc}</a>`;
      }
      default:
        return acc;
    }
  }, html);
}

function renderInline(node: unknown): string {
  if (!isRecord(node)) return '';
  const type = String(node.type ?? '').toLowerCase();

  if (type === 'text') {
    const text = typeof node.text === 'string' ? node.text : '';
    return text ? wrapWithMarks(escapeHtml(text), node.marks) : '';
  }
  if (type === 'hardbreak' || type === 'br') return '<br>';
  if (type === 'image') {
    const src = typeof node.attrs === 'object' && node.attrs ? sanitizeUrl(String((node.attrs as any).src ?? ''), false) : null;
    if (!src) return '';
    const attrs = isRecord(node.attrs) ? node.attrs : {};
    return `<img${attrsToString({
      src,
      alt: stringAttr(attrs, 'alt'),
      title: stringAttr(attrs, 'title'),
      width: numberAttr(attrs, 'width'),
      height: numberAttr(attrs, 'height'),
    })}>`;
  }
  // Unknown inline: prefer its text, then its children.
  if (typeof node.text === 'string' && node.text) return wrapWithMarks(escapeHtml(node.text), node.marks);
  return renderInlines(node.content);
}

function renderInlines(nodes: unknown): string {
  if (!Array.isArray(nodes)) return '';
  return nodes.map(renderInline).join('');
}

function renderBlocks(nodes: unknown): string {
  if (!Array.isArray(nodes)) return '';
  return nodes.map(renderBlock).join('');
}

function renderBlock(node: unknown): string {
  if (!isRecord(node)) return '';
  const type = String(node.type ?? '').toLowerCase();
  const attrs = isRecord(node.attrs) ? node.attrs : {};

  switch (type) {
    case 'doc':
    case 'fragment':
      return renderBlocks(node.content);
    case 'paragraph': {
      const inner = renderInlines(node.content);
      return `<p>${inner || '<br>'}</p>`;
    }
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(attrs.level) || 2));
      const inner = renderInlines(node.content);
      return `<h${level}>${inner || '<br>'}</h${level}>`;
    }
    case 'blockquote':
      return `<blockquote>${renderBlocks(node.content) || '<p><br></p>'}</blockquote>`;
    case 'bulletlist':
      return `<ul>${renderBlocks(node.content)}</ul>`;
    case 'orderedlist': {
      const start = numberAttr(attrs, 'start');
      return `<ol${attrsToString({ start })}>${renderBlocks(node.content)}</ol>`;
    }
    case 'listitem':
    case 'list_item':
      return `<li>${renderBlocks(node.content) || '<p><br></p>'}</li>`;
    case 'codeblock':
    case 'code_block':
      return `<pre><code>${escapeHtml(documentTextOf(node))}</code></pre>`;
    case 'horizontalrule':
    case 'horizontal_rule':
    case 'divider':
      return '<hr>';
    case 'image':
    case 'figure': {
      const image = renderInline({ ...node, type: 'image' });
      if (!image) return renderBlocks(node.content);
      const caption = stringAttr(attrs, 'caption');
      return `<figure class="cms-figure">${image}${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}</figure>`;
    }
    case 'table':
      return `<table>${renderBlocks(node.content)}</table>`;
    case 'tablerow':
    case 'table_row':
      return `<tr>${renderBlocks(node.content)}</tr>`;
    case 'tablecell':
    case 'table_cell':
      return `<td>${renderBlocks(node.content)}</td>`;
    case 'tableheader':
    case 'table_header':
      return `<th>${renderBlocks(node.content)}</th>`;
    case 'html': {
      // The API stores sanitized HTML blocks; sanitize again before injecting.
      return typeof node.html === 'string' ? sanitizeBlogHtml(node.html) : '';
    }
    default:
      return renderBlocks(node.content) || renderInlines(node.content);
  }
}

/** Renders any rich document as sanitized HTML (empty string when unusable). */
export function documentToHtml(value: unknown): string {
  if (!isRecord(value) && !Array.isArray(value)) return '';
  const html = isRecord(value) ? renderBlock(value) : renderBlocks(value);
  return sanitizeBlogHtml(html);
}

/* ------------------------------------------------------------------ */
/* Document JSON → text                                                */
/* ------------------------------------------------------------------ */

function documentTextOf(node: unknown): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(documentTextOf).join('');
  if (!isRecord(node)) return '';
  const type = String(node.type ?? '').toLowerCase();
  const own = typeof node.text === 'string' ? node.text : '';
  const children = documentTextOf(node.content);
  const blockish = [
    'paragraph',
    'heading',
    'blockquote',
    'listitem',
    'list_item',
    'codeblock',
    'code_block',
    'tablecell',
    'table_cell',
    'tableheader',
    'table_header',
    'tablerow',
    'table_row',
  ].includes(type);
  const text = `${own}${children}`;
  return blockish && text ? `${text}\n` : text;
}

export function documentToText(value: unknown): string {
  return documentTextOf(value)
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Mirrors the backend's "is there anything worth publishing?" check. */
export function hasDocumentContent(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasDocumentContent);
  if (!isRecord(value)) return false;

  if (typeof value.text === 'string' && value.text.trim()) return true;
  if (typeof value.html === 'string' && value.html.trim()) return true;

  const type = String(value.type ?? '').toLowerCase();
  if (['image', 'video', 'embed', 'file', 'figure', 'horizontalrule'].includes(type)) {
    const attrs = isRecord(value.attrs) ? value.attrs : {};
    if (['src', 'url', 'href', 'source'].some(key => typeof attrs[key] === 'string' && (attrs[key] as string).trim())) {
      return true;
    }
    if (type === 'horizontalrule') return true;
  }

  return hasDocumentContent(value.content) || hasDocumentContent(value.children);
}

export function isRichDocument(value: unknown): value is RichNode {
  return isRecord(value) && (typeof value.type === 'string' || Array.isArray(value.content));
}
