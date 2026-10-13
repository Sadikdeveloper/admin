import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  Check,
  CloudUpload,
  Download,
  Image as ImageIcon,
  ImageOff,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';
import * as blogApi from '../../api/blog';
import type { BlogMediaAsset } from '../../api/blog';
import { Modal } from '../../components/Modal';
import { formatBytes, relativeTime, ACCEPTED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from '../../lib/blog';
import { sanitizeUrl } from '../../lib/blog-html';
import { fetchRemoteImage } from '../../lib/blog-images';
import { useImageUpload } from './useImageUpload';

export type PickedImage = { src: string; alt?: string; caption?: string; name?: string };

type Tab = 'library' | 'upload' | 'url';

const PAGE_SIZE = 24;

function mediaName(asset: BlogMediaAsset): string {
  const key = asset.storageKey || asset.publicUrl;
  return key.split('/').filter(Boolean).pop() ?? 'image';
}

/** An image that degrades gracefully when a CDN blocks or loses it. */
function Thumb({ src, alt, className = '' }: { src: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  if (failed) {
    return (
      <span className={`thumb thumb-failed ${className}`} title="This image could not be loaded">
        <ImageOff size={18} />
      </span>
    );
  }
  return (
    <span className={`thumb ${className}`}>
      <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />
    </span>
  );
}

/**
 * The media picker: browse what is already on the Rown CDN, upload something
 * new, or point the post at an image that already lives elsewhere on the web.
 */
export function MediaLibraryDialog({
  open,
  onClose,
  onSelect,
  title = 'Add an image',
  description,
  withCaption = false,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (image: PickedImage) => void;
  title?: string;
  description?: string;
  withCaption?: boolean;
}) {
  const [tab, setTab] = useState<Tab>('library');
  const [assets, setAssets] = useState<BlogMediaAsset[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const [pending, setPending] = useState<PickedImage | null>(null);
  const [alt, setAlt] = useState('');
  const [caption, setCaption] = useState('');

  const [urlValue, setUrlValue] = useState('');
  const [urlPreview, setUrlPreview] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [importing, setImporting] = useState(false);
  const [actionError, setActionError] = useState<{ message: string; detail?: string } | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [dropActive, setDropActive] = useState(false);
  const uploader = useImageUpload();

  const loadLibrary = useCallback(async (target: number, mode: 'replace' | 'append') => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await blogApi.listMedia({ page: target, limit: PAGE_SIZE });
      setAssets(current => (mode === 'append' ? [...current, ...result.items] : result.items));
      setPage(result.pagination.page || target);
      setTotalPages(result.pagination.totalPages || 1);
      setTotal(result.pagination.total || 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The media library could not be loaded.';
      setLoadError(message);
      if (mode === 'replace') setAssets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setTab('library');
    setPending(null);
    setAlt('');
    setCaption('');
    setUrlValue('');
    setUrlPreview('idle');
    setActionError(null);
    setActionNote(null);
    setFilter('');
    void loadLibrary(1, 'replace');
  }, [open, loadLibrary]);

  /* ---- choosing ---- */

  const choose = (image: PickedImage) => {
    setPending(image);
    setActionError(null);
    if (image.alt !== undefined) setAlt(image.alt);
  };

  const confirmSelection = () => {
    if (!pending) return;
    const src = sanitizeUrl(pending.src, false);
    if (!src) {
      setActionError({ message: 'That image address is not allowed. Use an https:// URL or a library image.' });
      return;
    }
    onSelect({
      ...pending,
      src,
      alt: alt.trim() || undefined,
      caption: withCaption ? caption.trim() || undefined : undefined,
    });
    onClose();
  };

  /* ---- uploading ---- */

  const handleFiles = async (files: File[]) => {
    setActionError(null);
    setActionNote(null);
    if (!files.length) return;

    const results = await uploader.uploadFiles(files);
    const uploaded = results.filter(result => result.ok);
    const failed = results.filter(result => !result.ok);

    if (uploaded.length) {
      const last = uploaded[uploaded.length - 1];
      if (last.ok) {
        choose({ src: last.asset.publicUrl, name: mediaName(last.asset), alt: '' });
        setActionNote(
          uploaded.length === 1
            ? 'Image uploaded to the Rown CDN.'
            : `${uploaded.length} images uploaded to the Rown CDN.`,
        );
      }
      void loadLibrary(1, 'replace');
    }
    if (failed.length) {
      const first = failed[0];
      if (!first.ok) setActionError({ message: first.problem.message, detail: first.problem.detail });
    }
  };

  const onFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    void handleFiles(files);
  };

  /* ---- importing from a URL ---- */

  const importFromUrl = async () => {
    setActionError(null);
    setActionNote(null);
    const url = urlValue.trim();
    if (!url) {
      setActionError({ message: 'Paste the image address first.' });
      return;
    }
    setImporting(true);
    try {
      const file = await fetchRemoteImage(url);
      const result = await uploader.uploadOne(file);
      if (!result.ok) {
        setActionError({ message: result.problem.message, detail: result.problem.detail });
        return;
      }
      choose({ src: result.asset.publicUrl, name: mediaName(result.asset), alt: '' });
      setActionNote('Copied to the Rown CDN — the post no longer depends on that website.');
      void loadLibrary(1, 'replace');
    } catch (error) {
      const problem =
        error instanceof Error
          ? { message: error.message, detail: (error as { problem?: { detail?: string } }).problem?.detail }
          : { message: 'That image could not be downloaded.' };
      setActionError(problem);
    } finally {
      setImporting(false);
    }
  };

  const filtered = filter.trim()
    ? assets.filter(asset =>
        `${mediaName(asset)} ${asset.contentType} ${asset.storageKey}`.toLowerCase().includes(filter.trim().toLowerCase()),
      )
    : assets;

  const urlIsSafe = sanitizeUrl(urlValue, false) !== null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description ?? 'Upload to the Rown CDN, reuse something already in the library, or link an image from anywhere on the web.'}
      size="lg"
      className="media-modal"
      footer={
        <div className="media-footer">
          <div className="media-footer-fields">
            <label className="field field-inline">
              <span className="field-label">Alt text</span>
              <input
                value={alt}
                onChange={event => setAlt(event.target.value)}
                placeholder="Describe the image for screen readers and search"
                maxLength={250}
                disabled={!pending}
              />
            </label>
            {withCaption && (
              <label className="field field-inline">
                <span className="field-label">Caption</span>
                <input
                  value={caption}
                  onChange={event => setCaption(event.target.value)}
                  placeholder="Optional line under the image"
                  maxLength={250}
                  disabled={!pending}
                />
              </label>
            )}
          </div>
          <div className="media-footer-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={confirmSelection} disabled={!pending}>
              <Check size={15} />
              {pending ? 'Use this image' : 'Pick an image'}
            </button>
          </div>
        </div>
      }
    >
      <div className="media-tabs" role="tablist" aria-label="Image source">
        <button type="button" role="tab" aria-selected={tab === 'library'} className={tab === 'library' ? 'selected' : ''} onClick={() => setTab('library')}>
          <ImageIcon size={14} />
          Library
        </button>
        <button type="button" role="tab" aria-selected={tab === 'upload'} className={tab === 'upload' ? 'selected' : ''} onClick={() => setTab('upload')}>
          <Upload size={14} />
          Upload
        </button>
        <button type="button" role="tab" aria-selected={tab === 'url'} className={tab === 'url' ? 'selected' : ''} onClick={() => setTab('url')}>
          <Link2 size={14} />
          From a URL
        </button>
      </div>

      {actionNote && (
        <p className="inline-note inline-note-ok" role="status">
          <Check size={13} />
          {actionNote}
        </p>
      )}
      {actionError && (
        <p className="inline-note inline-note-bad" role="alert">
          <TriangleAlert size={13} />
          <span>
            {actionError.message}
            {actionError.detail && <small>{actionError.detail}</small>}
          </span>
        </p>
      )}
      {uploader.storageProblem && tab !== 'url' && (
        <p className="inline-note inline-note-warn" role="status">
          <TriangleAlert size={13} />
          <span>
            {uploader.storageProblem.message}
            {uploader.storageProblem.detail && <small>{uploader.storageProblem.detail}</small>}
          </span>
        </p>
      )}

      {pending && (
        <div className="media-selection" role="status">
          <Thumb src={pending.src} alt={alt || pending.name || 'Selected image'} className="media-selection-thumb" />
          <div className="media-selection-text">
            <strong>Selected</strong>
            <span className="break-anywhere">{pending.name || pending.src}</span>
          </div>
          <button type="button" className="icon-button" aria-label="Clear selection" onClick={() => setPending(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      {tab === 'library' && (
        <div className="media-library">
          <div className="media-toolbar">
            <div className="search-input search-input-sm">
              <Search size={15} />
              <input
                value={filter}
                onChange={event => setFilter(event.target.value)}
                placeholder="Filter loaded images by name"
                aria-label="Filter images"
              />
              {filter && (
                <button type="button" className="search-clear" onClick={() => setFilter('')} aria-label="Clear filter">
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="media-toolbar-actions">
              <span className="count">{total ? `${total} image${total === 1 ? '' : 's'}` : ''}</span>
              <button
                type="button"
                className="icon-button"
                onClick={() => void loadLibrary(1, 'replace')}
                disabled={loading}
                aria-label="Refresh library"
                title="Refresh library"
              >
                <RefreshCw size={15} className={loading ? 'spin' : ''} />
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTab('upload')}>
                <Upload size={14} />
                Upload
              </button>
            </div>
          </div>

          {loadError && !loading && (
            <div className="inline-empty">
              <p>{loadError}</p>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadLibrary(1, 'replace')}>
                Try again
              </button>
            </div>
          )}

          {loading && !assets.length ? (
            <div className="media-grid">
              {Array.from({ length: 8 }, (_, index) => (
                <div className="media-tile skeleton" key={index}>
                  <span className="skel-thumb" />
                  <span className="skel-line" />
                </div>
              ))}
            </div>
          ) : filtered.length ? (
            <>
              <div className="media-grid">
                {filtered.map(asset => (
                  <button
                    type="button"
                    key={asset.id}
                    className={`media-tile${pending?.src === asset.publicUrl ? ' selected' : ''}`}
                    onClick={() => choose({ src: asset.publicUrl, name: mediaName(asset), alt: '' })}
                    title={`${mediaName(asset)} · ${formatBytes(asset.sizeBytes)}`}
                  >
                    <Thumb src={asset.publicUrl} alt={mediaName(asset)} className="media-tile-thumb" />
                    <span className="media-tile-meta">
                      <strong>{mediaName(asset)}</strong>
                      <span>
                        {formatBytes(asset.sizeBytes)} · {relativeTime(asset.createdAt)}
                      </span>
                    </span>
                    {pending?.src === asset.publicUrl && (
                      <span className="media-tile-check" aria-hidden="true">
                        <Check size={13} />
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {page < totalPages && (
                <div className="media-more">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadLibrary(page + 1, 'append')} disabled={loading}>
                    {loading ? <Loader2 size={14} className="spin" /> : null}
                    Load more
                  </button>
                </div>
              )}
            </>
          ) : (
            !loadError && (
              <div className="inline-empty">
                <ImageIcon size={22} />
                <p>{filter ? 'No loaded images match that filter.' : 'Nothing uploaded yet — add the first image.'}</p>
                {filter ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilter('')}>
                    Clear filter
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setTab('upload')}>
                    <Upload size={14} />
                    Upload an image
                  </button>
                )}
              </div>
            )
          )}
        </div>
      )}

      {tab === 'upload' && (
        <div className="media-upload">
          <div
            ref={dropRef}
            className={`dropzone${dropActive ? ' dropzone-active' : ''}`}
            onDragOver={event => {
              event.preventDefault();
              setDropActive(true);
            }}
            onDragLeave={() => setDropActive(false)}
            onDrop={event => {
              event.preventDefault();
              setDropActive(false);
              void handleFiles(Array.from(event.dataTransfer?.files ?? []));
            }}
          >
            <CloudUpload size={22} />
            <strong>Drop images here</strong>
            <span>
              JPEG, PNG, GIF or WebP · up to {formatBytes(MAX_UPLOAD_BYTES)} each · they are stored on the Rown CDN
            </span>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => fileInputRef.current?.click()} disabled={uploader.busy}>
              {uploader.busy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
              Choose files
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES}
              multiple
              className="visually-hidden"
              onChange={onFileInputChange}
              tabIndex={-1}
              aria-hidden="true"
            />
          </div>

          {uploader.items.length > 0 && (
            <ul className="upload-queue">
              {uploader.items.map(item => (
                <li className={`upload-item upload-${item.status}`} key={item.id}>
                  {item.previewUrl ? (
                    <Thumb src={item.previewUrl} alt={item.name} className="upload-thumb" />
                  ) : (
                    <span className="upload-thumb upload-thumb-icon">
                      <ImageIcon size={15} />
                    </span>
                  )}
                  <span className="upload-text">
                    <strong>{item.name}</strong>
                    {item.status === 'error' && item.problem ? (
                      <span className="upload-error">
                        {item.problem.message}
                        {item.problem.detail && <small>{item.problem.detail}</small>}
                      </span>
                    ) : (
                      <span>
                        {formatBytes(item.size)}
                        {item.status === 'done' ? ' · uploaded' : item.status === 'uploading' ? ' · uploading…' : ' · checking…'}
                      </span>
                    )}
                  </span>
                  {item.status === 'done' && item.asset && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => choose({ src: item.asset!.publicUrl, name: mediaName(item.asset!), alt: '' })}
                    >
                      Use
                    </button>
                  )}
                  {item.status === 'uploading' && <Loader2 size={14} className="spin upload-spin" />}
                  <button type="button" className="upload-dismiss" onClick={() => uploader.dismissItem(item.id)} aria-label={`Dismiss ${item.name}`}>
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'url' && (
        <div className="media-url">
          <label className="field">
            <span className="field-label">Image address</span>
            <input
              value={urlValue}
              onChange={event => {
                setUrlValue(event.target.value);
                setUrlPreview(event.target.value.trim() ? 'loading' : 'idle');
                setActionError(null);
              }}
              placeholder="https://images.unsplash.com/photo-…"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
            />
            <span className="field-hint">
              Must start with https:// (or be a path like /images/cover.png). Anything else is rejected by the API.
            </span>
          </label>

          {urlValue.trim() && (
            <div className="url-preview">
              {urlPreview === 'error' ? (
                <p className="inline-note inline-note-warn">
                  <ImageOff size={14} />
                  <span>
                    That image did not load here. The address may be wrong, or the site may block hotlinking — it can still
                    work on the public blog.
                  </span>
                </p>
              ) : (
                <div className="url-preview-image">
                  <img
                    src={urlValue.trim()}
                    alt="Preview of the image at the address you entered"
                    onLoad={() => setUrlPreview('ok')}
                    onError={() => setUrlPreview('error')}
                  />
                  {urlPreview === 'loading' && (
                    <span className="url-preview-loading">
                      <Loader2 size={15} className="spin" />
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="url-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                const safe = sanitizeUrl(urlValue, false);
                if (!safe) {
                  setActionError({ message: 'That address is not allowed. Use an https:// image URL.' });
                  return;
                }
                choose({ src: safe, name: safe.split('/').filter(Boolean).pop() ?? safe, alt: '' });
              }}
              disabled={!urlIsSafe}
            >
              <Link2 size={15} />
              Use this URL
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void importFromUrl()} disabled={!urlIsSafe || importing}>
              {importing ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
              Save a copy to the Rown CDN
            </button>
          </div>
          <p className="field-hint">
            Saving a copy keeps the image working even if the original site removes it, and it is served from your own CDN.
            Some sites block downloads from a browser; if that happens, use the URL directly instead.
          </p>
        </div>
      )}
    </Modal>
  );
}
