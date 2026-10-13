import { useEffect, useState } from 'react';
import { ImageOff, ImagePlus, Trash2 } from 'lucide-react';
import { COVER_ALT_MAX, mediaUrlProblem } from '../../lib/blog';
import { CharCounter } from './common';

/**
 * Cover image field.
 *
 * Three ways in, because editors work differently: paste any https URL found on
 * the web, pick something already on the Rown CDN, or upload a new file through
 * the media dialog.
 */
export function CoverImageField({
  url,
  alt,
  onUrlChange,
  onAltChange,
  onPick,
  onClear,
  disabled = false,
}: {
  url: string;
  alt: string;
  onUrlChange: (value: string) => void;
  onAltChange: (value: string) => void;
  onPick: () => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const trimmed = url.trim();
  const problem = trimmed ? mediaUrlProblem(trimmed) : null;

  useEffect(() => {
    setFailed(false);
  }, [trimmed]);

  return (
    <div className="cover-field">
      {trimmed && !problem ? (
        <div className={`cover-preview${failed ? ' cover-preview-failed' : ''}`}>
          {failed ? (
            <div className="cover-preview-error">
              <ImageOff size={20} />
              <p>
                This image did not load. The address may be wrong, or the site may block hotlinking. You can keep it if it
                works on the blog, but swapping it for a Rown CDN image is safer.
              </p>
            </div>
          ) : (
            <img src={trimmed} alt={alt || 'Cover preview'} loading="lazy" decoding="async" onError={() => setFailed(true)} />
          )}
        </div>
      ) : (
        <button type="button" className="cover-empty" onClick={onPick} disabled={disabled}>
          <ImagePlus size={20} />
          <strong>Add a cover image</strong>
          <span>Upload one, pick from the library, or paste an https:// address</span>
        </button>
      )}

      <label className="field">
        <span className="field-label">Image address</span>
        <div className="input-row">
          <input
            value={url}
            onChange={event => onUrlChange(event.target.value)}
            placeholder="https://cdn.rown.xyz/blog-media/…"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            aria-invalid={Boolean(problem) || undefined}
          />
          {trimmed && (
            <button type="button" className="icon-button" onClick={onClear} disabled={disabled} aria-label="Remove cover image" title="Remove cover image">
              <Trash2 size={15} />
            </button>
          )}
        </div>
        {problem ? (
          <span className="field-error" role="alert">
            {problem}
          </span>
        ) : (
          <span className="field-hint">HTTPS only — the API rejects http:// cover images.</span>
        )}
      </label>

      <label className="field">
        <span className="field-label">
          Alt text
          <CharCounter value={alt} max={COVER_ALT_MAX} />
        </span>
        <input
          value={alt}
          onChange={event => onAltChange(event.target.value)}
          placeholder="Describe the cover for screen readers and search results"
          maxLength={COVER_ALT_MAX + 40}
          disabled={disabled}
        />
        <span className="field-hint">Shown if the image fails to load, and read aloud by screen readers.</span>
      </label>

      <button type="button" className="btn btn-ghost btn-sm btn-block" onClick={onPick} disabled={disabled}>
        <ImagePlus size={14} />
        {trimmed ? 'Replace image' : 'Browse library or upload'}
      </button>
    </div>
  );
}
