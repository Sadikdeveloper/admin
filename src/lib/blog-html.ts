/**
 * Client-side HTML hygiene for the blog editor.
 *
 * The API sanitizes everything it stores, but the admin console also renders
 * post HTML back into the DOM (editor, reader preview). Cleaning it here first
 * means a payload that slipped in through another client can never execute in
 * an operator's browser, and what the editor shows matches what the server
 * keeps. The allow-list deliberately mirrors `src/modules/blog/blog-content.ts`
 * in the backend.
 */

/** Tags whose entire subtree is unsafe and must disappear. */
const DROP_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'title',
  'noscript',
  'template',
  'svg',
  'math',
  'form',
  'input',
  'button',
  'select',
  'option',
  'textarea',
  'audio',
  'video',
  'source',
  'track',
  'canvas',
  'applet',
  'frame',
  'frameset',
  'portal',
]);

/** Everything else that may be stored and rendered. */
export const ALLOWED_TAGS = new Set([
  'a',
  'blockquote',
  'br',
  'caption',
  'code',
  'dd',
  'del',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'name', 'target', 'rel']),
  img: new Set(['src', 'alt', 'title', 'width', 'height']),
};

/** `class` is allowed everywhere by the server, so styling hooks survive. */
const GLOBAL_ATTRS = new Set(['class']);

const BLOCK_TAGS = new Set([
  'p',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'ul',
  'ol',
  'blockquote',
  'pre',
  'figure',
  'figcaption',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'hr',
  'dl',
  'dt',
  'dd',
]);

function parse(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
}

/**
 * Keeps `null` for "this URL must go", so callers can decide whether to drop
 * the attribute, the element, or unwrap it.
 */
export function sanitizeUrl(raw: string, isHref: boolean): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;

  // Whitespace and control characters are used to smuggle `java\nscript:` past
  // naive checks, so strip them before inspecting the scheme.
  const stripped = value.replace(/[\u0000-\u0020\u007f]/g, '');
  if (!stripped) return null;
  if (/^(javascript|vbscript|data|blob|file):/i.test(stripped)) return null;
  if (stripped.startsWith('//')) return null; // protocol-relative
  if (stripped.startsWith('/')) return stripped; // root-relative
  if (isHref && (stripped.startsWith('#') || stripped.startsWith('?'))) return stripped;
  if (/^(mailto|tel|sms|callto):/i.test(stripped)) return isHref ? stripped : null;

  // No scheme at all means a plain relative path, which the server also keeps.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(stripped)) return stripped;

  try {
    const url = new URL(stripped);
    const protocol = url.protocol.toLowerCase();
    const allowed = isHref ? ['http:', 'https:', 'mailto:', 'tel:'] : ['http:', 'https:'];
    if (!allowed.includes(protocol)) return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function cleanAttributes(element: Element, tag: string): 'keep' | 'removed' | 'unwrapped' {
  const allowed = ALLOWED_ATTRS[tag];

  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    const isAllowed = GLOBAL_ATTRS.has(name) || (allowed?.has(name) ?? false);
    if (!isAllowed || name.startsWith('on')) {
      element.removeAttribute(attribute.name);
      continue;
    }
    if (name !== 'href' && name !== 'src') continue;

    const cleaned = sanitizeUrl(attribute.value, name === 'href');
    if (cleaned !== null) {
      if (cleaned !== attribute.value) element.setAttribute(attribute.name, cleaned);
      continue;
    }

    // An anchor without a safe destination is just text; an image without one
    // is a broken box, so drop it entirely.
    if (tag === 'a' && name === 'href') {
      unwrapElement(element);
      return 'unwrapped';
    }
    if (tag === 'img') {
      element.remove();
      return 'removed';
    }
    element.removeAttribute(attribute.name);
  }

  if (tag === 'a' && element.getAttribute('target') === '_blank') {
    element.setAttribute('rel', 'noopener noreferrer nofollow');
  }
  return 'keep';
}

/** Replaces an element with its (already cleaned) children. */
function unwrapElement(element: Element): void {
  const parent = element.parentNode;
  if (!parent) return;
  cleanChildren(element);
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  parent.removeChild(element);
}

function cleanElement(element: Element): void {
  const tag = element.tagName.toLowerCase();
  if (DROP_TAGS.has(tag)) {
    element.remove();
    return;
  }
  if (!ALLOWED_TAGS.has(tag)) {
    unwrapElement(element);
    return;
  }
  const outcome = cleanAttributes(element, tag);
  if (outcome !== 'keep') return;
  cleanChildren(element);
}

function cleanChildren(node: Node): void {
  for (const child of Array.from(node.childNodes)) {
    const type = child.nodeType;
    if (type === 8 /* comment */ || type === 7 /* processing instruction */ || type === 12 /* notation */) {
      child.remove();
      continue;
    }
    if (type === 1 /* element */) cleanElement(child as Element);
  }
}

/** Removes anything the API would strip anyway, so previews match production. */
export function sanitizeBlogHtml(html: string | null | undefined): string {
  if (!html || !html.trim()) return '';
  const document = parse(html);
  cleanChildren(document.body);
  return document.body.innerHTML;
}

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

function textFrom(node: Node, out: string[]): void {
  if (node.nodeType === 3 /* text */) {
    out.push(node.textContent ?? '');
    return;
  }
  if (node.nodeType !== 1 /* element */) return;
  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  if (DROP_TAGS.has(tag)) return;

  if (tag === 'br') {
    out.push('\n');
    return;
  }
  if (tag === 'img') {
    const alt = element.getAttribute('alt');
    out.push(alt ? ` ${alt} ` : ' ');
    return;
  }
  if (tag === 'hr') {
    out.push('\n');
    return;
  }

  for (const child of Array.from(element.childNodes)) textFrom(child, out);
  if (BLOCK_TAGS.has(tag)) out.push('\n');
}

/** Flat, human-readable text — used for word counts and excerpt suggestions. */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html || !html.trim()) return '';
  const document = parse(html);
  const out: string[] = [];
  textFrom(document.body, out);
  return out
    .join('')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function countWords(text: string | null | undefined): number {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

/** ~225 words per minute is a comfortable silent-reading pace. */
export function readingMinutes(words: number): number {
  if (words <= 0) return 0;
  return Math.max(1, Math.round(words / 225));
}

/** Suggests an excerpt by taking the first complete-ish sentences of a post. */
export function excerptFromHtml(html: string | null | undefined, maxLength = 500): string {
  const text = htmlToPlainText(html).replace(/\s*\n\s*/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;

  const window = text.slice(0, maxLength);
  const sentenceEnd = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '));
  if (sentenceEnd > maxLength * 0.45) return window.slice(0, sentenceEnd + 1).trim();

  const lastSpace = window.lastIndexOf(' ');
  return `${(lastSpace > 0 ? window.slice(0, lastSpace) : window).trim()}…`;
}

/**
 * Final pass before content leaves the browser: sanitize, then drop the
 * zero-width spaces the editor inserts to keep an empty `<code>` editable.
 */
export function cleanEditorHtml(html: string | null | undefined): string {
  if (!html) return '';
  return sanitizeBlogHtml(html).replace(/\u200b/g, '').trim();
}
