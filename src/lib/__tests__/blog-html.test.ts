import { describe, expect, it } from 'vitest';
import {
  cleanEditorHtml,
  countWords,
  excerptFromHtml,
  htmlToPlainText,
  readingMinutes,
  sanitizeBlogHtml,
  sanitizeUrl,
} from '../blog-html';

describe('sanitizeUrl', () => {
  it('keeps http(s), root-relative paths and anchors for links', () => {
    expect(sanitizeUrl('https://cdn.rown.xyz/a.png', false)).toBe('https://cdn.rown.xyz/a.png');
    expect(sanitizeUrl('/blog-media/a.png', false)).toBe('/blog-media/a.png');
    expect(sanitizeUrl('images/a.png', false)).toBe('images/a.png');
    expect(sanitizeUrl('#section', true)).toBe('#section');
    expect(sanitizeUrl('mailto:hello@rown.xyz', true)).toBe('mailto:hello@rown.xyz');
    expect(sanitizeUrl('tel:+2348000000000', true)).toBe('tel:+2348000000000');
  });

  it('drops every scheme that can execute or exfiltrate', () => {
    expect(sanitizeUrl('javascript:alert(1)', true)).toBeNull();
    expect(sanitizeUrl('java\nscript:alert(1)', true)).toBeNull();
    expect(sanitizeUrl('  JAVASCRIPT:alert(1)', true)).toBeNull();
    expect(sanitizeUrl('vbscript:msgbox', true)).toBeNull();
    expect(sanitizeUrl('data:image/png;base64,AAAA', false)).toBeNull();
    expect(sanitizeUrl('blob:https://rown.xyz/1', false)).toBeNull();
    expect(sanitizeUrl('file:///etc/passwd', true)).toBeNull();
    expect(sanitizeUrl('//cdn.rown.xyz/a.png', false)).toBeNull();
    expect(sanitizeUrl('https://user:pass@cdn.rown.xyz/a.png', false)).toBeNull();
  });

  it('is stricter for images than for links', () => {
    expect(sanitizeUrl('mailto:hello@rown.xyz', false)).toBeNull();
    expect(sanitizeUrl('#section', false)).toBe('#section');
    expect(sanitizeUrl('http://cdn.rown.xyz/a.png', false)).toBe('http://cdn.rown.xyz/a.png');
  });

  it('handles empty and malformed input', () => {
    expect(sanitizeUrl('', true)).toBeNull();
    expect(sanitizeUrl('   ', true)).toBeNull();
    expect(sanitizeUrl('http://', true)).toBeNull();
  });
});

describe('sanitizeBlogHtml', () => {
  it('removes script subtrees, event handlers and style attributes', () => {
    const output = sanitizeBlogHtml(
      '<p onclick="steal()" style="color:red">Hello</p><script>alert(1)</script><style>p{}</style>',
    );
    expect(output).toBe('<p>Hello</p>');
    expect(output).not.toMatch(/onclick|script|style/i);
  });

  it('drops iframes, forms and other embedded content', () => {
    const output = sanitizeBlogHtml(
      '<p>Before</p><iframe src="https://evil.example"></iframe><form><input value="x"><button>Go</button></form><p>After</p>',
    );
    expect(output).toBe('<p>Before</p><p>After</p>');
  });

  it('unwraps an anchor with an unsafe href but keeps its text', () => {
    expect(sanitizeBlogHtml('<p><a href="javascript:alert(1)">click</a></p>')).toBe('<p>click</p>');
  });

  it('removes an image with an unsafe src entirely', () => {
    expect(sanitizeBlogHtml('<p><img src="data:image/png;base64,AAAA" alt="x"></p>')).toBe('<p></p>');
  });

  it('keeps the tags the API keeps, including class hooks', () => {
    const output = sanitizeBlogHtml(
      '<h2 class="lede">Title</h2><ul><li><p>one</p></li></ul><blockquote><p>quoted</p></blockquote>' +
        '<pre><code>const a = 1;</code></pre><figure class="cms-figure"><img src="https://cdn.rown.xyz/a.png" alt="A" loading="lazy"><figcaption>Caption</figcaption></figure><hr>' +
        '<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>C</td></tr></tbody></table>',
    );
    expect(output).toContain('<h2 class="lede">Title</h2>');
    expect(output).toContain('<ul><li><p>one</p></li></ul>');
    expect(output).toContain('<blockquote><p>quoted</p></blockquote>');
    expect(output).toContain('<pre><code>const a = 1;</code></pre>');
    expect(output).toContain('<figure class="cms-figure">');
    expect(output).toContain('<img src="https://cdn.rown.xyz/a.png" alt="A">');
    expect(output).toContain('<figcaption>Caption</figcaption>');
    expect(output).toContain('<hr>');
    expect(output).toContain('<th>H</th>');
    expect(output).not.toContain('loading');
  });

  it('forces safe rel on target="_blank" links and keeps unknown tags as text', () => {
    const output = sanitizeBlogHtml('<a href="https://rown.xyz" target="_blank">Rown</a><marquee>hi</marquee>');
    expect(output).toContain('rel="noopener noreferrer nofollow"');
    expect(output).toContain('>Rown</a>');
    expect(output).not.toContain('<marquee');
    expect(output).toContain('hi');
  });

  it('strips HTML comments', () => {
    expect(sanitizeBlogHtml('<p>a</p><!-- secret --><p>b</p>')).toBe('<p>a</p><p>b</p>');
  });

  it('is a no-op for empty input', () => {
    expect(sanitizeBlogHtml('')).toBe('');
    expect(sanitizeBlogHtml(null)).toBe('');
    expect(sanitizeBlogHtml(undefined)).toBe('');
    expect(sanitizeBlogHtml('   ')).toBe('');
  });
});

