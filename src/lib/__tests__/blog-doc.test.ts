import { describe, expect, it } from 'vitest';
import {
  documentToHtml,
  documentToText,
  hasDocumentContent,
  htmlToDocument,
  isRichDocument,
} from '../blog-doc';
import type { RichNode } from '../blog-doc';

type Node = RichNode & { content?: Node[]; attrs?: Record<string, unknown> };

function nodes(doc: unknown): Node[] {
  return ((doc as Node | null)?.content ?? []) as Node[];
}

function findByType(value: unknown, type: string): Node | undefined {
  const node = value as Node | null;
  if (!node || typeof node !== 'object') return undefined;
  if (String(node.type).toLowerCase() === type) return node;
  for (const child of nodes(node)) {
    const found = findByType(child, type);
    if (found) return found;
  }
  return undefined;
}

describe('htmlToDocument', () => {
  it('converts paragraphs and inline marks', () => {
    const doc = nodes(htmlToDocument('<p>Hello <strong>world</strong>, <em>again</em></p>'));
    expect(doc).toHaveLength(1);
    expect(doc[0].type).toBe('paragraph');
    expect(doc[0].content?.[0]).toMatchObject({ type: 'text', text: 'Hello ' });
    expect(doc[0].content?.[1]).toMatchObject({ type: 'text', text: 'world', marks: [{ type: 'bold' }] });
    expect(doc[0].content?.[2]).toMatchObject({ type: 'text', text: ', ' });
    expect(doc[0].content?.[3]).toMatchObject({ type: 'text', text: 'again', marks: [{ type: 'italic' }] });
  });

  it('converts headings with their level', () => {
    const doc = nodes(htmlToDocument('<h2>Section</h2><h3>Sub</h3>'));
    expect(doc[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
    expect(doc[1]).toMatchObject({ type: 'heading', attrs: { level: 3 } });
  });

  it('converts lists into listItem paragraphs', () => {
    const list = findByType(htmlToDocument('<ul><li>one</li><li>two</li></ul>'), 'bulletlist');
    expect(list?.content).toHaveLength(2);
    expect(list?.content?.[0].type).toBe('listItem');
    expect(list?.content?.[0].content?.[0].type).toBe('paragraph');

    const ordered = findByType(htmlToDocument('<ol><li>one</li></ol>'), 'orderedlist');
    expect(ordered?.type).toBe('orderedList');
  });

  it('converts quotes, code blocks and rules', () => {
    expect(findByType(htmlToDocument('<blockquote><p>quoted</p></blockquote>'), 'blockquote')).toBeTruthy();
    const code = findByType(htmlToDocument('<pre><code>const a = 1;</code></pre>'), 'codeblock');
    expect(code?.content?.[0]).toMatchObject({ type: 'text', text: 'const a = 1;' });
    expect(findByType(htmlToDocument('<p>a</p><hr><p>b</p>'), 'horizontalrule')?.type).toBe('horizontalRule');
  });

  it('converts images and keeps only safe sources', () => {
    const image = findByType(htmlToDocument('<img src="https://cdn.rown.xyz/a.png" alt="Cover">'), 'image');
    expect(image?.attrs).toMatchObject({ src: 'https://cdn.rown.xyz/a.png', alt: 'Cover' });

    const unsafe = htmlToDocument('<img src="javascript:alert(1)" alt="x"><p>after</p>');
    expect(findByType(unsafe, 'image')).toBeUndefined();
    expect(documentToText(unsafe)).toBe('after');
  });

  it('stores a figure caption on the image and renders it back', () => {
    const doc = htmlToDocument(
      '<figure><img src="https://cdn.rown.xyz/a.png" alt="A"><figcaption>Caption text</figcaption></figure>',
    );
    const image = findByType(doc, 'image');
    expect(image?.attrs).toMatchObject({ src: 'https://cdn.rown.xyz/a.png', alt: 'A', caption: 'Caption text' });
    expect(documentToHtml(doc)).toContain('<figcaption>Caption text</figcaption>');
  });

  it('turns links into link marks with sanitized hrefs', () => {
    const doc = htmlToDocument('<p><a href="https://rown.xyz" target="_blank">Rown</a></p>');
    const mark = nodes(doc)[0].content?.[0].marks?.[0];
    expect(mark?.type).toBe('link');
    expect(mark?.attrs).toMatchObject({ href: 'https://rown.xyz/', target: '_blank' });

    const unsafe = htmlToDocument('<p><a href="javascript:alert(1)">bad</a></p>');
    expect(nodes(unsafe)[0].content?.[0].marks ?? []).toHaveLength(0);
  });

  it('ignores scripts, styles and comments', () => {
    const doc = htmlToDocument('<script>alert(1)</script><style>p{}</style><!-- note --><p>Real text</p>');
    expect(documentToText(doc)).toBe('Real text');
  });

  it('returns null when there is nothing to store', () => {
    expect(htmlToDocument('')).toBeNull();
    expect(htmlToDocument(null)).toBeNull();
    expect(htmlToDocument('   ')).toBeNull();
    expect(htmlToDocument('<script>alert(1)</script>')).toBeNull();
  });

  it('survives absurd nesting and huge documents without throwing', () => {
    const deep = `<div>${'<div>'.repeat(80)}deep${'</div>'.repeat(80)}</div>`;
    expect(documentToText(htmlToDocument(deep))).toContain('deep');

    const wide = `<p>${'word '.repeat(5000)}</p>`;
    expect(documentToText(htmlToDocument(wide)).split(/\s+/)).toHaveLength(5000);
  });
});

describe('documentToHtml', () => {
  it('renders a document back to safe HTML', () => {
    const html = documentToHtml({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'bold ' , marks: [{ type: 'bold' }] },
            { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://rown.xyz' } }] },
          ],
        },
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }] }],
        },
        { type: 'image', attrs: { src: 'https://cdn.rown.xyz/a.png', alt: 'A' } },
        { type: 'horizontalRule' },
      ],
    });
    expect(html).toContain('<h2>Title</h2>');
    expect(html).toContain('<strong>bold </strong>');
    expect(html).toMatch(/<a href="https:\/\/rown\.xyz\/?"/);
    expect(html).toContain('<ul><li>');
    expect(html).toContain('<img src="https://cdn.rown.xyz/a.png" alt="A"');
    expect(html).toContain('<hr>');
  });

  it('escapes text so a document cannot inject markup', () => {
    const html = documentToHtml({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '<script>alert(1)</script>' }] }],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('drops unsafe attrs and unknown node types', () => {
    const html = documentToHtml({
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: 'javascript:alert(1)' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'kept', marks: [{ type: 'link', attrs: { href: 'data:text/html,x' } }] }] },
      ],
    });
    expect(html).not.toMatch(/javascript:|data:/i);
    expect(html).toContain('kept');
  });

  it('tolerates junk input', () => {
    expect(documentToHtml(null)).toBe('');
    expect(documentToHtml('nope')).toBe('');
    expect(documentToHtml({})).toBe('');
    expect(documentToHtml({ type: 'doc' })).toBe('');
  });
});

