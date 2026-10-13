/**
 * Blog/CMS specific formatting, limits and validation helpers.
 *
 * Field limits mirror the backend DTOs exactly so an operator sees the same
 * boundary in the browser that the API enforces.
 */

import type { BlogCommentStatus, BlogPost } from '../api/blog';

/* ------------------------------------------------------------------ */
/* Limits (must match src/modules/blog/dto/blog.dto.ts)                */
/* ------------------------------------------------------------------ */

export const TITLE_MAX = 200;
export const SLUG_MAX = 180;
export const EXCERPT_MAX = 500;
export const COVER_ALT_MAX = 250;
export const CATEGORY_MAX = 80;
export const AUTHOR_MAX = 120;
export const SEO_TITLE_MAX = 200;
export const SEO_DESCRIPTION_MAX = 320;
export const TAG_MAX = 40;
export const TAGS_MAX = 20;
export const CANONICAL_MAX = 2048;
export const COMMENT_BODY_MAX = 2000;
export const COMMENT_NAME_MAX = 80;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/gif,image/webp';
export const ACCEPTED_IMAGE_LIST = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
export const SLUG_PATTERN = /^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/;

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

/** Mirrors the backend slugifier so the preview matches the stored slug. */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
}

export function normalizeTag(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TAG_MAX)
    .toLowerCase();
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const shown = value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '');
  return `${shown} ${units[unit]}`;
}

/* ------------------------------------------------------------------ */
/* Time                                                                */
/* ------------------------------------------------------------------ */

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 1000 * 60 * 60 * 24 * 365],
  ['month', 1000 * 60 * 60 * 24 * 30],
  ['week', 1000 * 60 * 60 * 24 * 7],
  ['day', 1000 * 60 * 60 * 24],
  ['hour', 1000 * 60 * 60],
  ['minute', 1000 * 60],
];

/** "4 minutes ago" / "in 3 days" — used for both history and schedules. */
export function relativeTime(value?: string | Date | null, now: number = Date.now()): string {
  if (!value) return '—';
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (Number.isNaN(time)) return '—';

  const diff = time - now;
  const abs = Math.abs(diff);
  if (abs < 45_000) return 'just now';

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (abs >= size) return formatter.format(Math.round(diff / size), unit);
  }
  return formatter.format(Math.round(diff / 60_000), 'minute');
}

