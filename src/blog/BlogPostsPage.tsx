import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
  Copy,
  Eye,
  FileText,
  Link2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import * as blogApi from '../api/blog';
import type { BlogPost, BlogPostStatus } from '../api/blog';
import { ApiError } from '../api';
import { useToast } from '../components/Toast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Banner } from '../components/ui';
import { InlineEmpty, Pagination, PostStatePill, TagList } from './components/common';
import { PostPreviewDialog } from './components/PostPreviewDialog';
import type { PreviewPost } from './components/PostPreviewDialog';
import { documentToHtml, hasDocumentContent } from '../lib/blog-doc';
import { excerptFromHtml, sanitizeBlogHtml } from '../lib/blog-html';
import { formatDateTime, postState, publicPostUrl, relativeTime } from '../lib/blog';
import type { Route } from '../lib/routes';

type StatusFilter = 'ALL' | BlogPostStatus;

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'ALL', label: 'All posts' },
  { key: 'PUBLISHED', label: 'Published' },
  { key: 'DRAFT', label: 'Drafts' },
];

const PAGE_SIZE = 12;
const STORAGE_KEY = 'rown.blog.posts.view';

type StoredView = { status: StatusFilter; search: string; page: number };

function readStoredView(): StoredView {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { status: 'ALL', search: '', page: 1 };
    const parsed = JSON.parse(raw) as Partial<StoredView>;
    return {
      status: parsed.status === 'DRAFT' || parsed.status === 'PUBLISHED' ? parsed.status : 'ALL',
      search: typeof parsed.search === 'string' ? parsed.search.slice(0, 100) : '',
      page: Number.isFinite(parsed.page) && (parsed.page ?? 0) > 0 ? Number(parsed.page) : 1,
    };
  } catch {
    // Corrupt storage must never stop the console opening.
    return { status: 'ALL', search: '', page: 1 };
  }
}

function postHtml(post: BlogPost): string {
  if (post.contentHtml?.trim()) return sanitizeBlogHtml(post.contentHtml);
  return hasDocumentContent(post.content) ? documentToHtml(post.content) : '';
}

