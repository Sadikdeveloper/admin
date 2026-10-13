# Blog CMS in the admin console

The console now manages the Rown blog: writing, scheduling and publishing posts,
uploading images, and moderating reader comments. It talks to the backend blog
module (`/admin/blog/*`, see the API's `docs/blog-module.md`).

**Scope.** This is the admin side only. The public, reader-facing blog and the
public comment form live in a different project and are deliberately not built
here — the console only links out to them.

---

## Screens

| Route | Screen | What it does |
| --- | --- | --- |
| `#/blog` | Blog posts | Filterable, searchable, paginated list (12/page) with per-row preview, edit, publish, unpublish, copy link and delete. The filter/search/page survive a trip into the editor (`sessionStorage`). |
| `#/blog/new` | Editor (new post) | Create a draft, then publish, schedule or keep editing. |
| `#/blog/<id>/edit` | Editor (existing post) | Full edit of every field the API accepts. |
| `#/blog/media` | Media library | Drag-and-drop uploads with a per-file queue, paginated asset grid (24/page), asset detail, copy CDN URL. |
| `#/blog/comments` | Comments | Moderation queue with per-status counts, bulk approve/reject/delete, page size 20/50/100, and a link into the post a comment belongs to. |

The sidebar gained a **Content** group (Blog / Media / Comments); Comments carries
a badge with the pending count, refreshed every 90 s and after any moderation
action.

---

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc -b && vite build
npm test           # vitest (jsdom), 185 tests
```

### Environment

The environment variables are documented in `.env.example`.

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | Optional API origin. Empty or unset uses same-origin `/admin` paths; forward those to the backend with a dev or production proxy. It never defaults the browser to localhost. An explicit origin can include a backend route prefix. |
| `VITE_DEV_API_PROXY` | Dev server only: forwards the proxy paths to this backend. |
| `VITE_DEV_PROXY_PATHS` | Comma-separated paths to proxy (default `/admin`). |
| `VITE_PUBLIC_SITE_URL` | Where readers see the blog. Enables “View live post”, “Copy link” and the public link on comments. Without it those actions fall back to copying the slug. |
| `VITE_MOCK_WALLET` | Dev only: install a fake injected wallet (`src/dev/mock-wallet.ts`) so sign-in works without a wallet extension. Never included in a production build. |

### Without the real backend

`tools/mock-blog-api.mjs` (dev scaffolding, never imported by the app) implements the auth handshake
and every `/admin/blog` route in memory, with the same envelope, the same
validation shapes (400 with an array of messages, 409 on duplicate slugs, 429
above 15 uploads/minute, 503 when storage is unconfigured) and a `/mock-media`
path that serves uploaded bytes back so images really render.

```bash
node tools/mock-blog-api.mjs                      # 0.0.0.0:3000
MOCK_BLOG_EMPTY=1 node tools/mock-blog-api.mjs    # no posts, images or comments
MOCK_BLOG_MEDIA=off node tools/mock-blog-api.mjs  # reproduce the "storage not configured" 503

VITE_API_BASE_URL= \
VITE_DEV_API_PROXY=http://127.0.0.1:3000 \
VITE_DEV_PROXY_PATHS=/admin,/mock-media \
VITE_MOCK_WALLET=1 \
npm run dev
```

---

## Endpoint map

`src/api/blog.ts` is the only module that knows the routes. Every response is
unwrapped from `{ status, message, data }`, and paged responses are normalised
into `{ items, pagination }` even if a proxy returns a bare array.

| Console action | Request |
| --- | --- |
| List posts (filter/search/page) | `GET /admin/blog/posts?status&search&page&limit` |
| Open a post | `GET /admin/blog/posts/:id` |
| Save a new draft | `POST /admin/blog/posts` |
| Save edits | `PATCH /admin/blog/posts/:id` |
| Publish now / schedule | `POST /admin/blog/posts/:id/publish` with `{}` or `{ publishAt }` |
| Back to draft | `POST /admin/blog/posts/:id/draft` |
| Delete | `DELETE /admin/blog/posts/:id` |
| Media grid | `GET /admin/blog/media?page&limit` |
| Upload | `POST /admin/blog/media` (multipart, field `file`) |
| Comment queue + counts | `GET /admin/blog/comments?status&page&limit` |
| Approve / reject / re-queue | `PATCH /admin/blog/comments/:id` with `{ status }` |
| Delete comment | `DELETE /admin/blog/comments/:id` |

A 401 triggers one silent `POST /admin/auth/refresh` and a retry; if that fails
the session is cleared and the operator is asked to sign in again.

---

## Edge cases and how they are handled

**A CMS with no content yet.** Successful empty collections (`items: []`, a
bare array, `data: null` or a 204) show the first-use empty state with the
appropriate create/upload action. Pagination with `totalPages: 0` is normalized
to one empty page; a stale stored page is clamped. Older servers that explicitly
reply 404 with “No blog posts found”, “No media assets found” or “Blog comments
not found” are also handled as empty collections, only on collection GETs.
Count probes are optional: a failed published/draft count cannot hide a valid
post list or its first-post action.

**A missing CMS endpoint is not empty content.** The old “We couldn't find what
you were looking for” text came from the shared API's generic 404 mapping.
`BlogEndpointError` now explains missing collection routes, missing create or
upload routes, and Nest's `Cannot GET/POST/PATCH/DELETE …` responses as content-API
setup problems. They are never silently changed into an empty database, nor
called deleted articles. A real missing post still has the “Post not found”
screen. Failed loads keep device-local backups and offer a retry. An HTML SPA
page returned instead of API JSON reports an API/proxy routing problem.

If a live deployment still replies `Cannot GET /admin/blog/posts`, the **backend
blog module must be deployed/enabled and the API base URL or `/admin` proxy must
be corrected**. This frontend repository cannot install routes on a separate
backend. Check the request and response in the browser's Network panel; a
working empty backend should return 200 with `items: []` and a zero total.

**Empty content.** Publishing is blocked in the browser first: `<p><br></p>`,
whitespace and zero-width placeholders count as empty, so the operator sees
“Write the article before publishing” instead of the API's 400. If the server
still refuses (for example a post saved by another client), its message is shown
verbatim.

**Slug conflicts.** A slug nobody typed by hand is left to the API on create
(`slug: null`), so the server derives one from the title and adds `-2`/`-3`
instead of failing. A hand-typed slug is sent as-is; a 409 then points at the
slug field with “That slug is already taken”, and the slug pattern
(`^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$`) is validated before saving.

**Media storage not configured (503).** Uploads report “Blog image storage is
not set up on the server yet” plus the exact `BLOG_MEDIA_*` settings an engineer
must add, and the warning stays on the media page (not just in a toast) so the
next attempt is not a mystery. Pasting an external `https://` image URL still
works, because that never touches storage.

**Rate limits (429).** A throttled upload or list request says how many requests
are allowed and to wait; a bulk moderation run stops hammering the API and
reports how many items failed.

**Validation errors.** Nest returns `message` as an array. `friendlyApiError`
keeps short, human-readable messages (max 3, joined with `·`) and drops
stack-trace noise; `mapServerMessages` points each one at the matching field
(title, slug, excerpt, content, coverImageUrl, category, tags, authorName,
canonicalUrl, seoTitle, seoDescription, publishAt).

**Offline / unreachable.** `ApiError.status === 0` means “we can't reach the
Rown server”; nothing on screen is cleared, so work in progress survives, and
the editor keeps a local backup (below).

**Uploads.** Files are checked in the browser before any request: empty, over
5 MB, not an image, or a file whose declared MIME type contradicts its magic
bytes (a GIF renamed `.png`) are rejected with the reason. Uploads run one at a
time so the 15/minute limit is not hit, and a rate-limit or storage failure
stops the rest of the queue instead of repeating the same error.

**Deleted underneath you.** A 404 while saving or moderating explains that the
post/comment no longer exists and refreshes the list.

**Concurrent editing.** While an editor is open, the post is re-fetched every
two minutes and on tab focus. If someone else saved it, a bar offers “Keep mine”
or “Load their version” instead of silently overwriting.

**Unsaved work.** Navigating away with unsaved changes asks first (hash changes
and the back button), `beforeunload` covers a closed tab, and a local backup is
written to `localStorage` every second. Reopening the post offers “Restore my
edits” when the backup is newer than the server copy, or “Discard local copy”.
A full or blocked `localStorage` degrades to a warning — the editor keeps working.

**Untrusted content.** Everything the API stores is re-sanitized in the browser
before it is rendered (editor, preview, post list), because a payload could have
arrived through another client: only the allow-listed tags survive, `on*`
handlers, `style`, `srcset`, comments, `<script>`, `<iframe>`, `<form>` and
`javascript:`/`vbscript:`/`data:`/`blob:` URLs are dropped, an anchor with an
unsafe href is unwrapped to text, an image with an unsafe src is removed, and
`target="_blank"` gains `rel="noopener noreferrer nofollow"`. Comment bodies are
rendered as plain text, never HTML.

**Images from anywhere.** A cover or inline image can be an uploaded asset, any
public `https://` URL, or a root-relative path — pasted directly, exactly like a
normal CMS. Pasting an `http://` or `data:` URL is rejected before saving with
the reason, matching the API. Non-raster URLs can be imported into the media
library too (fetched, sniffed and re-uploaded) when CORS allows it.

**Long content.** Word count, reading time and a 900 KB warning are shown before
the API's 1 MB limit rejects a save.

---

## Content pipeline

The API stores both a rich document (`content`, ProseMirror/Tiptap-shaped JSON)
and sanitized HTML (`contentHtml`).

- On load the editor prefers `contentHtml` and falls back to rendering `content`.
- On save it sends both: the editor's cleaned HTML plus `htmlToDocument(html)`.
- `src/lib/blog-doc.ts` converts in both directions and rejects unsafe attrs,
  so a document written by another client cannot smuggle markup back in.
- `src/lib/blog-html.ts` holds the allow-list mirroring the backend's
  `blog-content.ts`.
- The editor is a `contenteditable` surface with a formatting toolbar and
  visible **Insert image**, **Upload images here**, **Insert HTML** and **HTML
  source** actions. DOM insertion is shared in `src/lib/blog-editor.ts`.
- Images split the paragraph at the chosen cursor, not at the article end.
  There is a typing paragraph immediately below each image; numbered-list
  steps and table cells keep their screenshots inside the same container.
- File uploads, dropped files and pasted screenshots use the same validation
  and media API. Uploads are queued sequentially and keep their original
  insertion point even when the writer keeps typing. Multiple images retain
  their order, including rapid successive pastes at one cursor. A delayed
  result never writes into an externally replaced article. Saving/publishing
  waits until uploads finish; storage/rate failures stop the remaining batch.
- Clicking a screenshot exposes move-up/down, alt-text/caption and remove
  actions. Internal image drags move the existing figure and caption rather
  than duplicating the browser's dragged HTML.
- **Insert HTML** previews sanitized markup before inserting it at the saved
  cursor without replacing other content. Full **HTML source** changes are
  reported to the form immediately, so save, preview, local backups and the
  unsaved-work guard see them without a mode switch. Rendering/saving still
  sanitizes; scripts, event handlers, inline styles and embeds are not enabled.
- Common safe `<b>`, `<i>` and `<strike>` tags (including browser-generated
  toolbar formatting) are normalized to `<strong>`, `<em>` and `<s>` so the
  backend's allow-list keeps the formatting.
- External values are cleaned before being injected into the editor. A blank
  source editor or a default author name does not count as added content.

---

## Writing a tutorial

1. Open **New post** and start writing in **Content**.
2. Place the cursor where the screenshot belongs. Choose **Insert image** to
   use the library or a URL (with alt text/caption), or **Upload images here** to
   upload one or several files directly at that point. Pasting a screenshot or
   dropping a file works too.
3. Continue typing below the image, then repeat for the next step. Click an
   image to move it, edit its details or remove it; dragging reorders it.
4. Use **Insert HTML** for a snippet such as a heading, code example or table.
   Use **HTML source** to edit the entire article. Save and reader preview work
   in either mode, including the latest source changes.
5. The sidebar's **Cover image** is a separate, optional listing thumbnail;
   it is not where tutorial screenshots are arranged.

## Layout of the new code

```
src/api/blog.ts                  blog API client (routes, envelope, pagination)
src/lib/blog.ts                  limits, slugify, formatters, state, URL and image checks
src/lib/blog-html.ts             sanitizer + text/word/excerpt helpers
src/lib/blog-doc.ts              HTML ↔ rich document conversion
src/lib/blog-editor.ts           cursor-aware DOM insertion and selection bookmarks
src/lib/blog-draft.ts            post form, localStorage backup, taxonomy memory
src/lib/blog-images.ts           upload validation, error translation, URL import
src/lib/routes.ts                hash routes for analytics + the CMS
src/lib/nav-guard.ts             unsaved-work veto for navigation
src/components/                  Modal, Toast, ConfirmDialog (+ existing ui.tsx)
src/blog/BlogPostsPage.tsx       list
src/blog/BlogEditorPage.tsx      editor orchestration
src/blog/BlogMediaPage.tsx       media library
src/blog/BlogCommentsPage.tsx    moderation queue
src/blog/components/             RichTextEditor, MediaLibraryDialog, CoverImageField,
                                 HtmlSnippetDialog, SeoPanel, PostPreviewDialog,
                                 useImageUpload, common
src/styles/blog.css              CMS styles (imported after styles.css)
```

Styling reuses the console's existing tokens (`--accent`, `--paper`, `--line`,
…) and breakpoints; forms switch to 16 px inputs at ≤620 px so iOS stops
zooming, modals become bottom sheets, and the editor collapses to one column
below 1120 px with a sticky mobile action bar.

