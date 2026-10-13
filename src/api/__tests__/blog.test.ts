import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiBase, isNetworkError } from '../../api';
import {
  BlogEndpointError,
  createPost,
  deleteComment,
  deletePost,
  getPost,
  listComments,
  listMedia,
  listPosts,
  moderateComment,
  publishPost,
  unpublishPost,
  updatePost,
  uploadMedia,
} from '../blog';

type FetchCall = { url: URL; method: string; body: unknown; headers: Headers };

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

let calls: FetchCall[] = [];

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn();
  responses.forEach((response, index) => {
    fetchMock.mockResolvedValueOnce(response);
    if (index === responses.length - 1) fetchMock.mockResolvedValue(response);
  });
  vi.stubGlobal('fetch', fetchMock);

  fetchMock.mock.calls.forEach(([url, init]) => {
    calls.push({
      url: new URL(String(url), window.location.origin),
      method: (init?.method as string) || 'GET',
      body: init?.body,
      headers: init?.headers as Headers,
    });
  });
  return fetchMock;
}

/** Records requests as they happen (the mock is consumed lazily). */
function recordingFetch(handler: (url: URL, init: RequestInit) => Response) {
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input), window.location.origin);
    calls.push({ url, method: init?.method || 'GET', body: init?.body, headers: init?.headers as Headers });
    return handler(url, init ?? {});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  calls = [];
  localStorage.clear();
  localStorage.setItem('rown.admin.access', 'access-token');
  localStorage.setItem('rown.admin.refresh', 'refresh-token');
});

describe('listPosts', () => {
  it('sends only the filters that are set and unwraps the envelope', async () => {
    recordingFetch(() =>
      jsonResponse({
        status: true,
        message: 'Blog posts retrieved',
        data: {
          items: [{ id: '1', title: 'Hello' }],
          pagination: { page: 2, limit: 10, total: 11, totalPages: 2, hasNextPage: true, hasPreviousPage: true },
        },
      }),
    );

    const page = await listPosts({ page: 2, limit: 10, status: 'DRAFT', search: '  hello  ' });

    expect(calls[0].url.pathname).toBe('/admin/blog/posts');
    expect(calls[0].url.searchParams.get('page')).toBe('2');
    expect(calls[0].url.searchParams.get('limit')).toBe('10');
    expect(calls[0].url.searchParams.get('status')).toBe('DRAFT');
    expect(calls[0].url.searchParams.get('search')).toBe('hello');
    expect(calls[0].headers.get('Authorization')).toBe('Bearer access-token');
    expect(page.items).toHaveLength(1);
    expect(page.pagination.hasNextPage).toBe(true);
  });

  it('omits empty parameters entirely', async () => {
    recordingFetch(() => jsonResponse({ data: { items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1, hasNextPage: false, hasPreviousPage: false } } }));
    await listPosts({ search: '   ', page: undefined });
    expect(calls[0].url.search).toBe('');
  });

  it('accepts a bare array from an older proxy and derives pagination', async () => {
    recordingFetch(() => jsonResponse({ data: [{ id: '1' }, { id: '2' }] }));
    const page = await listPosts({ page: 1, limit: 20 });
    expect(page.items).toHaveLength(2);
    expect(page.pagination.page).toBe(1);
    expect(page.pagination.total).toBe(2);
    expect(page.pagination.hasNextPage).toBe(false);
  });

  it('accepts an unwrapped payload', async () => {
    recordingFetch(() => jsonResponse({ items: [{ id: '1' }], pagination: { page: 1, limit: 20, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false } }));
    expect((await listPosts()).items).toHaveLength(1);
  });

  it('never returns undefined items', async () => {
    recordingFetch(() => jsonResponse({ data: null }));
    const page = await listPosts();
    expect(page.items).toEqual([]);
    expect(page.pagination.total).toBe(0);
  });
});

