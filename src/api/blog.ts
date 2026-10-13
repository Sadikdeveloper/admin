import { ApiError, apiFetch, unwrapData } from '../api';

/* ------------------------------------------------------------------ */
/* Types — these mirror the backend blog module (see docs/blog-module.md) */
/* ------------------------------------------------------------------ */

export type BlogPostStatus = 'DRAFT' | 'PUBLISHED';
export type BlogCommentStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/** Rich editor document (ProseMirror/Tiptap shaped) as accepted by the API. */
export type RichDocument = Record<string, unknown>;

export type BlogPost = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: RichDocument | null;
  contentHtml: string | null;
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  category: string | null;
  tags: string[];
  authorName: string;
  canonicalUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  status: BlogPostStatus;
  publishedAt: string | null;
  createdByAdminAddress: string;
  updatedByAdminAddress: string;
  createdAt: string;
  updatedAt: string;
};

export type BlogMediaAsset = {
  id: string;
  storageKey: string;
  publicUrl: string;
  contentType: string;
  sizeBytes: number;
  uploadedByAdminAddress: string;
  createdAt: string;
};

export type BlogComment = {
  id: string;
  postId: string;
  displayName: string;
  body: string;
  status: BlogCommentStatus;
  moderatedAt: string | null;
  moderatedByAdminAddress: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present on the admin moderation list only. */
  post?: { id: string; title: string; slug: string } | null;
};

export type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

export type Paged<T> = { items: T[]; pagination: Pagination };

/** Fields accepted by POST/PATCH /admin/blog/posts. */
export type BlogPostInput = {
  title?: string;
  slug?: string | null;
  excerpt?: string | null;
  content?: RichDocument | null;
  contentHtml?: string | null;
  coverImageUrl?: string | null;
  coverImageAlt?: string | null;
  category?: string | null;
  tags?: string[];
  authorName?: string | null;
  canonicalUrl?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
};

export type BlogPostListParams = {
  page?: number;
  limit?: number;
  status?: BlogPostStatus;
  search?: string;
};

export type BlogCommentListParams = {
  page?: number;
  limit?: number;
  status?: BlogCommentStatus;
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Drops empty values so the server never sees `search=undefined`. */
function query(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (!text) continue;
    search.set(key, text);
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

function jsonBody(input: BlogPostInput): RequestInit {
  return { body: JSON.stringify(input) };
}

/** A missing API route is a setup problem, not a deleted article. */
export class BlogEndpointError extends ApiError {
  constructor(path: string, serverMessages: string[] = []) {
    super(
      `The content management API is unavailable on this server (${path.split('?')[0]}). Check that the blog module is deployed and the API URL or /admin proxy points to the backend. This does not mean your content was deleted.`,
      404,
      serverMessages,
    );
    this.name = 'BlogEndpointError';
  }
}

/** Unwraps the `{ status, message, data }` envelope every blog route returns. */
async function get<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    return unwrapData<T>(await apiFetch<{ data?: T } | T>(path, init));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404 &&
      (error.serverMessages.some(message => /^Cannot (?:GET|POST|PATCH|DELETE)\b/i.test(message)) ||
        init.method && /^\/admin\/blog\/(posts|media)$/.test(path))) {
      throw new BlogEndpointError(path, error.serverMessages);
    }
    throw error;
  }
}

/**
 * Some older APIs return a 404 with an explicit "No posts found" message for
 * an empty collection. Accept that narrowly, but never hide a missing route,
 * a wrong proxy target or an ambiguous 404 as an apparently empty CMS.
 */
async function collection<T>(
  path: string,
  resource: 'posts' | 'media' | 'comments',
  params: { page?: number; limit?: number },
): Promise<Paged<T>> {
  try {
    return normalizePage<T>(await get<unknown>(path), params);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404 || error instanceof BlogEndpointError) throw error;
    const noun = resource === 'media' ? '(?:media(?: assets)?|assets|images)' : resource;
    const emptyMessage = new RegExp(`^(?:no (?:blog )?${noun}(?: (?:were|are))? (?:found|available)(?: for [^/]+)?|(?:blog )?${noun} not found)[.!]?$`, 'i');
    if (error.serverMessages.some(message => emptyMessage.test(message.trim()))) {
      return normalizePage<T>(null, params);
    }
    throw new BlogEndpointError(path, error.serverMessages);
  }
}

/* ------------------------------------------------------------------ */
/* Posts                                                               */
/* ------------------------------------------------------------------ */

