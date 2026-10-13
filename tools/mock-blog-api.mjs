/**
 * Local mock of the Rown backend, for developing the admin console without the
 * real API (and without a wallet extension).
 *
 *   node tools/mock-blog-api.mjs                     # listens on 0.0.0.0:3000
 *   MOCK_BLOG_MEDIA=off node tools/mock-blog-api.mjs # simulate "storage not configured" (503)
 *   MOCK_BLOG_EMPTY=1 node tools/mock-blog-api.mjs   # start with no posts, media or comments
 *
 * It implements the admin auth handshake plus every /admin/blog route from the
 * backend's docs/blog-module.md, with in-memory data, the same envelope
 * ({ status, message, data }), and the same failure shapes the console has to
 * handle: 400 with an array of validation messages, 409 on a duplicate slug,
 * 429 above 15 uploads/minute, 404 for missing rows and 503 when media storage
 * is not configured. Uploaded bytes are served back from /mock-media so images
 * really render.
 *
 * Dev scaffolding only — the console never imports it. Pair it with
 * VITE_MOCK_WALLET=1 (see src/dev/mock-wallet.ts) to click through the CMS.
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MEDIA_ENABLED = (process.env.MOCK_BLOG_MEDIA || 'on').toLowerCase() !== 'off';
/** Relative by default, so the browser resolves it against the dev-server origin. */
const MEDIA_BASE = process.env.MOCK_MEDIA_BASE_URL || '/mock-media';

const ADMIN = {
  address: '0x1111111111111111111111111111111111111111',
  label: 'Mock Operator',
  role: 'SUPER_ADMIN',
};

/* ------------------------------------------------------------------ */
/* Seed data                                                           */
/* ------------------------------------------------------------------ */

const mediaStore = new Map();