describe('post writes', () => {
  it('creates a draft with a JSON body', async () => {
    recordingFetch(() => jsonResponse({ status: true, message: 'Blog draft created', data: { id: 'new', slug: 'hello' } }));
    const post = await createPost({ title: 'Hello', slug: null, tags: ['a'] });

    expect(calls[0].method).toBe('POST');
    expect(calls[0].url.pathname).toBe('/admin/blog/posts');
    expect(calls[0].headers.get('Content-Type')).toBe('application/json');
    expect(JSON.parse(String(calls[0].body))).toEqual({ title: 'Hello', slug: null, tags: ['a'] });
    expect(post.slug).toBe('hello');
  });

  it('patches only the fields given', async () => {
    recordingFetch(() => jsonResponse({ data: { id: '1' } }));
    await updatePost('1', { title: 'Renamed' });
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].url.pathname).toBe('/admin/blog/posts/1');
    expect(JSON.parse(String(calls[0].body))).toEqual({ title: 'Renamed' });
  });

  it('publishes immediately with an empty body', async () => {
    recordingFetch(() => jsonResponse({ data: { id: '1', status: 'PUBLISHED' } }));
    await publishPost('1');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url.pathname).toBe('/admin/blog/posts/1/publish');
    expect(JSON.parse(String(calls[0].body))).toEqual({});
  });

  it('schedules with a publishAt timestamp', async () => {
    recordingFetch(() => jsonResponse({ data: { id: '1' } }));
    await publishPost('1', '2026-11-01T09:00:00.000Z');
    expect(JSON.parse(String(calls[0].body))).toEqual({ publishAt: '2026-11-01T09:00:00.000Z' });
  });

  it('moves a post back to draft and deletes it', async () => {
    recordingFetch(url => jsonResponse({ data: { id: url.pathname.includes('draft') ? '1' : { id: '1', slug: 'hello' } } }));
    await unpublishPost('1');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url.pathname).toBe('/admin/blog/posts/1/draft');

    await deletePost('1');
    expect(calls[1].method).toBe('DELETE');
    expect(calls[1].url.pathname).toBe('/admin/blog/posts/1');
  });

  it('URL-encodes the post id', async () => {
    recordingFetch(() => jsonResponse({ data: { id: 'x' } }));
    await getPost('a/b c');
    expect(calls[0].url.pathname).toBe('/admin/blog/posts/a%2Fb%20c');
  });
});

describe('media', () => {
  it('lists assets with pagination', async () => {
    recordingFetch(() => jsonResponse({ data: { items: [{ id: 'm1' }], pagination: { page: 1, limit: 24, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false } } }));
    const page = await listMedia({ page: 1, limit: 24 });
    expect(calls[0].url.pathname).toBe('/admin/blog/media');
    expect(calls[0].url.searchParams.get('limit')).toBe('24');
    expect(page.items[0].id).toBe('m1');
  });

  it('uploads a multipart body with a single "file" field and no forced content type', async () => {
    recordingFetch(() => jsonResponse({ data: { id: 'm1', publicUrl: 'https://cdn.rown.xyz/a.png' } }, 201));
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'cover.png', { type: 'image/png' });
    const asset = await uploadMedia(file);

    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toBeInstanceOf(FormData);
    const form = calls[0].body as FormData;
    expect([...form.keys()]).toEqual(['file']);
    expect((form.get('file') as File).name).toBe('cover.png');
    // The boundary lives in the browser's own Content-Type; setting JSON here would break it.
    expect(calls[0].headers.get('Content-Type')).toBeNull();
    expect(asset.publicUrl).toBe('https://cdn.rown.xyz/a.png');
  });

  it('names a bare Blob so the part stays well formed', async () => {
    recordingFetch(() => jsonResponse({ data: { id: 'm2' } }, 201));
    await uploadMedia(new Blob([new Uint8Array([1, 2, 3])]), 'imported.png');
    expect(((calls[0].body as FormData).get('file') as File).name).toBe('imported.png');
  });
});

