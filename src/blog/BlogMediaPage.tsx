import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CloudUpload,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  ImageOff,
  Info,
  Loader2,
  RefreshCw,
  Search,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';
import type { ChangeEvent, DragEvent } from 'react';
import * as blogApi from '../api/blog';
import type { BlogMediaAsset } from '../api/blog';
import { useToast } from '../components/Toast';
import { Banner } from '../components/ui';
import { copyToClipboard } from '../lib/clipboard';
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  formatBytes,
  formatDateTime,
  relativeTime,
} from '../lib/blog';
import { InlineEmpty, Pagination } from './components/common';
import { useImageUpload } from './components/useImageUpload';
import { Modal } from '../components/Modal';

const PAGE_SIZE = 24;

function mediaName(asset: BlogMediaAsset): string {
  return (asset.storageKey || asset.publicUrl).split('/').filter(Boolean).pop() ?? 'image';
}

function AssetThumb({ asset, size = 'normal' }: { asset: BlogMediaAsset; size?: 'normal' | 'large' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [asset.publicUrl]);

  if (failed) {
    return (
      <span className={`thumb thumb-failed thumb-${size}`}>
        <ImageOff size={size === 'large' ? 22 : 16} />
      </span>
    );
  }
  return (
    <span className={`thumb thumb-${size}`}>
      <img src={asset.publicUrl} alt={mediaName(asset)} loading="lazy" decoding="async" onError={() => setFailed(true)} />
    </span>
  );
}

/**
 * Media library.
 *
 * Images live in the S3-compatible bucket behind the Rown CDN. The API has no
 * delete route (posts may still reference an asset), so this screen is upload,
 * browse and copy — and says so instead of offering a button that cannot work.
 */