const placeholder = (label, from, to) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
    </linearGradient></defs>
    <rect width="1200" height="675" fill="url(#g)"/>
    <text x="60" y="600" font-family="system-ui, sans-serif" font-size="54" font-weight="700" fill="rgba(255,255,255,.92)">${label}</text>
  </svg>`;

function storeMedia(key, body, contentType) {
  mediaStore.set(key, { body: Buffer.from(body), contentType });
  return `${MEDIA_BASE}/${key}`;
}

const coverA = storeMedia('seed-launch.svg', placeholder('Rown Pay launches', '#ff9700', '#c2560a'), 'image/svg+xml');
const coverB = storeMedia('seed-security.svg', placeholder('Security first', '#191a1c', '#4a4d55'), 'image/svg+xml');

const now = Date.now();
const iso = offsetMs => new Date(now + offsetMs).toISOString();
const HOUR = 3_600_000;

/** Mirrors the backend slugifier, so generated slugs match production. */
function slugify(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180)
    .replace(/-+$/g, '');
}

const posts = [
  {
    id: randomUUID(),
    title: 'Rown Pay is live in three new countries',
    slug: 'rown-pay-live-in-three-new-countries',
    excerpt: 'Dollar cards, instant settlement and local payouts — now available in Kenya, Ghana and South Africa.',
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Today we are opening Rown Pay to three new markets.' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'What changes' }] },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Local bank payouts' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Dollar cards in minutes' }] }] },
          ],
        },
      ],
    },
    contentHtml:
      '<p>Today we are opening Rown Pay to three new markets.</p><h2>What changes</h2><ul><li><p>Local bank payouts</p></li><li><p>Dollar cards in minutes</p></li></ul>',
    coverImageUrl: coverA,
    coverImageAlt: 'Rown Pay launch graphic',
    category: 'Product updates',
    tags: ['product', 'payments', 'expansion'],
    authorName: 'Rown Team',
    canonicalUrl: null,
    seoTitle: 'Rown Pay is live in three new countries | Rown',
    seoDescription: 'Dollar cards, instant settlement and local payouts are now available in Kenya, Ghana and South Africa.',
    status: 'PUBLISHED',
    publishedAt: iso(-26 * HOUR),
    createdByAdminAddress: ADMIN.address,
    updatedByAdminAddress: ADMIN.address,
    createdAt: iso(-30 * HOUR),
    updatedAt: iso(-26 * HOUR),
  },
  {
    id: randomUUID(),
    title: 'How we keep your keys safe',
    slug: 'how-we-keep-your-keys-safe',
    excerpt: 'A plain-English tour of the guardian model, device binding and recovery.',
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Security is a product feature.' }] }] },
    contentHtml:
      '<p>Security is a product feature.</p><blockquote><p>If a wallet is hard to recover, it is easy to lose.</p></blockquote>',
    coverImageUrl: coverB,
    coverImageAlt: 'Security illustration',
    category: 'Security',
    tags: ['security'],
    authorName: 'Rown Team',
    canonicalUrl: null,
    seoTitle: null,
    seoDescription: null,
    status: 'PUBLISHED',
    publishedAt: iso(52 * HOUR), // scheduled: published with a future date
    createdByAdminAddress: ADMIN.address,
    updatedByAdminAddress: ADMIN.address,
    createdAt: iso(-5 * HOUR),
    updatedAt: iso(-2 * HOUR),
  },
  {
    id: randomUUID(),
    title: 'Draft: Q4 roadmap notes',
    slug: 'draft-q4-roadmap-notes',
    excerpt: null,
    content: null,
    contentHtml: '<p>Rough notes for the next quarter.</p>',
    coverImageUrl: null,
    coverImageAlt: null,
    category: null,
    tags: [],
    authorName: 'Rown Team',
    canonicalUrl: null,
    seoTitle: null,
    seoDescription: null,
    status: 'DRAFT',
    publishedAt: null,
    createdByAdminAddress: ADMIN.address,
    updatedByAdminAddress: ADMIN.address,
    createdAt: iso(-40 * 60_000),
    updatedAt: iso(-40 * 60_000),
  },
  {
    id: randomUUID(),
    title: 'Draft: nothing written yet',
    slug: 'draft-nothing-written-yet',
    excerpt: null,
    content: null,
    contentHtml: null,
    coverImageUrl: null,
    coverImageAlt: null,
    category: null,
    tags: [],
    authorName: 'Rown Team',
    canonicalUrl: null,
    seoTitle: null,
    seoDescription: null,
    status: 'DRAFT',
    publishedAt: null,
    createdByAdminAddress: ADMIN.address,
    updatedByAdminAddress: ADMIN.address,
    createdAt: iso(-10 * 60_000),
    updatedAt: iso(-10 * 60_000),
  },
];

const comments = [
  {
    id: randomUUID(),
    postId: posts[0].id,
    displayName: 'Adaeze',
    body: 'Finally! Does this work with a Rown dollar card in Ghana from day one?',
    status: 'PENDING',
    moderatedAt: null,
    moderatedByAdminAddress: null,
    createdAt: iso(-3 * HOUR),
    updatedAt: iso(-3 * HOUR),
  },
  {
    id: randomUUID(),
    postId: posts[0].id,
    displayName: 'Anonymous',
    body: 'Buy cheap crypto here >>> http://spam.example.com <<< message me on telegram',
    status: 'PENDING',
    moderatedAt: null,
    moderatedByAdminAddress: null,
    createdAt: iso(-90 * 60_000),
    updatedAt: iso(-90 * 60_000),
  },
  {
    id: randomUUID(),
    postId: posts[1].id,
    displayName: 'Tunde',
    body: 'The guardian explanation is the clearest I have read. Thank you.',
    status: 'APPROVED',
    moderatedAt: iso(-1 * HOUR),
    moderatedByAdminAddress: ADMIN.address,
    createdAt: iso(-20 * HOUR),
    updatedAt: iso(-1 * HOUR),
  },
  {
    id: randomUUID(),
    postId: posts[1].id,
    displayName: 'Anonymous',
    body: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    status: 'REJECTED',
    moderatedAt: iso(-30 * 60_000),
    moderatedByAdminAddress: ADMIN.address,
    createdAt: iso(-4 * HOUR),
    updatedAt: iso(-30 * 60_000),
  },
];

const mediaAssets = [
  {
    id: randomUUID(),
    storageKey: 'blog/2026-10/seed-launch.svg',
    publicUrl: coverA,
    contentType: 'image/svg+xml',
    sizeBytes: 700,
    uploadedByAdminAddress: ADMIN.address,
    createdAt: iso(-28 * HOUR),
  },
  {
    id: randomUUID(),
    storageKey: 'blog/2026-10/seed-security.svg',
    publicUrl: coverB,
    contentType: 'image/svg+xml',
    sizeBytes: 690,
    uploadedByAdminAddress: ADMIN.address,
    createdAt: iso(-6 * HOUR),
  },
];

// First-use testing must not rely on seeded content existing.
if (process.env.MOCK_BLOG_EMPTY === '1') {
  posts.length = 0;
  comments.length = 0;
  mediaAssets.length = 0;
  mediaStore.clear();
}

/* ------------------------------------------------------------------ */
/* HTTP plumbing                                                       */
/* ------------------------------------------------------------------ */

function send(res, status, payload, headers = {}) {
  const body = typeof payload === 'string' || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': typeof payload === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

const ok = (res, message, data, status = 200) => send(res, status, { status: true, message, data });
const fail = (res, status, message) => send(res, status, { status: false, message, error: 'Error' });

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 12 * 1024 * 1024) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function jsonOf(buffer) {
  if (!buffer.length) return {};
  try {
    return JSON.parse(buffer.toString());
  } catch {
    return null;
  }
}

function paginate(items, page, limit) {
  const start = (page - 1) * limit;
  return {
    items: items.slice(start, start + limit),
    pagination: {
      page,
      limit,
      total: items.length,
      totalPages: Math.max(1, Math.ceil(items.length / limit)),
      hasNextPage: start + limit < items.length,
      hasPreviousPage: page > 1,
    },
  };
}

function intParam(value, fallback, max) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

/** Minimal multipart reader: enough for a single `file` part. */
function readMultipartFile(buffer, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary[1] || boundary[2]}`);
  let start = buffer.indexOf(delimiter);
  if (start < 0) return null;
  start += delimiter.length;
  if (buffer.subarray(start, start + 2).toString() === '\r\n') start += 2;
  let end = buffer.indexOf(delimiter, start);
  if (end < 0) end = buffer.length;
  const part = buffer.subarray(start, end);
  const headerEnd = part.indexOf('\r\n\r\n');
  if (headerEnd < 0) return null;
  const headers = part.subarray(0, headerEnd).toString('utf8');
  let body = part.subarray(headerEnd + 4);
  if (body.subarray(-2).toString() === '\r\n') body = body.subarray(0, -2);
  return {
    name: /name="([^"]*)"/i.exec(headers)?.[1] ?? '',
    filename: /filename="([^"]*)"/i.exec(headers)?.[1] ?? '',
    type: /content-type:\s*([^\r\n;]+)/i.exec(headers)?.[1]?.trim() ?? '',
    body,
  };
}