---

## Tests

`npm test` runs Vitest in jsdom (244 tests):

- `src/lib/__tests__/` — slugify/limits/formatters, schedule and URL rules,
  magic-byte image detection, the sanitizer, document conversion, drafts, routes
  and the navigation guard.
- `src/api/__tests__/blog.test.ts` — query building, envelope and pagination
  normalisation, multipart uploads, 400/404/409/429/503 mapping, refresh-and-retry.
- `src/blog/__tests__/` — each screen against a faked API: list filters, search
  debounce, pagination, publish/unpublish/delete, scheduling, duplicate slugs,
  offline saves, the local backup, moderation with rollback, bulk runs, upload
  validation and the storage/rate-limit paths.
- `src/blog/components/__tests__/RichTextEditor.test.tsx` — hydration, typing,
  empty-markup reporting, cursor placement, image ordering/reordering and
  details, clipboard/drop uploads, asynchronous insertion and focus, failed
  queues, HTML snippet previews, immediate source reporting, disabled and
  invalid states. Editor-page regressions also cover saving/previewing/backing
  up source edits, missing versus deleted endpoints and StrictMode hydration.
- `src/lib/__tests__/blog-editor.test.ts` — splitting paragraphs, preserving
  inline formatting, list/table containers, mixed HTML, detached ranges and
  cursor bookmarks.

Browser smoke testing against the empty mock API covers first-use states,
typing → uploading → continued typing → another screenshot, alt/caption edits,
image repositioning, HTML snippets/preview, source-mode saves, reload under
StrictMode, a 390 px viewport and a missing CMS route. Uploaded mock-media bytes
are served directly (not JSON-serialized), so previews test real image rendering.
