import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ExternalLink,
  Loader2,
  MessageSquare,
  Pencil,
  RefreshCw,
  RotateCcw,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import * as blogApi from '../api/blog';
import type { BlogComment, BlogCommentStatus } from '../api/blog';
import { ApiError } from '../api';
import { useToast } from '../components/Toast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Banner } from '../components/ui';
import { COMMENT_STATE_META, formatDateTime, publicPostUrl, relativeTime } from '../lib/blog';
import { CommentStatePill, InlineEmpty, Pagination } from './components/common';
import type { Route } from '../lib/routes';

type StatusFilter = 'ALL' | BlogCommentStatus;

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
];

const PAGE_SIZES = [20, 50, 100];

type Counts = Record<StatusFilter, number>;

/**
 * Comment moderation.
 *
 * Anonymous comments arrive as plain text and stay hidden until approved, so
 * this screen is a queue: read, approve or reject quickly, and delete spam.
 * Bodies are never rendered as HTML — not even here.
 */
export function BlogCommentsPage({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const toast = useToast();

  const [status, setStatus] = useState<StatusFilter>('PENDING');
  const [limit, setLimit] = useState(20);
  const [page, setPage] = useState(1);

  const [comments, setComments] = useState<BlogComment[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ running: boolean; done: number; of: number; label: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ ids: string[]; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const requestSeq = useRef(0);

  /* ---- loading ---- */

  const loadCounts = useCallback(async () => {
    try {
      const [pending, approved, rejected] = await Promise.all([
        blogApi.listComments({ status: 'PENDING', page: 1, limit: 1 }),
        blogApi.listComments({ status: 'APPROVED', page: 1, limit: 1 }),
        blogApi.listComments({ status: 'REJECTED', page: 1, limit: 1 }),
      ]);
      const next: Counts = {
        PENDING: pending.pagination.total,
        APPROVED: approved.pagination.total,
        REJECTED: rejected.pagination.total,
        ALL: pending.pagination.total + approved.pagination.total + rejected.pagination.total,
      };
      setCounts(next);
      return next;
    } catch {
      // Counts are decoration; the queue itself is what matters.
      return null;
    }
  }, []);

  const load = useCallback(
    async (targetStatus: StatusFilter, targetPage: number, targetLimit: number) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      setError(null);
      try {
        const [list] = await Promise.all([
          blogApi.listComments({
            status: targetStatus === 'ALL' ? undefined : targetStatus,
            page: targetPage,
            limit: targetLimit,
          }),
          loadCounts(),
        ]);
        if (seq !== requestSeq.current) return;
        setComments(list.items);
        setTotal(list.pagination.total);
        setTotalPages(list.pagination.totalPages);
        setSelected([]);
      } catch (e) {
        if (seq !== requestSeq.current) return;
        setComments([]);
        setTotal(0);
        setError(e instanceof Error ? e.message : 'The comments could not be loaded.');
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [loadCounts],
  );

  useEffect(() => {
    void load(status, page, limit);
  }, [load, status, page, limit]);

  /** Other screens (and other tabs of this one) can announce moderation work. */
  useEffect(() => {
    const onChanged = () => void loadCounts();
    window.addEventListener('rown:blog-comments-changed', onChanged);
    return () => window.removeEventListener('rown:blog-comments-changed', onChanged);
  }, [loadCounts]);

  /* ---- single actions ---- */

  const moderate = useCallback(
    async (comment: BlogComment, next: BlogCommentStatus) => {
      const previous = comments;
      setBusyId(comment.id);
      setComments(current => current.map(item => (item.id === comment.id ? { ...item, status: next } : item)));
      try {
        const updated = await blogApi.moderateComment(comment.id, next);
        setComments(current => current.map(item => (item.id === comment.id ? { ...item, ...updated } : item)));
        setCounts(current =>
          current
            ? {
                ...current,
                [comment.status]: Math.max(0, current[comment.status] - 1),
                [next]: current[next] + 1,
              }
            : current,
        );
        toast.success(`Comment ${COMMENT_STATE_META[next].label.toLowerCase()}`, `From ${comment.displayName}`);
        window.dispatchEvent(new Event('rown:blog-comments-changed'));
      } catch (e) {
        setComments(previous);
        const message =
          e instanceof ApiError && e.status === 404 && !(e instanceof blogApi.BlogEndpointError)
            ? 'That comment no longer exists — it was probably deleted by another operator.'
            : e instanceof Error
              ? e.message
              : 'The comment could not be updated.';
        toast.error(message);
        if (e instanceof ApiError && e.status === 404 && !(e instanceof blogApi.BlogEndpointError)) void load(status, page, limit);
      } finally {
        setBusyId(null);
      }
    },
    [comments, limit, load, page, status, toast],
  );

  const removeOne = useCallback(
    async (comment: BlogComment) => {
      const previous = comments;
      setBusyId(comment.id);
      setComments(current => current.filter(item => item.id !== comment.id));
      try {
        await blogApi.deleteComment(comment.id);
        setTotal(current => Math.max(0, current - 1));
        setCounts(current =>
          current ? { ...current, [comment.status]: Math.max(0, current[comment.status] - 1), ALL: Math.max(0, current.ALL - 1) } : current,
        );
        toast.success('Comment deleted');
        window.dispatchEvent(new Event('rown:blog-comments-changed'));
      } catch (e) {
        setComments(previous);
        toast.error(
          e instanceof ApiError && e.status === 404 && !(e instanceof blogApi.BlogEndpointError)
            ? 'That comment was already deleted.'
            : e instanceof Error
              ? e.message
              : 'The comment could not be deleted.',
        );
        void load(status, page, limit);
      } finally {
        setBusyId(null);
      }
    },
    [comments, limit, load, page, status, toast],
  );

  /* ---- bulk actions ---- */

  const runBulk = useCallback(
    async (action: 'APPROVED' | 'REJECTED', label: string) => {
      const ids = selected;
      if (!ids.length) return;
      setBulk({ running: true, done: 0, of: ids.length, label });
      let failures = 0;

      for (const [index, id] of ids.entries()) {
        try {
          await blogApi.moderateComment(id, action);
        } catch {
          failures += 1;
        }
        setBulk({ running: true, done: index + 1, of: ids.length, label });
      }

      setBulk(null);
      setSelected([]);
      if (failures) toast.error(`${label} finished with ${failures} problem${failures === 1 ? '' : 's'}`, 'The list has been refreshed.');
      else toast.success(`${label} ${ids.length} comment${ids.length === 1 ? '' : 's'}`);
      window.dispatchEvent(new Event('rown:blog-comments-changed'));
      void load(status, page, limit);
    },
    [limit, load, page, selected, status, toast],
  );

  const confirmBulkDelete = useCallback(async () => {
    const target = pendingDelete;
    setDeleting(true);
    if (target && target.ids.length === 1) {
      const comment = comments.find(item => item.id === target.ids[0]);
      setDeleting(false);
      setPendingDelete(null);
      if (comment) await removeOne(comment);
      return;
    }

    if (!target) {
      setDeleting(false);
      return;
    }

    setBulk({ running: true, done: 0, of: target.ids.length, label: 'Deleted' });
    let failures = 0;
    for (const [index, id] of target.ids.entries()) {
      try {
        await blogApi.deleteComment(id);
      } catch {
        failures += 1;
      }
      setBulk({ running: true, done: index + 1, of: target.ids.length, label: 'Deleted' });
    }
    setBulk(null);
    setDeleting(false);
    setPendingDelete(null);
    setSelected([]);
    if (failures) toast.error(`${failures} comment${failures === 1 ? '' : 's'} could not be deleted`);
    else toast.success(`Deleted ${target.ids.length} comment${target.ids.length === 1 ? '' : 's'}`);
    window.dispatchEvent(new Event('rown:blog-comments-changed'));
    void load(status, page, limit);
  }, [comments, limit, load, page, pendingDelete, removeOne, status, toast]);

  /* ---- selection helpers ---- */

  const toggleSelect = (id: string) => {
    setSelected(current => (current.includes(id) ? current.filter(item => item !== id) : [...current, id]));
  };

  const allSelected = comments.length > 0 && selected.length === comments.length;
  const selectableIds = useMemo(() => comments.map(comment => comment.id), [comments]);

  const toggleSelectAll = () => {
    setSelected(allSelected ? [] : selectableIds);
  };

  /* ---- render ---- */

  return (
    <>
      <header className="content-head">
        <div>
          <p className="eyebrow">CONTENT / COMMENTS</p>
          <h1>Comments</h1>
          <p className="subtle">
            Readers can comment without an account. Everything stays hidden until you approve it, so this queue is the only
            thing between anonymous text and the public blog.
          </p>
        </div>
        <div className="header-actions">
          <button
            className="icon-button"
            onClick={() => void load(status, page, limit)}
            disabled={loading || bulk?.running}
            title="Refresh comments"
            aria-label="Refresh comments"
          >
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
          {counts && counts.PENDING > 0 && (
            <button className="btn btn-primary" onClick={() => setStatus('PENDING')} disabled={status === 'PENDING'}>
              <MessageSquare size={15} />
              {counts.PENDING} waiting
            </button>
          )}
        </div>
      </header>

      {error && <Banner tone="error" message={error} onDismiss={() => setError(null)} />}

      <section className="toolbar cms-toolbar">
        <div className="range-tabs" role="tablist" aria-label="Comment status">
          {FILTERS.map(filter => (
            <button
              key={filter.key}
              role="tab"
              type="button"
              aria-selected={status === filter.key}
              className={status === filter.key ? 'selected' : ''}
              onClick={() => {
                setStatus(filter.key);
                setPage(1);
              }}
            >
              {filter.label}
              {counts && <span className="tab-count">{counts[filter.key].toLocaleString()}</span>}
            </button>
          ))}
        </div>
        <label className="page-size">
          <span>Show</span>
          <select
            value={limit}
            onChange={event => {
              setLimit(Number(event.target.value));
              setPage(1);
            }}
            aria-label="Comments per page"
          >
            {PAGE_SIZES.map(size => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </section>

      {bulk?.running && (
        <div className="bulk-progress" role="status" aria-live="polite">
          <Loader2 size={14} className="spin" />
          <span>
            {bulk.label} {bulk.done} of {bulk.of}…
          </span>
          <span className="bulk-progress-track" aria-hidden="true">
            <i style={{ width: `${Math.round((bulk.done / Math.max(1, bulk.of)) * 100)}%` }} />
          </span>
        </div>
      )}

      {selected.length > 0 && !bulk?.running && (
        <div className="bulk-bar" role="region" aria-label="Bulk actions">
          <span className="bulk-count">
            {selected.length} selected
            <button type="button" className="btn-link" onClick={() => setSelected([])}>
              Clear
            </button>
          </span>
          <div className="bulk-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void runBulk('APPROVED', 'Approved')}>
              <Check size={14} />
              Approve
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void runBulk('REJECTED', 'Rejected')}>
              <X size={14} />
              Reject
            </button>
            <button
              type="button"
              className="btn btn-danger-ghost btn-sm"
              onClick={() => setPendingDelete({ ids: selected, label: `${selected.length} comments` })}
            >
              <Trash2 size={14} />
              Delete
            </button>
          </div>
        </div>
      )}

      <section className="panel cms-panel">
        {loading && !comments.length ? (
          <ul className="comment-list">
            {Array.from({ length: 4 }, (_, index) => (
              <li className="comment-row skeleton" key={index}>
                <span className="skel-circle" />
                <span className="comment-body">
                  <span className="skel-line" style={{ width: '35%' }} />
                  <span className="skel-line skel-lg" style={{ width: '85%' }} />
                  <span className="skel-line skel-sm" style={{ width: '55%' }} />
                </span>
              </li>
            ))}
          </ul>
        ) : comments.length ? (
          <>
            <div className="comment-select-all">
              <label className="check-row">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="Select every comment on this page" />
                <span>Select all {comments.length} on this page</span>
              </label>
            </div>
            <ul className="comment-list">
              {comments.map(comment => {
                const busy = busyId === comment.id;
                const liveUrl = comment.post ? publicPostUrl(comment.post.slug) : null;
                return (
                  <li className={`comment-row comment-${comment.status.toLowerCase()}`} key={comment.id}>
                    <label className="comment-check">
                      <input
                        type="checkbox"
                        checked={selected.includes(comment.id)}
                        onChange={() => toggleSelect(comment.id)}
                        aria-label={`Select comment by ${comment.displayName}`}
                      />
                    </label>
                    <span className="comment-avatar" aria-hidden="true">
                      {(comment.displayName || 'A').trim().charAt(0).toUpperCase()}
                    </span>
                    <div className="comment-body">
                      <div className="comment-head">
                        <strong>{comment.displayName || 'Anonymous'}</strong>
                        <CommentStatePill status={comment.status} />
                        <span className="comment-time" title={formatDateTime(comment.createdAt)}>
                          {relativeTime(comment.createdAt)}
                        </span>
                      </div>
                      {/* Deliberately plain text: an anonymous comment is never HTML. */}
                      <p className="comment-text">{comment.body}</p>
                      <div className="comment-foot">
                        {comment.post && (
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() => onNavigate({ name: 'blog-editor', postId: comment.post!.id })}
                            title="Edit the post this comment is on"
                          >
                            <Pencil size={11} />
                            {comment.post.title}
                          </button>
                        )}
                        {liveUrl && (
                          <a className="btn-link" href={liveUrl} target="_blank" rel="noopener noreferrer">
                            <ExternalLink size={11} />
                            View post
                          </a>
                        )}
                        {comment.moderatedAt && (
                          <span className="comment-mod" title={formatDateTime(comment.moderatedAt)}>
                            {comment.status === 'PENDING' ? 'Returned to queue' : 'Moderated'} {relativeTime(comment.moderatedAt)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="comment-actions">
                      {busy && <Loader2 size={13} className="spin" />}
                      {comment.status !== 'APPROVED' && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => void moderate(comment, 'APPROVED')}
                          disabled={busy || bulk?.running}
                          title="Approve and show publicly"
                        >
                          <Check size={13} />
                          Approve
                        </button>
                      )}
                      {comment.status !== 'REJECTED' && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => void moderate(comment, 'REJECTED')}
                          disabled={busy || bulk?.running}
                          title="Hide from readers"
                        >
                          <X size={13} />
                          Reject
                        </button>
                      )}
                      {comment.status !== 'PENDING' && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => void moderate(comment, 'PENDING')}
                          disabled={busy || bulk?.running}
                          title="Return to the moderation queue"
                        >
                          <RotateCcw size={13} />
                          Re-queue
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs btn-danger-ghost"
                        onClick={() => setPendingDelete({ ids: [comment.id], label: 'this comment' })}
                        disabled={busy || bulk?.running}
                        title="Delete permanently"
                      >
                        <Trash2 size={13} />
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <Pagination
              page={page}
              limit={limit}
              total={total}
              totalPages={totalPages}
              onChange={next => {
                setPage(next);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              loading={loading}
              noun="comments"
            />
          </>
        ) : (
          <InlineEmpty
            icon={<MessageSquare size={24} />}
            message={
              error
                ? 'The queue could not be loaded.'
                : status === 'PENDING'
                  ? 'Nothing waiting for moderation. Nice.'
                  : status === 'ALL'
                    ? 'No comments yet — readers have not written anything.'
                    : `No ${COMMENT_STATE_META[status as BlogCommentStatus]?.label.toLowerCase() ?? ''} comments.`
            }
          >
            {status !== 'ALL' && !error && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStatus('ALL')}>
                Show all comments
              </button>
            )}
          </InlineEmpty>
        )}
      </section>

      <p className="cms-footnote">
        <TriangleAlert size={12} />
        Comments are stored exactly as written — no formatting, no links, no HTML — and readers see them only after
        approval. Deleting removes them permanently.
      </p>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        busy={deleting}
        title={pendingDelete && pendingDelete.ids.length > 1 ? `Delete ${pendingDelete.ids.length} comments?` : 'Delete this comment?'}
        confirmLabel="Delete permanently"
        cancelLabel="Keep it"
        message={
          <p>
            {pendingDelete?.label ?? 'This comment'} will be permanently removed. Readers who were replied to will not be
            notified.
          </p>
        }
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmBulkDelete()}
      />
    </>
  );
}
