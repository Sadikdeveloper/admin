import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlogPost } from '../../api/blog';
import {
  BLANK_POST_FORM,
  categorySuggestions,
  clearDraft,
  draftKeyFor,
  formFromPost,
  hasDraft,
  postHtml,
  readDraft,
  rememberTaxonomy,
  suggestedSlug,
  tagSuggestions,
  writeDraft,
} from '../blog-draft';
import type { PostForm } from '../blog-draft';

const post = (overrides: Partial<BlogPost> = {}): BlogPost => ({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Rown Pay launches',
  slug: 'rown-pay-launches',
  excerpt: 'A short summary',
  content: null,
  contentHtml: '<p>Hello <strong>world</strong></p>',
  coverImageUrl: 'https://cdn.rown.xyz/a.png',
  coverImageAlt: 'Cover art',
  category: 'Product updates',
  tags: ['product', 'payments'],
  authorName: 'Rown Team',
  canonicalUrl: null,
  seoTitle: 'SEO title',
  seoDescription: 'SEO description',
  status: 'DRAFT',
  publishedAt: null,
  createdByAdminAddress: '0x1',
  updatedByAdminAddress: '0x1',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
});

describe('draftKeyFor', () => {
  it('separates new posts from saved ones', () => {
    expect(draftKeyFor(null)).toBe('rown.blog.draft.new');
    expect(draftKeyFor('abc')).toBe('rown.blog.draft.abc');
  });
});

describe('postHtml', () => {
  it('prefers stored HTML, sanitizes it, and falls back to the document', () => {
    expect(postHtml({ content: null, contentHtml: '<p onclick="x()">Hi</p><script>bad()</script>' })).toBe('<p>Hi</p>');
    expect(
      postHtml({
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'From doc' }] }] },
        contentHtml: null,
      }),
    ).toContain('From doc');
    expect(postHtml({ content: null, contentHtml: '   ' })).toBe('');
    expect(postHtml({ content: { type: 'doc', content: [] }, contentHtml: null })).toBe('');
  });
});

describe('formFromPost', () => {
  it('maps every editable field and never yields null', () => {
    const form = formFromPost(post());
    expect(form).toMatchObject({
      title: 'Rown Pay launches',
      slug: 'rown-pay-launches',
      slugEdited: true,
      excerpt: 'A short summary',
      coverImageUrl: 'https://cdn.rown.xyz/a.png',
      coverImageAlt: 'Cover art',
      category: 'Product updates',
      tags: ['product', 'payments'],
      authorName: 'Rown Team',
      canonicalUrl: '',
      seoTitle: 'SEO title',
      seoDescription: 'SEO description',
    });
    expect(form.html).toBe('<p>Hello <strong>world</strong></p>');
  });

  it('survives a payload with junk in it', () => {
    const form = formFromPost(post({ tags: [1 as unknown as string, 'ok'], canonicalUrl: null, excerpt: null }));
    expect(form.tags).toEqual(['ok']);
    expect(form.canonicalUrl).toBe('');
    expect(form.excerpt).toBe('');
  });
});

describe('suggestedSlug', () => {
  it('derives the slug the API would generate', () => {
    expect(suggestedSlug('Rown Pay & Cards!')).toBe('rown-pay-and-cards');
    expect(suggestedSlug('')).toBe('');
    expect(suggestedSlug('x'.repeat(400))).toHaveLength(180);
  });
});

describe('local draft backup', () => {
  const form: PostForm = { ...BLANK_POST_FORM, title: 'Saved locally', html: '<p>body</p>', tags: ['a'] };

  it('round-trips a form', () => {
    expect(hasDraft(null)).toBe(false);
    expect(writeDraft(null, form)).toEqual({ ok: true });
    expect(hasDraft(null)).toBe(true);

    const draft = readDraft(null);
    expect(draft?.form.title).toBe('Saved locally');
    expect(draft?.form.html).toBe('<p>body</p>');
    expect(draft?.form.tags).toEqual(['a']);
    expect(draft?.savedAt).toBeTruthy();

    clearDraft(null);
    expect(readDraft(null)).toBeNull();
  });

  it('keeps drafts for different posts apart', () => {
    writeDraft(null, form);
    writeDraft('post-1', { ...form, title: 'Other post' });
    expect(readDraft(null)?.form.title).toBe('Saved locally');
    expect(readDraft('post-1')?.form.title).toBe('Other post');
  });

  it('ignores a corrupted or hostile backup', () => {
    localStorage.setItem(draftKeyFor(null), '{not json');
    expect(readDraft(null)).toBeNull();

    localStorage.setItem(draftKeyFor(null), JSON.stringify({ version: 1, savedAt: 'x', form: { title: 42, tags: 'nope' } }));
    const draft = readDraft(null);
    expect(draft?.form.title).toBe('');
    expect(draft?.form.tags).toEqual([]);

    localStorage.setItem(draftKeyFor(null), JSON.stringify({ version: 1, form: null }));
    expect(readDraft(null)).toBeNull();
  });

  it('reports storage failures instead of throwing', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError: storage full');
    });
    const result = writeDraft(null, form);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/out of browser storage/i);
    setItem.mockRestore();
  });
});

describe('taxonomy memory', () => {
  it('suggests recently used categories and tags, newest first', () => {
    expect(categorySuggestions()).toEqual([]);
    expect(tagSuggestions()).toEqual([]);

    rememberTaxonomy('Product updates', ['payments', 'Product']);
    rememberTaxonomy('Security', ['security']);
    rememberTaxonomy('Product updates', ['payments']);

    expect(categorySuggestions()[0]).toBe('Product updates');
    expect(categorySuggestions()).toContain('Security');
    expect(tagSuggestions()[0]).toBe('payments');
    expect(tagSuggestions()).toContain('security');
    expect(tagSuggestions()).toContain('product');
  });

  it('ignores empty values and broken storage', () => {
    rememberTaxonomy('  ', ['', '  ']);
    expect(categorySuggestions()).toEqual([]);

    localStorage.setItem('rown.blog.taxonomy', '{oops');
    expect(categorySuggestions()).toEqual([]);
    expect(tagSuggestions()).toEqual([]);
  });
});