export async function listPosts(params: BlogPostListParams = {}): Promise<Paged<BlogPost>> {
  return collection<BlogPost>(
    `/admin/blog/posts${query({ page: params.page, limit: params.limit, status: params.status, search: params.search })}`,
    'posts',
    params,
  );
}

export async function getPost(id: string): Promise<BlogPost> {
  return get<BlogPost>(`/admin/blog/posts/${encodeURIComponent(id)}`);
}

export async function createPost(input: BlogPostInput): Promise<BlogPost> {
  return get<BlogPost>('/admin/blog/posts', { method: 'POST', ...jsonBody(input) });
}

export async function updatePost(id: string, input: BlogPostInput): Promise<BlogPost> {
  return get<BlogPost>(`/admin/blog/posts/${encodeURIComponent(id)}`, { method: 'PATCH', ...jsonBody(input) });
}

/** Omit `publishAt` to go live immediately; a future value schedules the post. */
export async function publishPost(id: string, publishAt?: string): Promise<BlogPost> {
  return get<BlogPost>(`/admin/blog/posts/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
    body: JSON.stringify(publishAt ? { publishAt } : {}),
  });
}

export async function unpublishPost(id: string): Promise<BlogPost> {
  return get<BlogPost>(`/admin/blog/posts/${encodeURIComponent(id)}/draft`, { method: 'POST' });
}

export async function deletePost(id: string): Promise<void> {
  await apiFetch<unknown>(`/admin/blog/posts/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/* ------------------------------------------------------------------ */
/* Media                                                               */
/* ------------------------------------------------------------------ */

export async function listMedia(params: { page?: number; limit?: number } = {}): Promise<Paged<BlogMediaAsset>> {
  return collection<BlogMediaAsset>(`/admin/blog/media${query({ page: params.page, limit: params.limit })}`, 'media', params);
}

/**
 * Uploads one image. The server accepts a single `file` field and rejects
 * anything that is not a JPEG, PNG, GIF, or WebP under 5 MB.
 */
export async function uploadMedia(file: File | Blob, filename?: string): Promise<BlogMediaAsset> {
  const form = new FormData();
  // A File always has a name; a Blob (from an imported URL) needs one so the
  // multipart part is well formed.
  const name = filename || (file instanceof File ? file.name : 'image');
  form.append('file', file, name);
  return get<BlogMediaAsset>('/admin/blog/media', { method: 'POST', body: form });
}

/* ------------------------------------------------------------------ */
/* Comments                                                            */
/* ------------------------------------------------------------------ */

export async function listComments(params: BlogCommentListParams = {}): Promise<Paged<BlogComment>> {
  return collection<BlogComment>(
    `/admin/blog/comments${query({ page: params.page, limit: params.limit, status: params.status })}`,
    'comments',
    params,
  );
}

export async function moderateComment(id: string, status: BlogCommentStatus): Promise<BlogComment> {
  return get<BlogComment>(`/admin/blog/comments/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function deleteComment(id: string): Promise<void> {
  await apiFetch<unknown>(`/admin/blog/comments/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

/**
 * The server always returns `{ items, pagination }`, but a proxy or an older
 * deployment could hand back a bare array. Normalising here keeps every screen
 * able to render instead of crashing on `pagination.total`.
 */
function normalizePage<T>(value: unknown, requested: { page?: number; limit?: number } = {}): Paged<T> {
  if (Array.isArray(value)) {
    return {
      items: value as T[],
      pagination: {
        page: 1,
        limit: Math.max(value.length, 1),
        total: value.length,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    };
  }
  const page = (value ?? {}) as Partial<Paged<T>>;
  const items = Array.isArray(page.items) ? page.items : [];
  const pagination = page.pagination ?? ({} as Pagination);
  const limit = Number.isFinite(pagination.limit) && pagination.limit > 0 ? pagination.limit : requested.limit || items.length || 20;
  const total = Number.isFinite(pagination.total) ? pagination.total : items.length;
  return {
    items,
    pagination: {
      page: Number.isFinite(pagination.page) && pagination.page > 0 ? pagination.page : requested.page || 1,
      limit,
      total,
      totalPages: Math.max(1, Number.isFinite(pagination.totalPages)
        ? pagination.totalPages
        : Math.ceil(total / limit)),
      hasNextPage: Boolean(pagination.hasNextPage ?? false),
      hasPreviousPage: Boolean(pagination.hasPreviousPage ?? false),
    },
  };
}