function toPreview(post: BlogPost): PreviewPost {
  return {
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    html: postHtml(post),
    coverImageUrl: post.coverImageUrl,
    coverImageAlt: post.coverImageAlt,
    category: post.category,
    tags: post.tags,
    authorName: post.authorName,
    publishedAt: post.publishedAt,
    state: postState(post),
  };
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export { copyText as copyToClipboard };

export function BlogPostsPage({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const toast = useToast();
  const stored = useMemo(readStoredView, []);

  const [status, setStatus] = useState<StatusFilter>(stored.status);
  const [search, setSearch] = useState(stored.search);
  const [searchDraft, setSearchDraft] = useState(stored.search);
  const [page, setPage] = useState(stored.page);

  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ all: number; published: number; drafts: number } | null>(null);

  const [busyPostId, setBusyPostId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BlogPost | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [preview, setPreview] = useState<PreviewPost | null>(null);

  const searchTimer = useRef<number | null>(null);
  const requestSeq = useRef(0);

  /* ---- loading ---- */

  const load = useCallback(
    async (targetPage: number, targetStatus: StatusFilter, targetSearch: string) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      setError(null);
      try {
        const [list, countResults] = await Promise.all([
          blogApi.listPosts({
            page: targetPage,
            limit: PAGE_SIZE,
            status: targetStatus === 'ALL' ? undefined : targetStatus,
            search: targetSearch || undefined,
          }),
          // Counts are decoration. A failed/empty status probe must not turn
          // a successful post list into a misleading "not found" screen.
          Promise.allSettled([
            blogApi.listPosts({ page: 1, limit: 1, status: 'PUBLISHED' }),
            blogApi.listPosts({ page: 1, limit: 1, status: 'DRAFT' }),
          ]),
        ]);
        // A slower response for an older filter must not overwrite a newer one.
        if (seq !== requestSeq.current) return;
        const lastPage = Math.max(1, list.pagination.totalPages);
        if (targetPage > lastPage) {
          setPage(lastPage);
          return;
        }
        setPosts(list.items);
        setTotal(list.pagination.total);
        setTotalPages(lastPage);
        const [published, drafts] = countResults;
        setCounts(published.status === 'fulfilled' && drafts.status === 'fulfilled' ? {
          published: published.value.pagination.total,
          drafts: drafts.value.pagination.total,
          all: published.value.pagination.total + drafts.value.pagination.total,
        } : null);
      } catch (e) {
        if (seq !== requestSeq.current) return;
        setPosts([]);
        setTotal(0);
        setCounts(null);
        setError(e instanceof Error ? e.message : 'The blog posts could not be loaded.');
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(page, status, search);
  }, [load, page, status, search]);

  /* Keep the view restorable after a trip into the editor. */
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ status, search, page } satisfies StoredView));
    } catch {
      /* private browsing modes can refuse storage; the view simply won't persist */
    }
  }, [status, search, page]);

  /* Debounced search so typing doesn't fire a request per character. */
  useEffect(() => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      const next = searchDraft.trim();
      if (next === search) return;
      setSearch(next);
      setPage(1);
    }, 350);
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    };
  }, [searchDraft, search]);

  /* ---- actions ---- */

  const changeStatus = (next: StatusFilter) => {
    setStatus(next);
    setPage(1);
  };

  const changePage = (next: number) => {
    setPage(next);
    // Landing at the top of a new page matters more on touch than on desktop.
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const publishNow = async (post: BlogPost) => {
    setBusyPostId(post.id);
    try {
      const updated = await blogApi.publishPost(post.id);
      setPosts(current => current.map(item => (item.id === post.id ? updated : item)));
      setCounts(current =>
        current
          ? { ...current, published: current.published + (post.status === 'DRAFT' ? 1 : 0), drafts: Math.max(0, current.drafts - (post.status === 'DRAFT' ? 1 : 0)) }
          : current,
      );
      toast.success('Post published', post.title);
      window.dispatchEvent(new Event('rown:blog-changed'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The post could not be published.');
    } finally {
      setBusyPostId(null);
    }
  };

  const unpublish = async (post: BlogPost) => {
    setBusyPostId(post.id);
    try {
      const updated = await blogApi.unpublishPost(post.id);
      setPosts(current => current.map(item => (item.id === post.id ? updated : item)));
      setCounts(current =>
        current
          ? { ...current, drafts: current.drafts + (post.status === 'PUBLISHED' ? 1 : 0), published: Math.max(0, current.published - (post.status === 'PUBLISHED' ? 1 : 0)) }
          : current,
      );
      toast.info('Moved back to drafts', post.title);
      window.dispatchEvent(new Event('rown:blog-changed'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The post could not be unpublished.');
    } finally {
      setBusyPostId(null);
    }
  };

  const confirmDelete = async () => {
    const post = pendingDelete;
    if (!post) return;
    setDeleting(true);
    try {
      await blogApi.deletePost(post.id);
      setPendingDelete(null);
      toast.success('Post deleted', post.title);
      const remaining = posts.length - 1;
      const nextPage = remaining === 0 && page > 1 ? page - 1 : page;
      if (nextPage !== page) setPage(nextPage);
      else void load(page, status, search);
      window.dispatchEvent(new Event('rown:blog-changed'));
    } catch (e) {
      const message =
        e instanceof ApiError && e.status === 404 && !(e instanceof blogApi.BlogEndpointError)
          ? 'That post was already deleted. The list has been refreshed.'
          : e instanceof Error
            ? e.message
            : 'The post could not be deleted.';
      toast.error(message);
      setPendingDelete(null);
      void load(page, status, search);
    } finally {
      setDeleting(false);
    }
  };

  const copyLink = async (post: BlogPost) => {
    const url = publicPostUrl(post.slug);
    const ok = await copyText(url ?? post.slug);
    if (ok) toast.success(url ? 'Public link copied' : 'Slug copied', url ?? post.slug);
    else toast.error('Copying failed. Your browser blocked clipboard access.');
  };

  /* ---- render ---- */

  const scheduledCount = posts.filter(post => postState(post) === 'scheduled').length;

  return (
    <>
      <header className="content-head">
        <div>
          <p className="eyebrow">CONTENT / BLOG</p>
          <h1>Blog posts</h1>
          <p className="subtle">Write, schedule and publish what readers see on the Rown blog.</p>
        </div>
        <div className="header-actions">
          <button
            className="icon-button"
            title="Refresh posts"
            aria-label="Refresh posts"
            onClick={() => void load(page, status, search)}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
          <button className="btn btn-primary" onClick={() => onNavigate({ name: 'blog-editor', postId: null })}>
            <Plus size={15} />
            New post
          </button>
        </div>
      </header>

      {counts && (
        <div className="stat-strip" role="status">
          <span className="stat-chip">
            <b>All</b> {counts.all.toLocaleString()}
          </span>
          <span className="stat-chip">
            <b>Published</b> {counts.published.toLocaleString()}
          </span>
          <span className="stat-chip">
            <b>Drafts</b> {counts.drafts.toLocaleString()}
          </span>
          {scheduledCount > 0 && (
            <span className="stat-chip stat-chip-accent">
              <CalendarClock size={12} />
              <b>Scheduled on this page</b> {scheduledCount}
            </span>
          )}
        </div>
      )}

      <section className="toolbar cms-toolbar">
        <div className="range-tabs" role="tablist" aria-label="Post status">
          {FILTERS.map(filter => (
            <button
              key={filter.key}
              role="tab"
              type="button"
              aria-selected={status === filter.key}
              className={status === filter.key ? 'selected' : ''}
              onClick={() => changeStatus(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="search-input search-input-sm cms-search">
          <Search size={15} />
          <input
            value={searchDraft}
            onChange={event => setSearchDraft(event.target.value)}
            placeholder="Search titles, slugs and excerpts"
            aria-label="Search posts"
            maxLength={100}
          />
          {searchDraft && (
            <button
              type="button"
              className="search-clear"
              aria-label="Clear search"
              onClick={() => {
                setSearchDraft('');
                setSearch('');
                setPage(1);
              }}
            >
              <X size={13} />
            </button>
          )}
        </div>
      </section>

      {error && <Banner tone="error" message={error} onDismiss={() => setError(null)} />}

      <section className="panel cms-panel">
        {loading && !posts.length ? (
          <div className="post-list">
            {Array.from({ length: 4 }, (_, index) => (
              <div className="post-row skeleton" key={index}>
                <span className="skel-thumb" />
                <span className="post-row-text">
                  <span className="skel-line" style={{ width: '55%' }} />
                  <span className="skel-line skel-xs" style={{ width: '30%' }} />
                </span>
              </div>
            ))}
          </div>
        ) : posts.length ? (
          <>
            <ul className="post-list">
              {posts.map(post => {
                const state = postState(post);
                const busy = busyPostId === post.id;
                return (
                  <li className="post-row" key={post.id}>
                    <button
                      type="button"
                      className="post-row-main"
                      onClick={() => onNavigate({ name: 'blog-editor', postId: post.id })}
                      aria-label={`Edit ${post.title}`}
                    >
                      {post.coverImageUrl ? (
                        <span className="post-thumb">
                          <img
                            src={post.coverImageUrl}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            onError={event => {
                              (event.currentTarget.parentElement as HTMLElement)?.classList.add('thumb-failed');
                            }}
                          />
                        </span>
                      ) : (
                        <span className="post-thumb post-thumb-empty">
                          <FileText size={15} />
                        </span>
                      )}
                      <span className="post-row-text">
                        <strong title={post.title}>{post.title}</strong>
                        <span className="post-slug">/{post.slug}</span>
                        <span className="post-row-meta">
                          <PostStatePill state={state} />
                          {post.category && <span className="post-category">{post.category}</span>}
                          <TagList tags={post.tags ?? []} limit={3} />
                          <span className="post-updated">
                            {state === 'scheduled' && post.publishedAt
                              ? `Live ${relativeTime(post.publishedAt)}`
                              : state === 'published' && post.publishedAt
                                ? `Published ${relativeTime(post.publishedAt)}`
                                : `Updated ${relativeTime(post.updatedAt)}`}
                          </span>
                        </span>
                        {post.excerpt && <span className="post-excerpt">{excerptFromHtml(post.excerpt, 130)}</span>}
                      </span>
                    </button>

                    <div className="post-row-actions">
                      {busy && <Loader2 size={14} className="spin" aria-label="Working" />}
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() => setPreview(toPreview(post))}
                        title="Preview as a reader"
                      >
                        <Eye size={13} />
                        <span className="btn-label">Preview</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() => onNavigate({ name: 'blog-editor', postId: post.id })}
                        title="Edit post"
                      >
                        <Pencil size={13} />
                        <span className="btn-label">Edit</span>
                      </button>
                      {state === 'draft' ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => void publishNow(post)}
                          disabled={busy}
                          title="Publish now"
                        >
                          <Link2 size={13} />
                          <span className="btn-label">Publish</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => void unpublish(post)}
                          disabled={busy}
                          title="Return to draft"
                        >
                          <X size={13} />
                          <span className="btn-label">Unpublish</span>
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() => void copyLink(post)}
                        title={publicPostUrl(post.slug) ? 'Copy the public link' : 'Copy the slug'}
                      >
                        <Copy size={13} />
                        <span className="btn-label">Copy link</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs btn-danger-ghost"
                        onClick={() => setPendingDelete(post)}
                        disabled={busy}
                        title="Delete post"
                      >
                        <Trash2 size={13} />
                        <span className="btn-label">Delete</span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <Pagination
              page={page}
              limit={PAGE_SIZE}
              total={total}
              totalPages={totalPages}
              onChange={changePage}
              loading={loading}
              noun="posts"
            />
          </>
        ) : (
          <InlineEmpty
            icon={<FileText size={24} />}
            message={
              error
                ? 'Nothing to show because the list could not be loaded.'
                : search || status !== 'ALL'
                  ? 'No posts match this filter yet.'
                  : 'No blog posts yet — write the first one.'
            }
          >
            {search || status !== 'ALL' ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setSearchDraft('');
                  setSearch('');
                  changeStatus('ALL');
                }}
              >
                Clear filters
              </button>
            ) : (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => onNavigate({ name: 'blog-editor', postId: null })}>
                <Plus size={14} />
                Create a post
              </button>
            )}
          </InlineEmpty>
        )}

        {loading && posts.length > 0 && (
          <p className="list-updating" role="status">
            <Loader2 size={12} className="spin" /> Updating…
          </p>
        )}
      </section>

      <PostPreviewDialog open={Boolean(preview)} onClose={() => setPreview(null)} post={preview ?? emptyPreview} />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        busy={deleting}
        tone="danger"
        title="Delete this post?"
        confirmLabel="Delete permanently"
        cancelLabel="Keep it"
        message={
          <>
            <p>
              <strong>{pendingDelete?.title}</strong> and every comment on it will be permanently removed. This cannot be
              undone.
            </p>
            {pendingDelete && (
              <p className="confirm-hint">
                <TriangleAlert size={13} />
                {pendingDelete.status === 'PUBLISHED'
                  ? 'It is currently published — readers will get a “not found” page right away.'
                  : 'It is a draft, so no reader is affected.'}
                {pendingDelete.publishedAt && ` Published ${formatDateTime(pendingDelete.publishedAt)}.`}
              </p>
            )}
            <p className="confirm-hint">Tip: “Unpublish” keeps the writing and hides it from readers instead.</p>
          </>
        }
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}

const emptyPreview: PreviewPost = {
  title: '',
  slug: '',
  html: '',
  state: 'draft',
};
