import { Search } from 'lucide-react';
import { SEO_DESCRIPTION_MAX, SEO_TITLE_MAX, CANONICAL_MAX, canonicalUrlProblem, publicSiteUrl } from '../../lib/blog';
import { CharCounter } from './common';

/** Search results truncate around these lengths; going over is allowed but warned about. */
const TITLE_SOFT_LIMIT = 60;
const DESCRIPTION_SOFT_LIMIT = 160;

function displayHost(): string {
  const base = publicSiteUrl();
  if (!base) return 'rown.xyz';
  try {
    return new URL(base).host;
  } catch {
    return 'rown.xyz';
  }
}

/**
 * SEO fields with a live search-result preview, so an operator can see the
 * truncation before it happens on Google.
 */
export function SeoPanel({
  slug,
  title,
  excerpt,
  canonicalUrl,
  seoTitle,
  seoDescription,
  onChange,
  disabled = false,
}: {
  slug: string;
  title: string;
  excerpt: string;
  canonicalUrl: string;
  seoTitle: string;
  seoDescription: string;
  onChange: (patch: { canonicalUrl?: string; seoTitle?: string; seoDescription?: string }) => void;
  disabled?: boolean;
}) {
  const canonicalProblem = canonicalUrl.trim() ? canonicalUrlProblem(canonicalUrl) : null;
  const effectiveTitle = seoTitle.trim() || title.trim() || 'Untitled post';
  const effectiveDescription = seoDescription.trim() || excerpt.trim();

  return (
    <div className="seo-panel">
      <div className="seo-snippet" aria-hidden="true">
        <span className="seo-snippet-url">
          <Search size={11} />
          {displayHost()}
          <span> › blog › {slug.trim() || 'your-slug'}</span>
        </span>
        <strong className={`seo-snippet-title${effectiveTitle.length > TITLE_SOFT_LIMIT ? ' too-long' : ''}`}>
          {effectiveTitle}
        </strong>
        {effectiveDescription ? (
          <p className={`seo-snippet-desc${effectiveDescription.length > DESCRIPTION_SOFT_LIMIT ? ' too-long' : ''}`}>
            {effectiveDescription}
          </p>
        ) : (
          <p className="seo-snippet-desc seo-snippet-missing">No description yet — search engines will guess one.</p>
        )}
      </div>

      <label className="field">
        <span className="field-label">
          Search title
          <CharCounter value={seoTitle} max={SEO_TITLE_MAX} />
        </span>
        <input
          value={seoTitle}
          onChange={event => onChange({ seoTitle: event.target.value })}
          placeholder={title.trim() || 'Building better financial tools | Rown'}
          maxLength={SEO_TITLE_MAX + 40}
          disabled={disabled}
        />
        <span className="field-hint">
          {seoTitle.trim().length > TITLE_SOFT_LIMIT
            ? `Longer than the ~${TITLE_SOFT_LIMIT} characters search results usually show — it will be cut off.`
            : 'Defaults to the post title. Add “| Rown” if you want the brand in results.'}
        </span>
      </label>

      <label className="field">
        <span className="field-label">
          Search description
          <CharCounter value={seoDescription} max={SEO_DESCRIPTION_MAX} />
        </span>
        <textarea
          value={seoDescription}
          onChange={event => onChange({ seoDescription: event.target.value })}
          placeholder={excerpt.trim() || 'A one or two sentence summary that convinces someone to click.'}
          rows={3}
          maxLength={SEO_DESCRIPTION_MAX + 60}
          disabled={disabled}
        />
        <span className="field-hint">
          {seoDescription.trim().length > DESCRIPTION_SOFT_LIMIT
            ? `Longer than the ~${DESCRIPTION_SOFT_LIMIT} characters search results usually show.`
            : 'Defaults to the excerpt when left empty.'}
        </span>
      </label>

      <label className="field">
        <span className="field-label">
          Canonical URL
          <CharCounter value={canonicalUrl} max={CANONICAL_MAX} />
        </span>
        <input
          value={canonicalUrl}
          onChange={event => onChange({ canonicalUrl: event.target.value })}
          placeholder="https://rown.xyz/blog/…"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          aria-invalid={Boolean(canonicalProblem) || undefined}
        />
        {canonicalProblem ? (
          <span className="field-error" role="alert">
            {canonicalProblem}
          </span>
        ) : (
          <span className="field-hint">Only needed when this post was first published somewhere else.</span>
        )}
      </label>
    </div>
  );
}
