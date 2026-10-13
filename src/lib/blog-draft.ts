/**
 * Editor form state, its device-local backup, and the small amount of memory
 * the console keeps about categories and tags an operator has used before.
 *
 * Long articles are expensive to lose, so every keystroke is mirrored into
 * localStorage (debounced by the editor screen). The backup is compared with
 * the server copy on load: whichever is newer wins, and the operator decides.
 */

import type { BlogPost } from '../api/blog';
import { documentToHtml, hasDocumentContent } from './blog-doc';
import { sanitizeBlogHtml } from './blog-html';
import {
  AUTHOR_MAX,
  CANONICAL_MAX,
  CATEGORY_MAX,
  COVER_ALT_MAX,
  EXCERPT_MAX,
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
  SLUG_MAX,
  TAGS_MAX,
  TITLE_MAX,
  slugify,
} from './blog';

export type PostForm = {
  title: string;
  slug: string;
  /** Once an operator edits the slug by hand it stops following the title. */
  slugEdited: boolean;
  excerpt: string;
  html: string;
  coverImageUrl: string;
  coverImageAlt: string;
  category: string;
  tags: string[];
  authorName: string;
  canonicalUrl: string;
  seoTitle: string;
  seoDescription: string;
};

export const BLANK_POST_FORM: PostForm = {
  title: '',
  slug: '',
  slugEdited: false,
  excerpt: '',
  html: '',
  coverImageUrl: '',
  coverImageAlt: '',
  category: '',
  tags: [],
  authorName: '',
  canonicalUrl: '',
  seoTitle: '',
  seoDescription: '',
};

export type StoredDraft = { version: 1; savedAt: string; form: PostForm };

const DRAFT_PREFIX = 'rown.blog.draft.';
const TAXONOMY_KEY = 'rown.blog.taxonomy';

export function draftKeyFor(postId: string | null): string {
  return `${DRAFT_PREFIX}${postId ?? 'new'}`;
}

/* ------------------------------------------------------------------ */
/* Post → form                                                         */
/* ------------------------------------------------------------------ */

/** The HTML a reader would see, whichever format the post was written in. */
export function postHtml(post: Pick<BlogPost, 'content' | 'contentHtml'>): string {
  if (post.contentHtml?.trim()) return sanitizeBlogHtml(post.contentHtml);
  return hasDocumentContent(post.content) ? documentToHtml(post.content) : '';
}

export function formFromPost(post: BlogPost): PostForm {
  return {
    title: post.title ?? '',
    slug: post.slug ?? '',
    slugEdited: true,
    excerpt: post.excerpt ?? '',
    html: postHtml(post),
    coverImageUrl: post.coverImageUrl ?? '',
    coverImageAlt: post.coverImageAlt ?? '',
    category: post.category ?? '',
    tags: Array.isArray(post.tags) ? post.tags.filter(tag => typeof tag === 'string') : [],
    authorName: post.authorName ?? '',
    canonicalUrl: post.canonicalUrl ?? '',
    seoTitle: post.seoTitle ?? '',
    seoDescription: post.seoDescription ?? '',
  };
}

/** The slug the API would generate for a title, used while the slug is untouched. */
export function suggestedSlug(title: string): string {
  return slugify(title).slice(0, SLUG_MAX);
}

/* ------------------------------------------------------------------ */
/* Local backup                                                        */
/* ------------------------------------------------------------------ */

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/** Storage can hold anything; a malformed backup must never break the editor. */
function normalizeForm(value: unknown): PostForm | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((tag): tag is string => typeof tag === 'string').map(tag => tag.slice(0, 40)).slice(0, TAGS_MAX)
    : [];

  return {
    title: text(raw.title, TITLE_MAX + 40),
    slug: text(raw.slug, SLUG_MAX + 40),
    slugEdited: Boolean(raw.slugEdited),
    excerpt: text(raw.excerpt, EXCERPT_MAX + 40),
    html: typeof raw.html === 'string' ? raw.html.slice(0, 2_000_000) : '',
    coverImageUrl: text(raw.coverImageUrl, CANONICAL_MAX),
    coverImageAlt: text(raw.coverImageAlt, COVER_ALT_MAX + 40),
    category: text(raw.category, CATEGORY_MAX + 40),
    tags,
    authorName: text(raw.authorName, AUTHOR_MAX + 40),
    canonicalUrl: text(raw.canonicalUrl, CANONICAL_MAX),
    seoTitle: text(raw.seoTitle, SEO_TITLE_MAX + 40),
    seoDescription: text(raw.seoDescription, SEO_DESCRIPTION_MAX + 40),
  };
}