export function BlogMediaPage() {
  const toast = useToast();
  const uploader = useImageUpload();

  const [assets, setAssets] = useState<BlogMediaAsset[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [detail, setDetail] = useState<BlogMediaAsset | null>(null);
  const [dropActive, setDropActive] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestSeq = useRef(0);

  const load = useCallback(async (target: number, mode: 'replace' | 'append') => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const result = await blogApi.listMedia({ page: target, limit: PAGE_SIZE });
      if (seq !== requestSeq.current) return;
      setAssets(current => (mode === 'append' ? [...current, ...result.items] : result.items));
      setPage(result.pagination.page || target);
      setTotalPages(result.pagination.totalPages || 1);
      setTotal(result.pagination.total || 0);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setError(e instanceof Error ? e.message : 'The media library could not be loaded.');
      if (mode === 'replace') setAssets([]);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(1, 'replace');
  }, [load]);

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const results = await uploader.uploadFiles(files);
      const uploaded = results.filter(result => result.ok).length;
      const failure = results.find(result => !result.ok);

      if (uploaded) {
        toast.success(uploaded === 1 ? 'Image uploaded' : `${uploaded} images uploaded`, 'They are on the Rown CDN and ready to use.');
        void load(1, 'replace');
        window.dispatchEvent(new Event('rown:blog-changed'));
      }
      if (!failure || failure.ok) return;
      toast.error(failure.problem.message, failure.problem.detail);
    },
    [load, toast, uploader],
  );

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    void handleFiles(files);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDropActive(false);
    void handleFiles(Array.from(event.dataTransfer?.files ?? []));
  };

  const copyUrl = async (asset: BlogMediaAsset) => {
    const ok = await copyToClipboard(asset.publicUrl);
    if (ok) toast.success('Image URL copied', asset.publicUrl);
    else toast.error('Copying failed. Your browser blocked clipboard access.');
  };

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return assets;
    return assets.filter(asset =>
      `${mediaName(asset)} ${asset.storageKey} ${asset.contentType}`.toLowerCase().includes(needle),
    );
  }, [assets, filter]);

  const storageUsed = useMemo(() => assets.reduce((sum, asset) => sum + (asset.sizeBytes || 0), 0), [assets]);

  return (
    <>
      <header className="content-head">
        <div>
          <p className="eyebrow">CONTENT / MEDIA</p>
          <h1>Media library</h1>
          <p className="subtle">
            Images uploaded here are stored on the Rown CDN and can be reused in any post. JPEG, PNG, GIF and WebP up to{' '}
            {formatBytes(MAX_UPLOAD_BYTES)}.
          </p>
        </div>
        <div className="header-actions">
          <button
            className="icon-button"
            onClick={() => void load(1, 'replace')}
            disabled={loading}
            title="Refresh library"
            aria-label="Refresh library"
          >
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
          <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()} disabled={uploader.busy}>
            {uploader.busy ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}
            Upload image
          </button>
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        multiple
        className="visually-hidden"
        onChange={onFileInput}
        tabIndex={-1}
        aria-hidden="true"
      />

      {error && <Banner tone="error" message={error} onDismiss={() => setError(null)} />}
      {uploader.storageProblem && (
        <Banner
          tone="info"
          message={`${uploader.storageProblem.message} ${uploader.storageProblem.detail ?? ''}`}
          onDismiss={() => uploader.setStorageProblem(null)}
        />
      )}

      <section className="panel media-upload-panel">
        <div
          className={`dropzone${dropActive ? ' dropzone-active' : ''}`}
          onDragOver={event => {
            event.preventDefault();
            setDropActive(true);
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={onDrop}
        >
          <CloudUpload size={22} />
          <strong>Drop images anywhere in this box</strong>
          <span>
            They are checked in the browser first (type, size and real file signature), then uploaded to the CDN — one at a
            time so the 15-per-minute limit is never hit.
          </span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => fileInputRef.current?.click()} disabled={uploader.busy}>
            {uploader.busy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
            Choose files
          </button>
        </div>

        {uploader.items.length > 0 && (
          <ul className="upload-queue">
            {uploader.items.map(item => (
              <li className={`upload-item upload-${item.status}`} key={item.id}>
                {item.previewUrl ? (
                  <span className="thumb upload-thumb">
                    <img src={item.previewUrl} alt={item.name} />
                  </span>
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
                      {item.status === 'done'
                        ? ' · uploaded'
                        : item.status === 'uploading'
                          ? ' · uploading…'
                          : ' · checking the file…'}
                    </span>
                  )}
                </span>
                {item.status === 'done' && item.asset && (
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => void copyUrl(item.asset!)}>
                    <Copy size={12} />
                    Copy URL
                  </button>
                )}
                {item.status === 'uploading' && <Loader2 size={14} className="spin upload-spin" />}
                <button
                  type="button"
                  className="upload-dismiss"
                  onClick={() => uploader.dismissItem(item.id)}
                  aria-label={`Dismiss ${item.name}`}
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {uploader.items.length > 0 && (
          <div className="upload-queue-foot">
            <button type="button" className="btn-link" onClick={uploader.clearItems}>
              Clear the list
            </button>
          </div>
        )}
      </section>

      <section className="toolbar cms-toolbar">
        <div className="search-input search-input-sm cms-search">
          <Search size={15} />
          <input
            value={filter}
            onChange={event => setFilter(event.target.value)}
            placeholder="Filter loaded images by name or type"
            aria-label="Filter images"
          />
          {filter && (
            <button type="button" className="search-clear" onClick={() => setFilter('')} aria-label="Clear filter">
              <X size={13} />
            </button>
          )}
        </div>
        <span className="updated">
          {total ? `${total.toLocaleString()} image${total === 1 ? '' : 's'}` : loading ? 'Loading…' : 'No images yet'}
          {storageUsed > 0 && ` · ${formatBytes(storageUsed)} loaded`}
        </span>
      </section>

      <section className="panel cms-panel">
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
            <div className="media-grid media-grid-page">
              {filtered.map(asset => (
                <div className="media-card" key={asset.id}>
                  <button type="button" className="media-card-main" onClick={() => setDetail(asset)} title={`Open details for ${mediaName(asset)}`}>
                    <AssetThumb asset={asset} />
                    <span className="media-card-meta">
                      <strong>{mediaName(asset)}</strong>
                      <span>
                        {formatBytes(asset.sizeBytes)} · {asset.contentType.replace('image/', '').toUpperCase()} ·{' '}
                        {relativeTime(asset.createdAt)}
                      </span>
                    </span>
                  </button>
                  <div className="media-card-actions">
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => void copyUrl(asset)}>
                      <Copy size={12} />
                      Copy URL
                    </button>
                    <a className="btn btn-ghost btn-xs" href={asset.publicUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink size={12} />
                      Open
                    </a>
                  </div>
                </div>
              ))}
            </div>
            <Pagination
              page={page}
              limit={PAGE_SIZE}
              total={total}
              totalPages={totalPages}
              onChange={next => {
                void load(next, 'replace');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              loading={loading}
              noun="images"
            />
          </>
        ) : (
          <InlineEmpty
            icon={<ImageIcon size={24} />}
            message={
              error
                ? 'The library could not be loaded.'
                : filter
                  ? 'No loaded images match that filter.'
                  : 'No images yet. Upload the first one — it will be available to every post.'
            }
          >
            {filter ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilter('')}>
                Clear filter
              </button>
            ) : (
              !error && (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => fileInputRef.current?.click()}>
                  <Upload size={14} />
                  Upload an image
                </button>
              )
            )}
          </InlineEmpty>
        )}
      </section>

      <p className="cms-footnote">
        <Info size={12} />
        Images cannot be deleted from the console: a published post may still point at them. The API keeps them, and object
        names are generated, so no original filenames are exposed.
      </p>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? mediaName(detail) : 'Image'}
        description="Everything the API stores about this asset."
        size="md"
        footer={
          detail && (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setDetail(null)}>
                Close
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void copyUrl(detail)}>
                <Copy size={15} />
                Copy URL
              </button>
            </>
          )
        }
      >
        {detail && (
          <div className="asset-detail">
            <AssetThumb asset={detail} size="large" />
            <dl className="asset-meta">
              <dt>Public URL</dt>
              <dd>
                <code className="break-anywhere">{detail.publicUrl}</code>
              </dd>
              <dt>Storage key</dt>
              <dd>
                <code className="break-anywhere">{detail.storageKey}</code>
              </dd>
              <dt>Type</dt>
              <dd>{detail.contentType}</dd>
              <dt>Size</dt>
              <dd>{formatBytes(detail.sizeBytes)}</dd>
              <dt>Uploaded</dt>
              <dd>
                {formatDateTime(detail.createdAt)}
                <span>{relativeTime(detail.createdAt)}</span>
              </dd>
              <dt>Uploaded by</dt>
              <dd>
                <code>{detail.uploadedByAdminAddress}</code>
              </dd>
            </dl>
            <p className="inline-note inline-note-warn">
              <TriangleAlert size={13} />
              <span>Paste this URL into any post — as a cover image or inside the article.</span>
            </p>
            <a className="btn btn-ghost btn-sm btn-block" href={detail.publicUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} />
              Open in a new tab
            </a>
          </div>
        )}
      </Modal>
    </>
  );
}