/** The API sniffs magic bytes, so a renamed file is still caught. */
function sniffImage(bytes, declaredType = '') {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return { ext: 'png', type: 'image/png' };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  const head = bytes.subarray(0, 6).toString('ascii');
  if (head === 'GIF87a' || head === 'GIF89a') return { ext: 'gif', type: 'image/gif' };
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP')
    return { ext: 'webp', type: 'image/webp' };
  if (declaredType.startsWith('image/')) return { ext: declaredType.split('/')[1] || 'bin', type: declaredType };
  return null;
}

const uploadTimes = [];

/* ------------------------------------------------------------------ */
/* Validation (the same rules, and the same message shapes)            */
/* ------------------------------------------------------------------ */

function normalizePostInput(body, { partial = false } = {}) {
  const errors = [];
  const out = {};

  const text = (value, max, field) => {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') {
      errors.push(`${field} must be a string`);
      return null;
    }
    const clean = value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
    if (clean.length > max) errors.push(`${field} must be shorter than or equal to ${max} characters`);
    return clean || null;
  };

  if (!partial || body.title !== undefined) {
    const title = text(body.title, 200, 'title');
    if (!title && !partial) errors.push('title should not be empty');
    if (title) out.title = title;
  }
  if (body.slug !== undefined) {
    const slug = text(body.slug, 180, 'slug');
    if (slug && !/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/.test(slug)) {
      errors.push('slug may contain only letters, numbers, and hyphens');
    } else if (slug) {
      out.slug = slug;
    }
  }
  for (const [field, max] of [
    ['excerpt', 500],
    ['coverImageAlt', 250],
    ['category', 80],
    ['authorName', 120],
    ['seoTitle', 200],
    ['seoDescription', 320],
  ]) {
    if (body[field] !== undefined) out[field] = text(body[field], max, field);
  }
  for (const field of ['coverImageUrl', 'canonicalUrl']) {
    if (body[field] === undefined) continue;
    const value = text(body[field], 2048, field);
    if (value && !value.startsWith('/') && !/^https:\/\//i.test(value)) {
      errors.push(`${field} must be a valid HTTPS URL`);
      continue;
    }
    out[field] = value;
  }
  if (body.content !== undefined) out.content = body.content && typeof body.content === 'object' ? body.content : null;
  if (body.contentHtml !== undefined) out.contentHtml = typeof body.contentHtml === 'string' ? body.contentHtml : null;
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) errors.push('tags must be an array');
    else if (body.tags.length > 20) errors.push('tags must contain no more than 20 elements');
    else out.tags = [...new Set(body.tags.map(tag => String(tag).trim().toLowerCase()).filter(Boolean))];
  }
  return { out, errors };
}

