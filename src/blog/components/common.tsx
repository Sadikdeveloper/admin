import { useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { BlogCommentStatus } from '../../api/blog';
import {
  COMMENT_STATE_META,
  POST_STATE_META,
  TAGS_MAX,
  TAG_MAX,
  normalizeTag,
} from '../../lib/blog';
import type { PostState } from '../../lib/blog';

/* ------------------------------------------------------------------ */
/* Status pills                                                        */
/* ------------------------------------------------------------------ */

export function PostStatePill({ state, title }: { state: PostState; title?: string }) {
  const meta = POST_STATE_META[state];
  return (
    <span className={`state-pill ${meta.className}`} title={title ?? meta.hint}>
      <i aria-hidden="true" />
      {meta.label}
    </span>
  );
}

export function CommentStatePill({ status }: { status: BlogCommentStatus }) {
  const meta = COMMENT_STATE_META[status] ?? COMMENT_STATE_META.PENDING;
  return (
    <span className={`state-pill ${meta.className}`} title={meta.hint}>
      <i aria-hidden="true" />
      {meta.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Counters & hints                                                    */
/* ------------------------------------------------------------------ */

/**
 * Character budget for a field. Turns amber near the limit and red over it, so
 * a rejection from the API is never a surprise.
 */
export function CharCounter({ value, max, label }: { value: string; max: number; label?: string }) {
  const length = value.length;
  const tone = length > max ? 'over' : length >= max * 0.9 ? 'near' : 'ok';
  return (
    <span className={`char-counter char-${tone}`} aria-live="off">
      {label ? `${label} ` : ''}
      {length.toLocaleString()}/{max.toLocaleString()}
      {length > max && ' — too long'}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Pagination                                                          */
/* ------------------------------------------------------------------ */

function pageWindow(current: number, total: number): (number | 'gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set<number>([1, total, current, current - 1, current + 1]);
  if (current <= 3) [2, 3, 4].forEach(page => pages.add(page));
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach(page => pages.add(page));

  const sorted = [...pages].filter(page => page >= 1 && page <= total).sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  sorted.forEach((page, index) => {
    if (index > 0 && page - sorted[index - 1] > 1) out.push('gap');
    out.push(page);
  });
  return out;
}

export function Pagination({
  page,
  limit,
  total,
  totalPages,
  onChange,
  loading = false,
  noun = 'items',
}: {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  onChange: (page: number) => void;
  loading?: boolean;
  noun?: string;
}) {
  if (total <= 0) return null;
  const from = Math.min(total, (page - 1) * limit + 1);
  const to = Math.min(total, page * limit);
  const safeTotalPages = Math.max(1, totalPages || Math.ceil(total / limit));

  return (
    <nav className="pager" aria-label={`${noun} pages`}>
      <span className="pager-summary">
        Showing <strong>{from.toLocaleString()}</strong>–<strong>{to.toLocaleString()}</strong> of{' '}
        <strong>{total.toLocaleString()}</strong>
      </span>
      <div className="pager-controls">
        <button
          type="button"
          className="icon-button"
          onClick={() => onChange(page - 1)}
          disabled={loading || page <= 1}
          aria-label={`Previous page of ${noun}`}
          title="Previous page"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="pager-pages">
          {pageWindow(page, safeTotalPages).map((entry, index) =>
            entry === 'gap' ? (
              <span className="pager-gap" key={`gap-${index}`} aria-hidden="true">
                …
              </span>
            ) : (
              <button
                type="button"
                key={entry}
                className={`pager-page${entry === page ? ' current' : ''}`}
                onClick={() => onChange(entry)}
                disabled={loading || entry === page}
                aria-current={entry === page ? 'page' : undefined}
                aria-label={`Page ${entry}`}
              >
                {entry}
              </button>
            ),
          )}
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={() => onChange(page + 1)}
          disabled={loading || page >= safeTotalPages}
          aria-label={`Next page of ${noun}`}
          title="Next page"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Tag input                                                           */
/* ------------------------------------------------------------------ */

export function TagInput({
  value,
  onChange,
  max = TAGS_MAX,
  disabled = false,
  id,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  max?: number;
  disabled?: boolean;
  id?: string;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = (raw: string) => {
    const tag = normalizeTag(raw);
    if (!tag) return false;
    if (value.includes(tag)) {
      setError(`"${tag}" is already added.`);
      return false;
    }
    if (value.length >= max) {
      setError(`A post can have at most ${max} tags.`);
      return false;
    }
    if (tag.length > TAG_MAX) {
      setError(`Each tag must be ${TAG_MAX} characters or fewer.`);
      return false;
    }
    onChange([...value, tag]);
    setError(null);
    return true;
  };

  const commitDraft = () => {
    // Splitting on commas and spaces lets an operator paste "news, product".
    const parts = draft.split(/[,\n]/).map(part => part.trim()).filter(Boolean);
    if (!parts.length) return;
    let added = 0;
    const next = [...value];
    for (const part of parts) {
      const tag = normalizeTag(part);
      if (!tag || next.includes(tag)) continue;
      if (next.length >= max) {
        setError(`A post can have at most ${max} tags.`);
        break;
      }
      next.push(tag);
      added += 1;
    }
    if (added) {
      onChange(next);
      setError(null);
    }
    setDraft('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',' || event.key === 'Tab') {
      if (!draft.trim()) return;
      event.preventDefault();
      commitDraft();
      return;
    }
    if (event.key === 'Backspace' && !draft && value.length) {
      event.preventDefault();
      onChange(value.slice(0, -1));
    }
  };

  const remove = (tag: string) => {
    onChange(value.filter(existing => existing !== tag));
    setError(null);
  };

  return (
    <div className="tag-input-wrap">
      <div className={`tag-input${disabled ? ' tag-input-disabled' : ''}`}>
        {value.map(tag => (
          <span className="tag-chip" key={tag}>
            {tag}
            {!disabled && (
              <button type="button" onClick={() => remove(tag)} aria-label={`Remove tag ${tag}`}>
                <X size={11} />
              </button>
            )}
          </span>
        ))}
        <input
          id={id}
          value={draft}
          disabled={disabled}
          onChange={event => {
            setDraft(event.target.value);
            setError(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={commitDraft}
          onPaste={event => {
            const text = event.clipboardData.getData('text');
            if (text.includes(',') || text.includes('\n')) {
              event.preventDefault();
              setDraft(text);
              window.setTimeout(commitDraft, 0);
            }
          }}
          placeholder={value.length >= max ? 'Tag limit reached' : 'Add a tag and press Enter'}
          aria-label="Add a tag"
          autoComplete="off"
          maxLength={TAG_MAX + 8}
        />
      </div>
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : (
        <span className="field-hint">
          Lowercase, {value.length}/{max} used · up to {TAG_MAX} characters each
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

export function InlineEmpty({ icon, message, children }: { icon?: ReactNode; message: string; children?: ReactNode }) {
  return (
    <div className="inline-empty">
      {icon}
      <p>{message}</p>
      {children}
    </div>
  );
}

export function TagList({ tags, limit = 4 }: { tags: string[]; limit?: number }) {
  if (!tags?.length) return null;
  const shown = tags.slice(0, limit);
  const rest = tags.length - shown.length;
  return (
    <span className="tag-row">
      {shown.map(tag => (
        <span className="tag-pill" key={tag}>
          {tag}
        </span>
      ))}
      {rest > 0 && <span className="tag-pill tag-pill-more">+{rest}</span>}
    </span>
  );
}
