import { useMemo, useState } from 'react';
import { Eye, Monitor, Smartphone } from 'lucide-react';
import { Modal } from '../../components/Modal';
import { countWords, htmlToPlainText, readingMinutes, sanitizeBlogHtml } from '../../lib/blog-html';
import { formatDateTime } from '../../lib/blog';

export type PreviewPost = {
  title: string;
  slug: string;
  excerpt?: string | null;
  html: string;
  coverImageUrl?: string | null;
  coverImageAlt?: string | null;
  category?: string | null;
  tags?: string[];
  authorName?: string | null;
  publishedAt?: string | null;
  state: 'draft' | 'scheduled' | 'published';
};

const STATE_NOTE: Record<PreviewPost['state'], string> = {
  draft: 'This is a draft — readers cannot see it yet.',
  scheduled: 'This post is scheduled and stays hidden until its publish time.',
  published: 'This is what readers see right now.',
};

/**
 * Reader preview.
 *
 * Rendered from the draft in the editor (not from the public API), so an
 * unpublished post can still be checked. HTML is sanitized again here because
 * this is the one place the console injects stored markup into the page.
 */
export function PostPreviewDialog({ open, onClose, post }: { open: boolean; onClose: () => void; post: PreviewPost }) {
  const [device, setDevice] = useState<'wide' | 'phone'>('wide');
  const [coverFailed, setCoverFailed] = useState(false);

  const html = useMemo(() => sanitizeBlogHtml(post.html), [post.html]);
  const words = useMemo(() => countWords(htmlToPlainText(html)), [html]);
  const minutes = readingMinutes(words);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="full"
      className="preview-modal"
      title="Reader preview"
      description={STATE_NOTE[post.state]}
      footer={
        <div className="preview-foot">
          <div className="segmented" role="group" aria-label="Preview width">
            <button
              type="button"
              className={device === 'wide' ? 'selected' : ''}
              onClick={() => setDevice('wide')}
              aria-pressed={device === 'wide'}
            >
              <Monitor size={14} />
              Wide
            </button>
            <button
              type="button"
              className={device === 'phone' ? 'selected' : ''}
              onClick={() => setDevice('phone')}
              aria-pressed={device === 'phone'}
            >
              <Smartphone size={14} />
              Phone
            </button>
          </div>
          <span className="preview-stat">
            <Eye size={13} />
            {words.toLocaleString()} words · {minutes > 0 ? `${minutes} min read` : 'nothing to read yet'}
          </span>
        </div>
      }
    >
      <div className={`preview-stage preview-${device}`}>
        <article className="preview-sheet">
          {post.coverImageUrl && !coverFailed && (
            <img
              className="preview-cover"
              src={post.coverImageUrl}
              alt={post.coverImageAlt || ''}
              onError={() => setCoverFailed(true)}
            />
          )}
          {post.coverImageUrl && coverFailed && (
            <p className="preview-cover-error">The cover image did not load — check the address before publishing.</p>
          )}

          <div className="preview-body blog-prose">
            {post.category && <p className="preview-category">{post.category}</p>}
            <h1>{post.title || 'Untitled post'}</h1>
            <p className="preview-meta">
              <span>{post.authorName || 'Rown Team'}</span>
              {post.publishedAt && <span>{formatDateTime(post.publishedAt)}</span>}
              {minutes > 0 && <span>{minutes} min read</span>}
            </p>
            {post.excerpt?.trim() && <p className="preview-excerpt">{post.excerpt}</p>}
            {html ? (
              <div dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <p className="preview-empty">
                Nothing written yet. Add content in the editor and it will appear here exactly as readers will see it.
              </p>
            )}
            {Boolean(post.tags?.length) && (
              <div className="preview-tags">
                {post.tags?.map(tag => (
                  <span className="tag-pill" key={tag}>
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </article>
      </div>
    </Modal>
  );
}