describe('documentToText', () => {
  it('flattens a document to plain text', () => {
    const text = documentToText({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Body copy' }] },
      ],
    });
    expect(text).toContain('Title');
    expect(text).toContain('Body copy');
  });
});

describe('hasDocumentContent', () => {
  it('mirrors the API publish check', () => {
    expect(hasDocumentContent(null)).toBe(false);
    expect(hasDocumentContent({})).toBe(false);
    expect(hasDocumentContent({ type: 'doc', content: [] })).toBe(false);
    expect(hasDocumentContent({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe(false);
    expect(hasDocumentContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] })).toBe(true);
    expect(hasDocumentContent({ type: 'doc', content: [{ type: 'image', attrs: { src: 'https://x/a.png' } }] })).toBe(true);
    expect(hasDocumentContent({ type: 'doc', content: [{ type: 'horizontalRule' }] })).toBe(true);
    expect(hasDocumentContent({ type: 'doc', content: [{ type: 'html', html: '<p>x</p>' }] })).toBe(true);
    expect(hasDocumentContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '   ' }] }] })).toBe(false);
  });
});

describe('isRichDocument', () => {
  it('recognises document-shaped values only', () => {
    expect(isRichDocument({ type: 'doc', content: [] })).toBe(true);
    expect(isRichDocument({ content: [] })).toBe(true);
    expect(isRichDocument('doc')).toBe(false);
    expect(isRichDocument(null)).toBe(false);
    expect(isRichDocument([])).toBe(false);
  });
});

describe('round trip', () => {
  it('keeps the article intact through html → document → html', () => {
    const original =
      '<h2>Launch</h2><p>We shipped <strong>Rown Pay</strong> today.</p><ul><li><p>Kenya</p></li><li><p>Ghana</p></li></ul>' +
      '<blockquote><p>Payments should be boring.</p></blockquote><img src="https://cdn.rown.xyz/a.png" alt="Cover"><hr>';
    const doc = htmlToDocument(original);
    const html = documentToHtml(doc);

    expect(html).toContain('<h2>Launch</h2>');
    expect(html).toContain('<strong>Rown Pay</strong>');
    expect(html).toContain('Kenya');
    expect(html).toContain('Ghana');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<img src="https://cdn.rown.xyz/a.png" alt="Cover"');
    expect(html).toContain('<hr>');
    expect(documentToText(doc)).toContain('Payments should be boring.');
  });
});
