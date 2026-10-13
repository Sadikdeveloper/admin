import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../../components/Modal';
import { sanitizeBlogHtml } from '../../lib/blog-html';

/** Adds markup at the cursor without replacing the rest of the article. */
export function HtmlSnippetDialog({
  open,
  onClose,
  onInsert,
}: {
  open: boolean;
  onClose: () => void;
  onInsert: (html: string) => void;
}) {
  const [html, setHtml] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const clean = useMemo(() => sanitizeBlogHtml(html), [html]);

  useEffect(() => {
    if (open) setHtml('');
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Insert HTML at the cursor"
      description="Add a heading, formatted text, a code sample, a table or an image between your tutorial steps. The rest of the article stays in place."
      initialFocus={inputRef}
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!clean.trim()}
            onClick={() => {
              onInsert(clean);
              onClose();
            }}
          >
            Insert into article
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">HTML snippet</span>
        <textarea
          ref={inputRef}
          className="rte-html-input"
          aria-label="HTML snippet"
          value={html}
          onChange={event => setHtml(event.target.value)}
          spellCheck={false}
          placeholder={'<h2>Step 2</h2>\n<p>Explain this step…</p>\n<figure><img src="https://example.com/step-2.png" alt="Step 2"><figcaption>Your caption</figcaption></figure>'}
        />
        <span className="field-hint">
          Supported HTML includes paragraphs, headings, links, lists, quotes, code, tables, images and captions.
          Scripts, event handlers, inline styles and embeds are removed for safety.
        </span>
      </label>
      <section className="rte-html-preview" aria-label="HTML snippet preview">
        <p className="eyebrow">PREVIEW</p>
        {clean.trim() ? (
          <div className="blog-prose" dangerouslySetInnerHTML={{ __html: clean }} />
        ) : (
          <p className="subtle">Enter supported HTML to see how it will look.</p>
        )}
      </section>
      {html.trim() && clean !== html.trim() && (
        <p className="rte-notice" role="status">The preview uses cleaned HTML. Unsupported markup and unsafe attributes will not be inserted.</p>
      )}
    </Modal>
  );
}