/** The publish guard: is there anything a reader would actually see? */
function hasContent(post) {
  if (post.contentHtml && post.contentHtml.trim()) return true;
  const walk = node => {
    if (Array.isArray(node)) return node.some(walk);
    if (!node || typeof node !== 'object') return false;
    if (typeof node.text === 'string' && node.text.trim()) return true;
    if (typeof node.html === 'string' && node.html.trim()) return true;
    return walk(node.content) || walk(node.children);
  };
  return walk(post.content);
}

function uniqueSlug(base, ignoreId) {
  const safe = String(base).slice(0, 180).replace(/-+$/g, '') || 'post';
  let candidate = safe;
  let suffix = 2;
  while (posts.some(post => post.slug === candidate && post.id !== ignoreId)) {
    const part = `-${suffix++}`;
    candidate = `${safe.slice(0, 180 - part.length)}${part}`;
  }
  return candidate;
}

function withPostMeta(comment) {
  const post = posts.find(item => item.id === comment.postId);
  return post ? { ...comment, post: { id: post.id, title: post.title, slug: post.slug } } : comment;
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method || 'GET';

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    });
    res.end();
    return;
  }

  try {
    /* Serve uploaded (and seeded) images back to the browser. */
    if (path.startsWith('/mock-media/')) {
      const key = decodeURIComponent(path.slice('/mock-media/'.length));
      const stored = mediaStore.get(key);
      if (!stored) return send(res, 404, 'not found');
      return send(res, 200, stored.body, { 'Content-Type': stored.contentType, 'Cache-Control': 'public, max-age=60' });
    }

    /* ---- auth ---- */
    if (path === '/admin/auth/nonce' && method === 'POST') {
      const body = jsonOf(await readBody(req)) || {};
      return ok(res, 'Sign this message to continue', {
        message: `Sign in to the Rown admin console as ${body.address || 'an operator'}.\n\nNonce: ${randomUUID()}`,
      });
    }
    if (path === '/admin/auth/verify' && method === 'POST') {
      await readBody(req);
      const token = Buffer.from(JSON.stringify({ ...ADMIN, iat: Date.now() })).toString('base64url');
      return ok(res, 'Signed in', { accessToken: `mock.${token}`, refreshToken: `mock-refresh.${token}`, admin: ADMIN });
    }
    if (path === '/admin/auth/me') return ok(res, 'Operator profile', ADMIN);
    if (path === '/admin/auth/refresh' && method === 'POST') {
      const token = Buffer.from(JSON.stringify({ ...ADMIN, iat: Date.now() })).toString('base64url');
      return ok(res, 'Session refreshed', { accessToken: `mock.${token}`, refreshToken: `mock-refresh.${token}` });
    }
    if (path === '/admin/auth/logout' && method === 'POST') return ok(res, 'Signed out', { ok: true });

    if (path.startsWith('/admin/blog') && !(req.headers.authorization || '').startsWith('Bearer mock.')) {
      return fail(res, 401, 'Missing or invalid admin token');
    }

    /* ---- posts ---- */
    if (path === '/admin/blog/posts' && method === 'GET') {
      const status = url.searchParams.get('status');
      const search = (url.searchParams.get('search') || '').trim().toLowerCase();
      let items = [...posts].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      if (status === 'DRAFT' || status === 'PUBLISHED') items = items.filter(post => post.status === status);
      if (search) {
        items = items.filter(post => `${post.title} ${post.slug} ${post.excerpt ?? ''}`.toLowerCase().includes(search));
      }
      return ok(
        res,
        'Blog posts retrieved',
        paginate(
          items,
          intParam(url.searchParams.get('page'), 1, 100_000),
          intParam(url.searchParams.get('limit'), 20, 100),
        ),
      );
    }

    if (path === '/admin/blog/posts' && method === 'POST') {
      const body = jsonOf(await readBody(req));
      if (body === null) return fail(res, 400, ['Body must be valid JSON']);
      const { out, errors } = normalizePostInput(body);
      if (errors.length) return fail(res, 400, errors);

      /* An explicit slug must be unique; a generated one gets a suffix. */
      let slug;
      if (out.slug) {
        if (posts.some(item => item.slug === out.slug)) {
          return fail(res, 409, 'A blog post with this slug already exists');
        }
        slug = out.slug;
      } else {
        slug = uniqueSlug(slugify(out.title || `post-${randomUUID().slice(0, 8)}`));
      }

      const post = {
        id: randomUUID(),
        title: out.title,
        slug,
        excerpt: out.excerpt ?? null,
        content: out.content ?? null,
        contentHtml: out.contentHtml ?? null,
        coverImageUrl: out.coverImageUrl ?? null,
        coverImageAlt: out.coverImageAlt ?? null,
        category: out.category ?? null,
        tags: out.tags ?? [],
        authorName: out.authorName || ADMIN.label || 'Rown Team',
        canonicalUrl: out.canonicalUrl ?? null,
        seoTitle: out.seoTitle ?? null,
        seoDescription: out.seoDescription ?? null,
        status: 'DRAFT',
        publishedAt: null,
        createdByAdminAddress: ADMIN.address,
        updatedByAdminAddress: ADMIN.address,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      posts.unshift(post);
      return ok(res, 'Blog draft created', post, 201);
    }

    const postMatch = /^\/admin\/blog\/posts\/([^/]+)(\/publish|\/draft)?$/.exec(path);
    if (postMatch) {
      const id = postMatch[1];
      const action = postMatch[2];
      const post = posts.find(item => item.id === id);
      if (!post) return fail(res, 404, 'Blog post not found');

      if (!action && method === 'GET') return ok(res, 'Blog post retrieved', post);

      if (!action && method === 'PATCH') {
        const body = jsonOf(await readBody(req));
        if (body === null) return fail(res, 400, ['Body must be valid JSON']);
        if (!Object.keys(body).length) return fail(res, 400, ['Provide at least one field to update']);
        const { out, errors } = normalizePostInput(body, { partial: true });
        if (errors.length) return fail(res, 400, errors);
        if (out.slug && out.slug !== post.slug && posts.some(other => other.slug === out.slug && other.id !== post.id)) {
          return fail(res, 409, 'A blog post with this slug already exists');
        }
        Object.assign(post, out, { updatedByAdminAddress: ADMIN.address, updatedAt: new Date().toISOString() });
        return ok(res, 'Blog post updated', post);
      }

      if (action === '/publish' && method === 'POST') {
        if (!hasContent(post)) return fail(res, 400, 'Add rich text or HTML content before publishing this post');
        const body = jsonOf(await readBody(req)) ?? {};
        if (body.publishAt && Number.isNaN(new Date(body.publishAt).getTime())) {
          return fail(res, 400, ['publishAt must be a valid ISO-8601 date']);
        }
        post.status = 'PUBLISHED';
        post.publishedAt = body.publishAt ? new Date(body.publishAt).toISOString() : new Date().toISOString();
        post.updatedByAdminAddress = ADMIN.address;
        post.updatedAt = new Date().toISOString();
        return ok(res, 'Blog post published', post);
      }

      if (action === '/draft' && method === 'POST') {
        post.status = 'DRAFT';
        post.publishedAt = null;
        post.updatedByAdminAddress = ADMIN.address;
        post.updatedAt = new Date().toISOString();
        return ok(res, 'Blog post moved to draft', post);
      }

      if (!action && method === 'DELETE') {
        posts.splice(posts.findIndex(item => item.id === id), 1);
        for (let i = comments.length - 1; i >= 0; i -= 1) if (comments[i].postId === id) comments.splice(i, 1);
        return ok(res, 'Blog post deleted', { id, slug: post.slug });
      }
    }

    /* ---- media ---- */
    if (path === '/admin/blog/media' && method === 'GET') {
      return ok(
        res,
        'Blog media retrieved',
        paginate(
          [...mediaAssets].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
          intParam(url.searchParams.get('page'), 1, 100_000),
          intParam(url.searchParams.get('limit'), 20, 100),
        ),
      );
    }

    if (path === '/admin/blog/media' && method === 'POST') {
      if (!MEDIA_ENABLED) {
        return fail(res, 503, 'Blog image uploads are not configured. Set the BLOG_MEDIA_* storage settings.');
      }
      const file = readMultipartFile(await readBody(req), req.headers['content-type'] || '');
      if (!file || file.name !== 'file' || !file.body.length) {
        return fail(res, 400, ['Upload a JPEG, PNG, GIF, or WebP image in the file field']);
      }
      if (file.body.length > 5 * 1024 * 1024) return fail(res, 400, ['Image must be 5 MB or smaller']);

      const kind = sniffImage(file.body, file.type);
      if (!kind) return fail(res, 400, ['Only valid JPEG, PNG, GIF, and WebP images can be uploaded']);

      uploadTimes.push(Date.now());
      while (uploadTimes.length && uploadTimes[0] < Date.now() - 60_000) uploadTimes.shift();
      if (uploadTimes.length > 15) return fail(res, 429, 'Too many uploads. Please wait a minute and try again.');

      const key = `blog/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${kind.ext}`;
      mediaStore.set(key, { body: file.body, contentType: kind.type });
      const asset = {
        id: randomUUID(),
        storageKey: key,
        publicUrl: `${MEDIA_BASE}/${key}`,
        contentType: kind.type,
        sizeBytes: file.body.length,
        uploadedByAdminAddress: ADMIN.address,
        createdAt: new Date().toISOString(),
      };
      mediaAssets.unshift(asset);
      return ok(res, 'Blog image uploaded', asset, 201);
    }

    /* ---- comments ---- */
    if (path === '/admin/blog/comments' && method === 'GET') {
      const status = url.searchParams.get('status');
      let items = [...comments]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map(withPostMeta);
      if (status) items = items.filter(comment => comment.status === status);
      return ok(
        res,
        'Blog comments retrieved',
        paginate(
          items,
          intParam(url.searchParams.get('page'), 1, 100_000),
          intParam(url.searchParams.get('limit'), 20, 100),
        ),
      );
    }

    const commentMatch = /^\/admin\/blog\/comments\/([^/]+)$/.exec(path);
    if (commentMatch) {
      const comment = comments.find(item => item.id === commentMatch[1]);
      if (!comment) return fail(res, 404, 'Blog comment not found');

      if (method === 'PATCH') {
        const body = jsonOf(await readBody(req)) ?? {};
        if (!['PENDING', 'APPROVED', 'REJECTED'].includes(body.status)) {
          return fail(res, 400, ['status must be one of the following values: PENDING, APPROVED, REJECTED']);
        }
        comment.status = body.status;
        comment.moderatedAt = body.status === 'PENDING' ? null : new Date().toISOString();
        comment.moderatedByAdminAddress = body.status === 'PENDING' ? null : ADMIN.address;
        comment.updatedAt = new Date().toISOString();
        return ok(res, 'Blog comment moderated', withPostMeta(comment));
      }
      if (method === 'DELETE') {
        comments.splice(comments.findIndex(item => item.id === comment.id), 1);
        return ok(res, 'Blog comment deleted', { id: comment.id });
      }
    }

    /* The analytics screens need the real backend; say so instead of 404ing. */
    if (path.startsWith('/admin/analytics') || path.startsWith('/admin/transactions')) {
      return fail(
        res,
        501,
        'The mock backend only implements auth and the blog module. Point VITE_DEV_API_PROXY at the real API for analytics.',
      );
    }

    return fail(res, 404, `No mock handler for ${method} ${path}`);
  } catch (error) {
    if (String(error?.message || '').includes('payload too large')) {
      return fail(res, 413, 'Image must be 5 MB or smaller');
    }
    return fail(res, 500, `Mock backend error: ${error?.message || error}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[mock-api] listening on http://${HOST}:${PORT}`);
  console.log(`[mock-api] media uploads ${MEDIA_ENABLED ? 'enabled' : 'DISABLED (returns 503)'}`);
  console.log(`[mock-api] seeded ${posts.length} posts, ${comments.length} comments, ${mediaAssets.length} media assets`);
});
