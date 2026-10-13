/**
 * Image intake for the CMS: local uploads plus "grab it from a URL".
 *
 * Both paths end at the same place — bytes that are sniffed, size-checked and
 * handed to `POST /admin/blog/media` — so an operator gets one consistent set
 * of error messages whichever way they bring an image in.
 */

import { ApiError } from '../api';
import { uploadMedia } from '../api/blog';
import type { BlogMediaAsset } from '../api/blog';
import { detectImageType, formatBytes, inspectImageFile, MAX_UPLOAD_BYTES } from './blog';

export type UploadProblemKind = 'invalid' | 'storage' | 'rate' | 'network' | 'server';

export type UploadProblem = {
  kind: UploadProblemKind;
  message: string;
  detail?: string;
};

export class ImageUploadError extends Error {
  readonly problem: UploadProblem;

  constructor(problem: UploadProblem) {
    super(problem.message);
    this.name = 'ImageUploadError';
    this.problem = problem;
  }
}

/** Turns any failure into something an operator can act on. */
export function describeUploadError(error: unknown): UploadProblem {
  if (error instanceof ImageUploadError) return error.problem;

  if (error instanceof ApiError) {
    const detail = error.serverMessages[0];
    if (error.status === 503 && /not configured|configuration/i.test(detail ?? error.message)) {
      return {
        kind: 'storage',
        message: 'Blog image storage is not set up on the server yet.',
        detail:
          'An engineer needs to set BLOG_MEDIA_BUCKET, BLOG_MEDIA_ENDPOINT, BLOG_MEDIA_ACCESS_KEY_ID, BLOG_MEDIA_SECRET_ACCESS_KEY and BLOG_MEDIA_PUBLIC_BASE_URL. Until then you can still use any public https:// image URL.',
      };
    }
    if (error.status === 413) {
      return { kind: 'invalid', message: 'That image is too large for the blog. Please use one that is 5 MB or smaller.' };
    }
    if (error.status === 429) {
      return {
        kind: 'rate',
        message: 'Too many uploads in a short time.',
        detail: 'The blog allows 15 uploads per minute. Wait a moment, then try the rest.',
      };
    }
    if (error.status === 400) {
      return { kind: 'invalid', message: error.message, detail: error.serverMessages.slice(1).join(' · ') || undefined };
    }
    if (error.status === 0) {
      return { kind: 'network', message: error.message };
    }
    return { kind: 'server', message: error.message };
  }

  const message = error instanceof Error ? error.message : String(error);
  return { kind: 'server', message: message || 'The upload failed. Please try again.' };
}

/** Validates and uploads one image, throwing an `ImageUploadError` on failure. */
export async function uploadBlogImage(file: File | Blob, filename?: string): Promise<BlogMediaAsset> {
  const check = await inspectImageFile(file);
  if (!check.ok) throw new ImageUploadError({ kind: 'invalid', message: check.error });

  try {
    return await uploadMedia(file, filename ?? (file instanceof File ? file.name : `image.${check.kind.extension}`));
  } catch (error) {
    throw new ImageUploadError(describeUploadError(error));
  }
}

export function fileNameFromUrl(url: URL, extension: string): string {
  const base = url.pathname.split('/').filter(Boolean).pop() ?? '';
  const cleaned = base.replace(/\.[a-z0-9]+$/i, '').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 60);
  return `${cleaned || 'imported-image'}.${extension}`;
}

/**
 * Downloads an image from the open web so it can live on the Rown CDN.
 *
 * Many sites do not send CORS headers, and that is not something we can fix
 * from a browser — the error explains the fallback (use the URL as-is).
 */
export async function fetchRemoteImage(rawUrl: string): Promise<File> {
  const url = rawUrl.trim();
  if (!url) throw new ImageUploadError({ kind: 'invalid', message: 'Enter the image address first.' });

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ImageUploadError({
      kind: 'invalid',
      message: 'That does not look like a complete image address.',
      detail: 'Include the full address, starting with https://',
    });
  }
  if (!['http:', 'https:'].includes(parsed.protocol.toLowerCase())) {
    throw new ImageUploadError({ kind: 'invalid', message: 'Only http:// and https:// images can be imported.' });
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try {
    response = await fetch(parsed, { mode: 'cors', redirect: 'follow', credentials: 'omit', signal: controller.signal });
  } catch {
    throw new ImageUploadError({
      kind: 'network',
      message: 'That site would not let the console download the image.',
      detail:
        'Most likely it blocks cross-origin requests (CORS) or the address is unreachable. You can still paste the URL and use the image directly — it just will not be copied to the Rown CDN.',
    });
  } finally {
    window.clearTimeout(timer);
  }

  if (!response.ok) {
    throw new ImageUploadError({
      kind: 'network',
      message: `That image address replied with an error (HTTP ${response.status}).`,
      detail: 'Open it in a new tab to check it still exists, then try again.',
    });
  }

  const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (contentType && !contentType.startsWith('image/')) {
    throw new ImageUploadError({
      kind: 'invalid',
      message: 'That address does not point at an image.',
      detail: `The server said it is ${contentType || 'an unknown file type'}.`,
    });
  }

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES) {
    throw new ImageUploadError({
      kind: 'invalid',
      message: `That image is ${formatBytes(declaredLength)} — the blog accepts up to 5 MB.`,
    });
  }

  const blob = await response.blob().catch(() => null);
  if (!blob || blob.size === 0) {
    throw new ImageUploadError({ kind: 'network', message: 'That image came back empty. Please try another address.' });
  }
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new ImageUploadError({
      kind: 'invalid',
      message: `That image is ${formatBytes(blob.size)} — the blog accepts up to 5 MB.`,
    });
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const kind = detectImageType(bytes);
  if (!kind) {
    throw new ImageUploadError({
      kind: 'invalid',
      message: 'That file is not a JPEG, PNG, GIF or WebP image, so the blog cannot store it.',
      detail: 'You can still use the URL directly if it displays correctly in a browser.',
    });
  }

  return new File([blob], fileNameFromUrl(parsed, kind.extension), { type: kind.contentType });
}