export function formatDateTime(value?: string | Date | null): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString([], {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Value for an `<input type="datetime-local">` in the operator's timezone. */
export function toLocalInputValue(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

export function fromLocalInputValue(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A schedule five minutes in the past is a mistake, not a plan. */
export function scheduleProblem(date: Date | null, now: number = Date.now()): string | null {
  if (!date) return 'Pick the date and time this post should go live.';
  if (Number.isNaN(date.getTime())) return 'That date could not be read. Please pick it from the calendar.';
  if (date.getTime() <= now + 30_000) return 'Choose a time at least a minute from now, or publish immediately instead.';
  if (date.getTime() > now + 1000 * 60 * 60 * 24 * 366) return 'That is more than a year away — please double-check the year.';
  return null;
}

/* ------------------------------------------------------------------ */
/* Post state                                                          */
/* ------------------------------------------------------------------ */

export type PostState = 'draft' | 'scheduled' | 'published';

/** The API has two statuses; "scheduled" is a published post with a future date. */
export function postState(post: Pick<BlogPost, 'status' | 'publishedAt'>, now: number = Date.now()): PostState {
  if (post.status !== 'PUBLISHED') return 'draft';
  if (!post.publishedAt) return 'published';
  const time = new Date(post.publishedAt).getTime();
  return Number.isFinite(time) && time > now ? 'scheduled' : 'published';
}

export const POST_STATE_META: Record<PostState, { label: string; className: string; hint: string }> = {
  draft: {
    label: 'Draft',
    className: 'state-draft',
    hint: 'Only visible inside the admin console.',
  },
  scheduled: {
    label: 'Scheduled',
    className: 'state-scheduled',
    hint: 'Published, but hidden from readers until the scheduled time.',
  },
  published: {
    label: 'Published',
    className: 'state-published',
    hint: 'Live on the public blog.',
  },
};

export const COMMENT_STATE_META: Record<BlogCommentStatus, { label: string; className: string; hint: string }> = {
  PENDING: {
    label: 'Pending',
    className: 'state-scheduled',
    hint: 'Waiting for moderation — not visible to readers.',
  },
  APPROVED: {
    label: 'Approved',
    className: 'state-published',
    hint: 'Visible under the post.',
  },
  REJECTED: {
    label: 'Rejected',
    className: 'state-rejected',
    hint: 'Hidden from readers and kept for the record.',
  },
};

/* ------------------------------------------------------------------ */
/* URLs                                                                */
/* ------------------------------------------------------------------ */

/**
 * Cover images must be HTTPS (or a root-relative path) — the API rejects
 * anything else, so we say so before the operator hits save.
 */
export function mediaUrlProblem(value: string): string | null {
  const url = value.trim();
  if (!url) return null;
  if (url.startsWith('/') && !url.startsWith('//')) return null;
  return absoluteUrlProblem(url, ['https:'], 'Use an https:// image URL, or pick one from the media library.');
}

/** Canonical URLs must be absolute HTTPS links. */
export function canonicalUrlProblem(value: string): string | null {
  const url = value.trim();
  if (!url) return null;
  return absoluteUrlProblem(url, ['https:'], 'Use the full https:// address of the original article.');
}

function absoluteUrlProblem(value: string, protocols: string[], message: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return message;
  }
  if (!protocols.includes(parsed.protocol.toLowerCase()) || parsed.username || parsed.password) return message;
  return null;
}

/** Where readers will see a post, when the deployment tells us the site URL. */
export function publicSiteUrl(): string | null {
  const configured = import.meta.env.VITE_PUBLIC_SITE_URL;
  if (typeof configured !== 'string' || !configured.trim()) return null;
  const trimmed = configured.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

export function publicPostUrl(slug: string): string | null {
  const base = publicSiteUrl();
  if (!base || !slug) return null;
  return `${base}/blog/${encodeURIComponent(slug)}`;
}

/* ------------------------------------------------------------------ */
/* Image files                                                         */
/* ------------------------------------------------------------------ */

export type ImageKind = { contentType: string; extension: string; label: string };

/**
 * Sniffs the real image type from the bytes. Browsers trust the declared MIME
 * type, and so does the multipart layer — the API re-checks the header, so
 * catching a mismatch here turns a confusing server error into a clear one.
 */
export function detectImageType(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 8) {
    const png = [137, 80, 78, 71, 13, 10, 26, 10];
    if (png.every((value, index) => bytes[index] === value)) {
      return { contentType: 'image/png', extension: 'png', label: 'PNG' };
    }
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: 'image/jpeg', extension: 'jpg', label: 'JPEG' };
  }
  if (bytes.length >= 6) {
    const gif = String.fromCharCode(...Array.from(bytes.slice(0, 6)));
    if (gif === 'GIF87a' || gif === 'GIF89a') return { contentType: 'image/gif', extension: 'gif', label: 'GIF' };
  }
  if (bytes.length >= 12) {
    const riff = String.fromCharCode(...Array.from(bytes.slice(0, 4)));
    const webp = String.fromCharCode(...Array.from(bytes.slice(8, 12)));
    if (riff === 'RIFF' && webp === 'WEBP') return { contentType: 'image/webp', extension: 'webp', label: 'WebP' };
  }
  return null;
}

export type ImageCheck = { ok: true; kind: ImageKind; bytes: Uint8Array } | { ok: false; error: string };

export async function inspectImageFile(file: File | Blob): Promise<ImageCheck> {
  if (!file) return { ok: false, error: 'No file was received. Please choose an image and try again.' };
  if (file.size === 0) return { ok: false, error: 'That file is empty. Please choose a real image.' };
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `Images must be 5 MB or smaller — this one is ${formatBytes(file.size)}.`,
    };
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, error: 'That file could not be read. It may be locked by another app.' };
  }

  const kind = detectImageType(bytes);
  if (!kind) {
    return {
      ok: false,
      error: 'Only JPEG, PNG, GIF, and WebP images can be uploaded to the blog.',
    };
  }
  if (file.type && ACCEPTED_IMAGE_LIST.includes(file.type) && file.type !== kind.contentType) {
    return {
      ok: false,
      error: `That file is labelled ${file.type} but its contents look like ${kind.label}. Re-save it as a ${kind.label} and try again.`,
    };
  }
  return { ok: true, kind, bytes };
}

/** Object URLs are easy to leak; this keeps a single place that frees them. */
export function revokeLater(url: string | null, delay = 60_000): void {
  if (!url) return;
  window.setTimeout(() => URL.revokeObjectURL(url), delay);
}