export function readDraft(postId: string | null): StoredDraft | null {
  try {
    const raw = localStorage.getItem(draftKeyFor(postId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    const form = normalizeForm(parsed?.form);
    if (!form) return null;
    const savedAt = typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString();
    return { version: 1, savedAt, form };
  } catch {
    return null;
  }
}

export function writeDraft(postId: string | null, form: PostForm): { ok: boolean; error?: string } {
  try {
    const payload: StoredDraft = { version: 1, savedAt: new Date().toISOString(), form };
    localStorage.setItem(draftKeyFor(postId), JSON.stringify(payload));
    return { ok: true };
  } catch (error) {
    // Safari in private mode and full storage both throw here. The editor
    // keeps working; only the offline backup is lost.
    const quota = error instanceof Error && /quota|exceeded/i.test(error.message);
    return {
      ok: false,
      error: quota
        ? 'This device is out of browser storage, so unsaved work cannot be backed up locally. Save to the server soon.'
        : 'Your browser blocked local storage, so unsaved work cannot be backed up on this device.',
    };
  }
}

export function clearDraft(postId: string | null): void {
  try {
    localStorage.removeItem(draftKeyFor(postId));
  } catch {
    /* nothing useful to do */
  }
}

/** True when a local backup exists for a post that has no server copy yet. */
export function hasDraft(postId: string | null): boolean {
  return readDraft(postId) !== null;
}

/* ------------------------------------------------------------------ */
/* Category & tag memory (suggestions only, never a restriction)       */
/* ------------------------------------------------------------------ */

type Taxonomy = { categories: string[]; tags: string[] };

function readTaxonomy(): Taxonomy {
  try {
    const raw = localStorage.getItem(TAXONOMY_KEY);
    if (!raw) return { categories: [], tags: [] };
    const parsed = JSON.parse(raw) as Partial<Taxonomy>;
    return {
      categories: Array.isArray(parsed.categories) ? parsed.categories.filter((v): v is string => typeof v === 'string') : [],
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((v): v is string => typeof v === 'string') : [],
    };
  } catch {
    return { categories: [], tags: [] };
  }
}

/** Remembers what an operator used so the next post can suggest it. */
export function rememberTaxonomy(category: string | null | undefined, tags: string[] | undefined): void {
  try {
    const current = readTaxonomy();
    const categories = current.categories;
    const nextTags = current.tags;
    const trimmedCategory = category?.trim();
    if (trimmedCategory) {
      const index = categories.findIndex(value => value.toLowerCase() === trimmedCategory.toLowerCase());
      if (index >= 0) categories.splice(index, 1);
      categories.unshift(trimmedCategory);
    }
    for (const tag of tags ?? []) {
      const clean = tag.trim().toLowerCase();
      if (!clean) continue;
      const index = nextTags.indexOf(clean);
      if (index >= 0) nextTags.splice(index, 1);
      nextTags.unshift(clean);
    }
    localStorage.setItem(
      TAXONOMY_KEY,
      JSON.stringify({ categories: categories.slice(0, 40), tags: nextTags.slice(0, 60) } satisfies Taxonomy),
    );
  } catch {
    /* suggestions are a nicety; ignore storage failures */
  }
}

export function categorySuggestions(): string[] {
  return readTaxonomy().categories;
}

export function tagSuggestions(): string[] {
  return readTaxonomy().tags;
}