describe('comments', () => {
  it('filters by moderation status', async () => {
    recordingFetch(() => jsonResponse({ data: { items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1, hasNextPage: false, hasPreviousPage: false } } }));
    await listComments({ status: 'PENDING', page: 3 });
    expect(calls[0].url.pathname).toBe('/admin/blog/comments');
    expect(calls[0].url.searchParams.get('status')).toBe('PENDING');
    expect(calls[0].url.searchParams.get('page')).toBe('3');
  });

  it('moderates and deletes', async () => {
    recordingFetch(() => jsonResponse({ data: { id: 'c1', status: 'APPROVED' } }));
    await moderateComment('c1', 'APPROVED');
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].url.pathname).toBe('/admin/blog/comments/c1');
    expect(JSON.parse(String(calls[0].body))).toEqual({ status: 'APPROVED' });

    await deleteComment('c1');
    expect(calls[1].method).toBe('DELETE');
  });
});

describe('errors', () => {
  it('surfaces a duplicate slug as a readable 409 and keeps the server wording', async () => {
    recordingFetch(() => jsonResponse({ status: false, message: 'A blog post with this slug already exists', error: 'Conflict' }, 409));
    const error = await createPost({ title: 'x', slug: 'taken' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).message.toLowerCase()).toContain('slug');
    expect((error as ApiError).serverMessages).toEqual(['A blog post with this slug already exists']);
  });

  it('passes Nest validation arrays through as field messages', async () => {
    recordingFetch(() =>
      jsonResponse({ statusCode: 400, message: ['title must be shorter than or equal to 200 characters', 'tags must contain no more than 20 elements'], error: 'Bad Request' }, 400),
    );
    const error = (await createPost({ title: 'x' }).catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(400);
    expect(error.serverMessages).toHaveLength(2);
    expect(error.message).toContain('title must be shorter');
    expect(error.message).toContain('tags must contain no more than 20 elements');
    expect(error.message).toContain(' · ');
  });

  it('explains an unconfigured media store (503) and rate limits (429)', async () => {
    recordingFetch(() => jsonResponse({ status: false, message: 'Blog image uploads are not configured.' }, 503));
    const storage = (await uploadMedia(new File([new Uint8Array([1])], 'a.png')).catch((e: unknown) => e)) as ApiError;
    expect(storage.status).toBe(503);
    expect(storage.message.length).toBeGreaterThan(10);

    calls = [];
    recordingFetch(() => jsonResponse({ message: 'Too many requests' }, 429));
    const throttled = (await listPosts().catch((e: unknown) => e)) as ApiError;
    expect(throttled.status).toBe(429);
    expect(throttled.message.toLowerCase()).toMatch(/many requests|too many|wait|slow/);
  });

  it('turns a network failure into status 0 with an offline message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const error = (await listPosts().catch((e: unknown) => e)) as ApiError;
    expect(isNetworkError(error)).toBe(true);
    expect(error.message.toLowerCase()).toMatch(/internet|reach|offline|connection/);
  });

  it('refreshes the session once after a 401 and retries', async () => {
    let attempt = 0;
    recordingFetch(url => {
      if (url.pathname === '/admin/auth/refresh') {
        return jsonResponse({ data: { accessToken: 'new-access', refreshToken: 'new-refresh' } });
      }
      attempt += 1;
      return attempt === 1
        ? jsonResponse({ message: 'Token expired' }, 401)
        : jsonResponse({ data: { items: [{ id: 'after-refresh' }], pagination: { page: 1, limit: 20, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false } } });
    });

    const page = await listPosts();
    expect(page.items[0].id).toBe('after-refresh');
    expect(localStorage.getItem('rown.admin.access')).toBe('new-access');
    expect(calls.map(call => call.url.pathname)).toEqual(['/admin/blog/posts', '/admin/auth/refresh', '/admin/blog/posts']);
  });

  it('clears the session when the refresh itself fails', async () => {
    recordingFetch(url =>
      url.pathname === '/admin/auth/refresh'
        ? jsonResponse({ message: 'Refresh token expired' }, 401)
        : jsonResponse({ message: 'Token expired' }, 401),
    );
    const error = (await listPosts().catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(401);
    expect(error.message.toLowerCase()).toMatch(/sign in again/);
    expect(localStorage.getItem('rown.admin.access')).toBeNull();
  });

  it('tolerates a non-JSON error body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>gateway timeout</html>', { status: 504 })));
    const error = (await listPosts().catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(504);
    expect(error.serverMessages).toEqual([]);
    expect(error.message.length).toBeGreaterThan(10);
  });
});