describe('htmlToPlainText', () => {
  it('flattens markup into readable text', () => {
    expect(htmlToPlainText('<p>Hello <strong>world</strong></p><p>Second</p>')).toBe('Hello world\nSecond');
    expect(htmlToPlainText('<ul><li>one</li><li>two</li></ul>')).toMatch(/one/);
    expect(htmlToPlainText('<img src="https://x/a.png" alt="Cover art">')).toBe('Cover art');
    expect(htmlToPlainText('<script>evil()</script>safe')).toBe('safe');
    expect(htmlToPlainText('')).toBe('');
    expect(htmlToPlainText(null)).toBe('');
  });
});

describe('countWords / readingMinutes', () => {
  it('counts words and estimates a reading time', () => {
    expect(countWords('one two  three\nfour')).toBe(4);
    expect(countWords('')).toBe(0);
    expect(countWords(null)).toBe(0);
    expect(readingMinutes(0)).toBe(0);
    expect(readingMinutes(50)).toBe(1);
    expect(readingMinutes(450)).toBe(2);
    expect(readingMinutes(2000)).toBe(9);
  });
});

describe('excerptFromHtml', () => {
  it('returns short text unchanged', () => {
    expect(excerptFromHtml('<p>Short and sweet.</p>')).toBe('Short and sweet.');
    expect(excerptFromHtml('')).toBe('');
  });

  it('cuts at a sentence boundary when one is close enough', () => {
    const html = `<p>${'First sentence. '} ${'Filler words. '.repeat(20)} Tail.</p>`;
    const excerpt = excerptFromHtml(html, 120);
    expect(excerpt.length).toBeLessThanOrEqual(120);
    expect(excerpt.endsWith('.')).toBe(true);
  });

  it('falls back to a word boundary with an ellipsis', () => {
    const excerpt = excerptFromHtml(`<p>${'word '.repeat(200)}</p>`, 60);
    expect(excerpt.length).toBeLessThanOrEqual(61);
    expect(excerpt.endsWith('…')).toBe(true);
    // cut on a space, never mid-word
    expect(excerpt.slice(0, -1)).toMatch(/\bword$/);
  });
});

describe('cleanEditorHtml', () => {
  it('removes the zero-width spaces the editor uses as caret placeholders', () => {
    expect(cleanEditorHtml('<p>before<a><code>\u200bconst a\u200b</code></a>after</p>')).toBe(
      '<p>before<a><code>const a</code></a>after</p>',
    );
  });

  it('sanitizes on the way out, so what is saved is what the server keeps', () => {
    expect(cleanEditorHtml('<p onclick="x()">hi</p><script>bad()</script>')).toBe('<p>hi</p>');
  });

  it('handles empty values', () => {
    expect(cleanEditorHtml('')).toBe('');
    expect(cleanEditorHtml(null)).toBe('');
    expect(cleanEditorHtml(undefined)).toBe('');
  });
});