describe('empty collections versus missing CMS endpoints', () => {
  it('uses relative API paths by default so a remote browser never calls its own localhost', async () => {
    const fetchMock = recordingFetch(() => jsonResponse({ data: [] }));
    await listPosts();
    expect(apiBase).toBe('');
    expect(fetchMock.mock.calls[0][0]).toBe('/admin/blog/posts');
  });

  it('normalizes a valid empty post list even when the backend reports zero pages', async () => {
    recordingFetch(() => jsonResponse({ data: { items: [], pagination: { page: 1, limit: 12, total: 0, totalPages: 0 } } }));
    const result = await listPosts({ limit: 12 });
    expect(result.items).toEqual([]);
    expect(result.pagination.totalPages).toBe(1);
    expect(result.pagination.total).toBe(0);
  });

  it('accepts a 204 empty collection and preserves its requested paging size', async () => {
    recordingFetch(() => new Response(null, { status: 204 }));
    const result = await listMedia({ page: 1, limit: 24 });
    expect(result.items).toEqual([]);
    expect(result.pagination).toMatchObject({ page: 1, limit: 24, total: 0, totalPages: 1 });
  });

  it.each([
    ['posts', listPosts, 'No blog posts found'],
    ['media', listMedia, 'No media assets found'],
    ['comments', listComments, 'Blog comments not found'],
  ] as const)('handles an explicit empty-collection 404 for %s without a deleted-content error', async (_resource, list, message) => {
    recordingFetch(() => jsonResponse({ statusCode: 404, message }, 404));
    const result = await list({ page: 1, limit: 12 });
    expect(result.items).toEqual([]);
    expect(result.pagination).toMatchObject({ page: 1, limit: 12, total: 0, totalPages: 1 });
  });

  it('explains a missing GET route instead of treating it as an empty blog', async () => {
    recordingFetch(() => jsonResponse({ statusCode: 404, message: 'Cannot GET /admin/blog/posts?limit=12', error: 'Not Found' }, 404));
    const error = await listPosts({ limit: 12 }).catch((error: unknown) => error) as BlogEndpointError;
    expect(error).toBeInstanceOf(BlogEndpointError);
    expect(error.status).toBe(404);
    expect(error.message).toMatch(/content management API is unavailable/i);
    expect(error.message).toMatch(/blog module|proxy/);
    expect(error.serverMessages).toEqual(['Cannot GET /admin/blog/posts?limit=12']);
  });

  it('does not silently turn an ambiguous or HTML 404 into zero posts', async () => {
    recordingFetch(() => new Response('<html>Not Found</html>', { status: 404, headers: { 'Content-Type': 'text/html' } }));
    const error = await listPosts().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(BlogEndpointError);
  });

  it('does not confuse an unavailable create endpoint with a post that was deleted', async () => {
    recordingFetch(() => jsonResponse({ message: 'Not Found' }, 404));
    await expect(createPost({ title: 'First tutorial' })).rejects.toBeInstanceOf(BlogEndpointError);
  });

  it('distinguishes a missing individual post from a missing endpoint', async () => {
    recordingFetch(() => jsonResponse({ message: 'Blog post not found' }, 404));
    const removed = await getPost('missing-id').catch((error: unknown) => error);
    expect(removed).toBeInstanceOf(ApiError);
    expect(removed).not.toBeInstanceOf(BlogEndpointError);
    recordingFetch(() => jsonResponse({ message: 'Cannot GET /admin/blog/posts/missing-id' }, 404));
    await expect(getPost('missing-id')).rejects.toBeInstanceOf(BlogEndpointError);
  });

  it('reports a misrouted SPA response rather than displaying a fake empty CMS', async () => {
    recordingFetch(() => new Response('<html>Admin console</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    await expect(listPosts()).rejects.toThrow(/web page instead of API data/);
  });
});
