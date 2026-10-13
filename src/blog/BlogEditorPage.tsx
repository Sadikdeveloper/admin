import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CalendarClock,
  Check,
  CircleAlert,
  ExternalLink,
  Eye,
  Info,
  Loader2,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import * as blogApi from '../api/blog';
import type { BlogPost, BlogPostInput } from '../api/blog';
import { ApiError } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Banner } from '../components/ui';
import { useToast } from '../components/Toast';
import { copyToClipboard } from '../lib/clipboard';
import {
  AUTHOR_MAX,
  CANONICAL_MAX,
  CATEGORY_MAX,
  COVER_ALT_MAX,
  EXCERPT_MAX,
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
  SLUG_MAX,
  SLUG_PATTERN,
  TAGS_MAX,
  TITLE_MAX,
  canonicalUrlProblem,
  formatDateTime,
  fromLocalInputValue,
  mediaUrlProblem,
  postState,
  publicPostUrl,
  relativeTime,
  scheduleProblem,
  slugify,
  toLocalInputValue,
} from '../lib/blog';
import { cleanEditorHtml, countWords, excerptFromHtml, htmlToPlainText } from '../lib/blog-html';
import { htmlToDocument } from '../lib/blog-doc';
import {
  BLANK_POST_FORM,
  categorySuggestions,
  clearDraft,
  draftKeyFor,
  formFromPost,
  readDraft,
  rememberTaxonomy,
  tagSuggestions,
  writeDraft,
} from '../lib/blog-draft';
import type { PostForm, StoredDraft } from '../lib/blog-draft';
import { navGuard } from '../lib/nav-guard';
import { routeToHash } from '../lib/routes';
import type { Route } from '../lib/routes';
import { CharCounter, PostStatePill, TagInput } from './components/common';
import { CoverImageField } from './components/CoverImageField';
import { MediaLibraryDialog } from './components/MediaLibraryDialog';
import type { PickedImage } from './components/MediaLibraryDialog';
import { PostPreviewDialog } from './components/PostPreviewDialog';
import type { PreviewPost } from './components/PostPreviewDialog';
import { RichTextEditor } from './components/RichTextEditor';
import type { RichTextEditorHandle } from './components/RichTextEditor';
import { SeoPanel } from './components/SeoPanel';
import { uploadBlogImage } from '../lib/blog-images';

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const FIELD_PATTERNS: [RegExp, string][] = [
  [/\btitle\b/i, 'title'],
  [/\bslug\b/i, 'slug'],
  [/\bexcerpt\b/i, 'excerpt'],
  [/\bcontent(html)?\b/i, 'content'],
  [/\bcoverimageurl\b/i, 'coverImageUrl'],
  [/\bcoverimagealt\b/i, 'coverImageAlt'],
  [/\bcategory\b/i, 'category'],
  [/\btags?\b/i, 'tags'],
  [/\bauthorname\b/i, 'authorName'],
  [/\bcanonicalurl\b/i, 'canonicalUrl'],
  [/\bseotitle\b/i, 'seoTitle'],
  [/\bseodescription\b/i, 'seoDescription'],
  [/\bpublishat\b/i, 'schedule'],
];

/** Points server-side validation failures at the right input. */
function mapServerMessages(messages: string[]): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const message of messages) {
    const field = FIELD_PATTERNS.find(([pattern]) => pattern.test(message))?.[1];
    if (field && !mapped[field]) mapped[field] = message;
  }
  return mapped;
}

function lengthProblem(value: string, max: number, label: string): string | null {
  const length = value.trim().length;
  if (length <= max) return null;
  return `${label} must be ${max.toLocaleString()} characters or fewer — this is ${length.toLocaleString()}.`;
}

export function hasPublishableContent(html: string): boolean {
  const clean = cleanEditorHtml(html);
  if (!clean) return false;
  if (/<(img|hr|iframe|table|pre|li)\b/i.test(clean)) return true;
  return countWords(htmlToPlainText(clean)) > 0;
}

function validateForm(form: PostForm, options: { publishing: boolean }): Record<string, string> {
  const errors: Record<string, string> = {};

  const title = form.title.trim();
  if (!title) errors.title = 'Give the post a title — the API rejects an empty one.';
  else {
    const problem = lengthProblem(form.title, TITLE_MAX, 'The title');
    if (problem) errors.title = problem;
  }

  const slug = form.slug.trim();
  if (slug.length > SLUG_MAX) errors.slug = `The slug must be ${SLUG_MAX} characters or fewer.`;
  else if (slug && !SLUG_PATTERN.test(slug)) {
    errors.slug = 'Use letters, numbers and single hyphens only — for example “paying-with-rown”.';
  }

  const excerptProblem = lengthProblem(form.excerpt, EXCERPT_MAX, 'The excerpt');
  if (excerptProblem) errors.excerpt = excerptProblem;

  const coverProblem = mediaUrlProblem(form.coverImageUrl);
  if (coverProblem) errors.coverImageUrl = coverProblem;
  const coverAltProblem = lengthProblem(form.coverImageAlt, COVER_ALT_MAX, 'The alt text');
  if (coverAltProblem) errors.coverImageAlt = coverAltProblem;

  const categoryProblem = lengthProblem(form.category, CATEGORY_MAX, 'The category');
  if (categoryProblem) errors.category = categoryProblem;

  const authorProblem = lengthProblem(form.authorName, AUTHOR_MAX, 'The author name');
  if (authorProblem) errors.authorName = authorProblem;

  const canonicalProblem = canonicalUrlProblem(form.canonicalUrl);
  if (canonicalProblem) errors.canonicalUrl = canonicalProblem;

  const seoTitleProblem = lengthProblem(form.seoTitle, SEO_TITLE_MAX, 'The search title');
  if (seoTitleProblem) errors.seoTitle = seoTitleProblem;
  const seoDescriptionProblem = lengthProblem(form.seoDescription, SEO_DESCRIPTION_MAX, 'The search description');
  if (seoDescriptionProblem) errors.seoDescription = seoDescriptionProblem;

  if (form.tags.length > TAGS_MAX) errors.tags = `A post can have at most ${TAGS_MAX} tags.`;

  if (options.publishing && !hasPublishableContent(form.html)) {
    errors.content = 'Write the article before publishing — the API refuses to publish an empty post.';
  }

  return errors;
}

function buildInput(form: PostForm, options: { isNew: boolean }): BlogPostInput {
  const html = cleanEditorHtml(form.html);
  const document = htmlToDocument(html);
  const optional = (value: string) => value.trim() || null;

  return {
    title: form.title.trim(),
    /*
     * `null` means "you decide": on an existing post the API keeps the stored
     * slug, and on a new one it derives a slug from the title and adds a suffix
     * if that is taken. So a slug nobody typed by hand is left to the server —
     * it can de-duplicate, where an explicit slug would only 409.
     */
    slug: options.isNew && !form.slugEdited ? null : form.slug.trim() || null,
    excerpt: optional(form.excerpt),
    content: document ?? null,
    contentHtml: html || null,
    coverImageUrl: optional(form.coverImageUrl),
    coverImageAlt: optional(form.coverImageAlt),
    category: optional(form.category),
    tags: form.tags,
    authorName: optional(form.authorName),
    canonicalUrl: optional(form.canonicalUrl),
    seoTitle: optional(form.seoTitle),
    seoDescription: optional(form.seoDescription),
  };
}

function previewOf(form: PostForm, post: BlogPost | null, state: 'draft' | 'scheduled' | 'published'): PreviewPost {
  return {
    title: form.title.trim() || post?.title || 'Untitled post',
    slug: form.slug.trim() || post?.slug || 'untitled',
    excerpt: form.excerpt.trim() || null,
    html: cleanEditorHtml(form.html),
    coverImageUrl: form.coverImageUrl.trim() || null,
    coverImageAlt: form.coverImageAlt.trim() || null,
    category: form.category.trim() || null,
    tags: form.tags,
    authorName: form.authorName.trim() || post?.authorName || 'Rown Team',
    publishedAt: post?.publishedAt ?? null,
    state,
  };
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

type SaveThen = 'publish' | 'schedule' | 'draft' | null;

export function BlogEditorPage({
  postId,
  adminLabel,
  onNavigate,
}: {
  postId: string | null;
  adminLabel?: string | null;
  onNavigate: (route: Route) => void;
}) {
  const toast = useToast();
  const draftKey = draftKeyFor(postId);

  const [post, setPost] = useState<BlogPost | null>(null);
  const [form, setForm] = useState<PostForm>(BLANK_POST_FORM);
  const [baseline, setBaseline] = useState<string>(() => JSON.stringify(BLANK_POST_FORM));

  const [loading, setLoading] = useState(Boolean(postId));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [remoteChange, setRemoteChange] = useState<BlogPost | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [restoreOffer, setRestoreOffer] = useState<StoredDraft | null>(null);
  const [restoreNote, setRestoreNote] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState<SaveThen | 'save' | 'delete' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [showPreview, setShowPreview] = useState(false);
  const [picker, setPicker] = useState<{ open: boolean; target: 'cover' | 'inline' }>({ open: false, target: 'inline' });

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleValue, setScheduleValue] = useState('');
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const editorRef = useRef<RichTextEditorHandle>(null);
  const loadedId = useRef<string | null>(null);
  const initializedNew = useRef(false);
  const formRef = useRef(form);
  const postRef = useRef<BlogPost | null>(null);

  formRef.current = form;
  postRef.current = post;

  const dirty = JSON.stringify(form) !== baseline;
  const state = post ? postState(post) : 'draft';
  const isPublished = state !== 'draft';

  const patch = useCallback((changes: Partial<PostForm>) => {
    setErrors({});
    setForm(current => {
      const next = { ...current, ...changes };
      // A slug nobody touched keeps following the title, exactly like the API.
      if (changes.title !== undefined && !current.slugEdited) next.slug = slugify(changes.title).slice(0, SLUG_MAX);
      return next;
    });
  }, []);

  const focusField = useCallback((fieldErrors: Record<string, string>) => {
    const first = Object.keys(fieldErrors)[0];
    if (!first) return;
    if (first === 'content') {
      editorRef.current?.focus();
      return;
    }
    const element = document.getElementById(`post-${first}`);
    element?.focus();
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);

  /* ---- loading an existing post ---- */

  const applyPost = useCallback(
    (fresh: BlogPost, options: { keepForm?: boolean } = {}) => {
      setPost(fresh);
      loadedId.current = fresh.id;
      if (!options.keepForm) {
        const next = formFromPost(fresh);
        setForm(next);
        setBaseline(JSON.stringify(next));
      }
    },
    [],
  );

  useEffect(() => {
    if (!postId) {
      loadedId.current = null;
      return;
    }
    if (loadedId.current === postId) return;

    let alive = true;
    loadedId.current = postId;
    setLoading(true);
    setLoadError(null);
    setNotFound(false);
    setRemoteChange(null);

    blogApi
      .getPost(postId)
      .then(fresh => {
        if (!alive) return;
        applyPost(fresh);

        // A local backup newer than the server copy means work was interrupted.
        const draft = readDraft(postId);
        if (draft && new Date(draft.savedAt).getTime() > new Date(fresh.updatedAt).getTime()) {
          setRestoreOffer(draft);
        } else if (draft) {
          clearDraft(postId);
        }
      })
      .catch(error => {
        if (!alive) return;
        loadedId.current = null;
        if (error instanceof ApiError && error.status === 404) {
          setNotFound(true);
          clearDraft(postId);
          return;
        }
        setLoadError(error instanceof Error ? error.message : 'This post could not be loaded.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [postId, applyPost]);

  /* ---- starting a new post ---- */

  useEffect(() => {
    if (postId || initializedNew.current) return;
    initializedNew.current = true;

    const draft = readDraft(null);
    setForm(current => ({
      ...current,
      authorName: current.authorName || adminLabel || '',
      ...(draft ? draft.form : {}),
    }));
    if (draft) {
      setRestoreNote(`We restored the unsaved post you were writing (${formatDateTime(draft.savedAt)}). It lives on this device until you save it.`);
    }
  }, [postId, adminLabel]);

  /* ---- device-local backup ---- */

  useEffect(() => {
    if (loading || notFound) return;
    const timer = window.setTimeout(() => {
      if (JSON.stringify(formRef.current) === baseline) {
        clearDraft(postId);
        return;
      }
      const result = writeDraft(postId, formRef.current);
      if (!result.ok && result.error) setStorageWarning(result.error);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [form, baseline, postId, loading, notFound]);

  /* ---- guards against losing work ---- */

  useEffect(() => {
    if (!dirty || loading) return;
    const ownHash = routeToHash({ name: 'blog-editor', postId });
    return navGuard.register(target =>
      routeToHash(target) === ownHash
        ? null
        : postId
          ? 'You have unsaved changes on this post. A copy stays on this device, but the server will not have them.'
          : 'This new post has not been saved yet. A copy stays on this device, but the server will not have it.',
    );
  }, [dirty, postId, loading]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  /* ---- noticing edits made somewhere else ---- */

  useEffect(() => {
    if (!postId) return;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      const known = postRef.current;
      if (!known || known.id !== postId) return;
      try {
        const fresh = await blogApi.getPost(postId);
        if (fresh.updatedAt !== known.updatedAt && postRef.current?.updatedAt === known.updatedAt) {
          setRemoteChange(fresh);
        }
      } catch {
        /* a background check must never interrupt writing */
      }
    };
    const timer = window.setInterval(check, 120_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, [postId]);

  /* ---- saving ---- */

  const save = useCallback(
    async (options: { then?: SaveThen; publishAt?: string; quiet?: boolean } = {}): Promise<boolean> => {
      const publishing = options.then === 'publish' || options.then === 'schedule';
      const fieldErrors = validateForm(formRef.current, { publishing });
      setErrors(fieldErrors);
      if (Object.keys(fieldErrors).length) {
        setBanner(null);
        focusField(fieldErrors);
        if (!options.quiet) {
          toast.error('Something needs fixing before this can be saved', Object.values(fieldErrors)[0]);
        }
        return false;
      }

      const target = options.then ?? 'save';
      setBusyAction(target);
      setSaving(true);
      setBanner(null);

      try {
        const existingId = postRef.current?.id ?? postId;
        const input = buildInput(formRef.current, { isNew: !existingId });
        const saved = existingId ? await blogApi.updatePost(existingId, input) : await blogApi.createPost(input);

        const normalized = formFromPost(saved);
        applyPost(saved);
        setForm(normalized);
        setBaseline(JSON.stringify(normalized));
        clearDraft(postId);
        setRemoteChange(null);
        setRestoreOffer(null);
        rememberTaxonomy(saved.category, saved.tags);

        if (!existingId) {
          // Swap #/blog/new for the real address without tripping the guard.
          loadedId.current = saved.id;
          navGuard.allowNextChange();
          onNavigate({ name: 'blog-editor', postId: saved.id });
        }

        if (!options.quiet) toast.success(existingId ? 'Changes saved' : 'Draft created', saved.title);
        window.dispatchEvent(new Event('rown:blog-changed'));

        if (options.then === 'publish' || options.then === 'schedule') {
          const published = await blogApi.publishPost(saved.id, options.publishAt);
          setPost(published);
          const scheduled = options.publishAt ? new Date(options.publishAt).getTime() > Date.now() : false;
          toast.success(
            scheduled ? 'Post scheduled' : 'Post published',
            scheduled ? `Readers will see it ${relativeTime(published.publishedAt)}.` : published.title,
          );
          setScheduleOpen(false);
          window.dispatchEvent(new Event('rown:blog-changed'));
        }

        if (options.then === 'draft') {
          const drafted = await blogApi.unpublishPost(saved.id);
          setPost(drafted);
          toast.info('Moved back to drafts', drafted.title);
          window.dispatchEvent(new Event('rown:blog-changed'));
        }

        return true;
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.status === 409) {
            const mapped = mapServerMessages(error.serverMessages);
            setErrors(Object.keys(mapped).length ? mapped : { slug: error.message });
            setBanner(error.message);
            if (!options.quiet) toast.error('That slug is already taken', 'Change it, or edit the other post instead.');
            return false;
          }
          if (error.status === 400 || error.status === 422) {
            const mapped = mapServerMessages(error.serverMessages);
            if (Object.keys(mapped).length) setErrors(mapped);
            setBanner(error.message);
            if (!options.quiet) toast.error('The server rejected these changes', error.serverMessages[0] ?? error.message);
            return false;
          }
          if (error.status === 404) {
            setBanner('This post no longer exists — someone may have deleted it.');
            if (!options.quiet) toast.error('This post no longer exists');
            return false;
          }
        }
        const message = error instanceof Error ? error.message : 'The post could not be saved.';
        setBanner(message);
        if (!options.quiet) toast.error('Save failed', message);
        return false;
      } finally {
        setSaving(false);
        setBusyAction(null);
      }
    },
    [applyPost, focusField, onNavigate, postId, toast],
  );

  /** Publishes straight away, saving first when there is unsaved work. */
  const publishNow = useCallback(async () => {
    if (isPublished && !dirty) {
      setBusyAction('publish');
      try {
        const published = await blogApi.publishPost(post!.id);
        setPost(published);
        toast.success('Post is live', published.title);
        window.dispatchEvent(new Event('rown:blog-changed'));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'The post could not be published.');
      } finally {
        setBusyAction(null);
      }
      return;
    }
    await save({ then: 'publish' });
  }, [dirty, isPublished, post, save, toast]);

  const applySchedule = useCallback(async () => {
    const date = fromLocalInputValue(scheduleValue);
    const problem = scheduleProblem(date);
    if (problem) {
      setScheduleError(problem);
      return;
    }
    setScheduleError(null);
    const ok = await save({ then: 'schedule', publishAt: date!.toISOString() });
    if (ok) setScheduleValue('');
  }, [save, scheduleValue]);

  const unpublish = useCallback(async () => {
    const target = postRef.current;
    if (!target) return;
    if (dirty) {
      await save({ then: 'draft' });
      return;
    }
    setBusyAction('draft');
    try {
      const drafted = await blogApi.unpublishPost(target.id);
      setPost(drafted);
      toast.info('Moved back to drafts', drafted.title);
      window.dispatchEvent(new Event('rown:blog-changed'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The post could not be unpublished.');
    } finally {
      setBusyAction(null);
    }
  }, [dirty, save, toast]);

  const remove = useCallback(async () => {
    const target = postRef.current;
    if (!target) return;
    setDeleting(true);
    try {
      await blogApi.deletePost(target.id);
      clearDraft(target.id);
      toast.success('Post deleted', target.title);
      window.dispatchEvent(new Event('rown:blog-changed'));
      navGuard.clear();
      onNavigate({ name: 'blog' });
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 404
          ? 'That post was already deleted.'
          : error instanceof Error
            ? error.message
            : 'The post could not be deleted.';
      toast.error(message);
      if (error instanceof ApiError && error.status === 404) onNavigate({ name: 'blog' });
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }, [onNavigate, toast]);

  /* ---- images ---- */

  const handlePickedImage = useCallback(
    (image: PickedImage) => {
      if (picker.target === 'cover') {
        setForm(current => ({
          ...current,
          coverImageUrl: image.src,
          coverImageAlt: current.coverImageAlt.trim() || image.alt?.trim() || image.name || '',
        }));
        setErrors(current => {
          if (!current.coverImageUrl) return current;
          const { coverImageUrl: _ignored, ...rest } = current;
          return rest;
        });
        toast.success('Cover image set');
        return;
      }
      editorRef.current?.insertImage({ src: image.src, alt: image.alt, caption: image.caption });
      toast.success('Image added to the article');
    },
    [picker.target, toast],
  );

  const uploadForEditor = useCallback(
    async (file: File) => {
      try {
        const asset = await uploadBlogImage(file);
        return { src: asset.publicUrl, alt: '' } as const;
      } catch (error) {
        const problem =
          error instanceof Error && 'problem' in error
            ? (error as unknown as { problem: { message: string; detail?: string } }).problem
            : { message: error instanceof Error ? error.message : 'The image could not be uploaded.' };
        toast.error(problem.message, problem.detail);
        return null;
      }
    },
    [toast],
  );

  /* ---- keyboard shortcuts ---- */

  const saveRef = useRef(save);
  const publishRef = useRef(publishNow);
  saveRef.current = save;
  publishRef.current = publishNow;

  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        void saveRef.current({ quiet: false });
      } else if (key === 'enter') {
        event.preventDefault();
        void publishRef.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  /* ---- derived helpers ---- */

  const cleanHtml = useMemo(() => cleanEditorHtml(form.html), [form.html]);
  const imagesMissingAlt = useMemo(() => {
    if (!cleanHtml) return 0;
    try {
      const parsed = new DOMParser().parseFromString(`<body>${cleanHtml}</body>`, 'text/html');
      return Array.from(parsed.querySelectorAll('img')).filter(image => !(image.getAttribute('alt') ?? '').trim()).length;
    } catch {
      return 0;
    }
  }, [cleanHtml]);

  const wordCount = useMemo(() => countWords(htmlToPlainText(cleanHtml)), [cleanHtml]);

  const checklist = useMemo(
    () => [
      { key: 'title', label: 'Title', ok: Boolean(form.title.trim()), required: true },
      { key: 'content', label: 'Article content', ok: hasPublishableContent(form.html), required: true },
      { key: 'slug', label: 'Readable slug', ok: Boolean(form.slug.trim()), required: false },
      { key: 'excerpt', label: 'Excerpt for lists and search', ok: Boolean(form.excerpt.trim()), required: false },
      { key: 'cover', label: 'Cover image', ok: Boolean(form.coverImageUrl.trim()), required: false },
      {
        key: 'alt',
        label: 'Alt text on every image',
        ok: imagesMissingAlt === 0,
        detail: imagesMissingAlt ? `${imagesMissingAlt} image${imagesMissingAlt === 1 ? '' : 's'} missing alt text` : undefined,
        required: false,
      },
      { key: 'category', label: 'Category', ok: Boolean(form.category.trim()), required: false },
      { key: 'tags', label: 'At least one tag', ok: form.tags.length > 0, required: false },
      {
        key: 'seo',
        label: 'Search title and description',
        ok: Boolean(form.seoTitle.trim() && form.seoDescription.trim()),
        required: false,
      },
    ],
    [form, imagesMissingAlt],
  );

  const missingRequired = checklist.filter(item => item.required && !item.ok);
  const missingNice = checklist.filter(item => !item.required && !item.ok);
  const liveUrl = post ? publicPostUrl(post.slug) : null;

  const categories = useMemo(() => categorySuggestions(), [post?.id, form.category]);
  const knownTags = useMemo(() => tagSuggestions(), [post?.id, form.tags.length]);

  /* ---- render ---- */

  if (loading) {
    return (
      <>
        <header className="content-head">
          <div>
            <p className="eyebrow">CONTENT / BLOG</p>
            <h1>Loading post…</h1>
          </div>
        </header>
        <div className="editor-grid">
          <div className="panel editor-loading" role="status" aria-live="polite">
            <Loader2 size={18} className="spin" />
            <span>Fetching the latest version of this post.</span>
          </div>
          <div className="panel editor-loading">
            <span className="skel-line" style={{ width: '70%' }} />
            <span className="skel-line skel-sm" style={{ width: '45%' }} />
            <span className="skel-line skel-lg" style={{ width: '90%' }} />
          </div>
        </div>
      </>
    );
  }

  if (notFound) {
    return (
      <>
        <header className="content-head">
          <div>
            <p className="eyebrow">CONTENT / BLOG</p>
            <h1>Post not found</h1>
            <p className="subtle">It may have been deleted by another operator.</p>
          </div>
        </header>
        <div className="panel">
          <div className="inline-empty">
            <CircleAlert size={22} />
            <p>There is nothing to edit at this address.</p>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onNavigate({ name: 'blog' })}>
              <ArrowLeft size={14} />
              Back to all posts
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="content-head editor-head">
        <div className="editor-head-text">
          <button type="button" className="back-link" onClick={() => onNavigate({ name: 'blog' })}>
            <ArrowLeft size={14} />
            All posts
          </button>
          <p className="eyebrow">CONTENT / {postId ? 'EDIT POST' : 'NEW POST'}</p>
          <h1>{form.title.trim() || post?.title || 'New post'}</h1>
          <div className="editor-head-meta">
            {post ? <PostStatePill state={state} /> : <PostStatePill state="draft" title="Not saved yet" />}
            <span className={`save-state${dirty ? ' save-state-dirty' : ''}`} role="status">
              <i aria-hidden="true" />
              {dirty ? 'Unsaved changes' : postId ? `Saved ${relativeTime(post?.updatedAt)}` : 'Not saved yet'}
            </span>
            {post?.slug && <span className="post-slug">/{post.slug}</span>}
          </div>
        </div>
        <div className="header-actions editor-actions">
          <button type="button" className="icon-button" onClick={() => setShowPreview(true)} title="Preview as a reader" aria-label="Preview as a reader">
            <Eye size={16} />
          </button>
          {liveUrl && (
            <a className="icon-button" href={liveUrl} target="_blank" rel="noopener noreferrer" title="Open the live post" aria-label="Open the live post">
              <ExternalLink size={16} />
            </a>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => void save({})} disabled={saving || Boolean(busyAction)}>
            {saving && busyAction === 'save' ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
            <span className="btn-label">{postId ? 'Save' : 'Save draft'}</span>
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void (isPublished ? save({}) : publishNow())}
            disabled={saving || Boolean(busyAction)}
            title={isPublished ? 'Save changes (Ctrl/⌘ + S)' : 'Publish now (Ctrl/⌘ + Enter)'}
          >
            {busyAction === 'publish' ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
            <span className="btn-label">{isPublished ? 'Save changes' : 'Publish'}</span>
          </button>
        </div>
      </header>

      {loadError && <Banner tone="error" message={loadError} onDismiss={() => setLoadError(null)} />}
      {banner && <Banner tone="error" message={banner} onDismiss={() => setBanner(null)} />}
      {storageWarning && <Banner tone="info" message={storageWarning} onDismiss={() => setStorageWarning(null)} />}
      {restoreNote && <Banner tone="info" message={restoreNote} onDismiss={() => setRestoreNote(null)} />}

      {restoreOffer && (
        <div className="restore-bar" role="status">
          <Info size={15} />
          <span>
            This device has unsaved edits from <strong>{formatDateTime(restoreOffer.savedAt)}</strong>, which is newer than
            the server copy ({formatDateTime(post?.updatedAt)}).
          </span>
          <div className="restore-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                clearDraft(postId);
                setRestoreOffer(null);
                toast.info('Local copy discarded', 'The editor now shows the server version.');
              }}
            >
              Discard local copy
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setForm(restoreOffer.form);
                setRestoreOffer(null);
                setRestoreNote('Local edits restored. Save to push them to the server.');
              }}
            >
              <RefreshCw size={14} />
              Restore my edits
            </button>
          </div>
        </div>
      )}

      {remoteChange && (
        <div className="restore-bar restore-bar-warn" role="alert">
          <TriangleAlert size={15} />
          <span>
            Someone updated this post at <strong>{formatDateTime(remoteChange.updatedAt)}</strong>. Saving now will replace
            their version.
          </span>
          <div className="restore-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setPost(remoteChange);
                setRemoteChange(null);
                toast.info('Kept your version on screen', 'Saving will overwrite their changes.');
              }}
            >
              Keep mine
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                applyPost(remoteChange);
                clearDraft(postId);
                setRemoteChange(null);
                setRestoreOffer(null);
                toast.info('Loaded their version', 'Your local copy was discarded.');
              }}
            >
              <RefreshCw size={14} />
              Load their version
            </button>
          </div>
        </div>
      )}

      <div className="editor-grid">
        <div className="editor-main">
          <section className="panel editor-panel">
            <label className="field field-title">
              <span className="field-label">
                Title
                <CharCounter value={form.title} max={TITLE_MAX} />
              </span>
              <input
                id="post-title"
                value={form.title}
                onChange={event => patch({ title: event.target.value })}
                placeholder="Building better financial tools"
                maxLength={TITLE_MAX + 40}
                aria-invalid={Boolean(errors.title) || undefined}
                autoComplete="off"
              />
              {errors.title && (
                <span className="field-error" role="alert">
                  {errors.title}
                </span>
              )}
            </label>

            <div className="field field-slug">
              <span className="field-label">
                Slug
                <CharCounter value={form.slug} max={SLUG_MAX} />
              </span>
              <div className="slug-row">
                <span className="slug-prefix" aria-hidden="true">
                  /blog/
                </span>
                <input
                  id="post-slug"
                  value={form.slug}
                  onChange={event => patch({ slug: event.target.value.toLowerCase(), slugEdited: true })}
                  placeholder={form.title.trim() ? suggestedSlugPreview(form.title) : 'paying-with-rown'}
                  maxLength={SLUG_MAX + 20}
                  autoCapitalize="off"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={Boolean(errors.slug) || undefined}
                />
                {form.slugEdited && form.title.trim() && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => patch({ slug: slugify(form.title), slugEdited: false })}
                    title="Rebuild the slug from the title"
                  >
                    <Sparkles size={13} />
                    Reset
                  </button>
                )}
              </div>
              {errors.slug ? (
                <span className="field-error" role="alert">
                  {errors.slug}
                </span>
              ) : (
                <span className="field-hint">
                  {form.slug.trim()
                    ? 'Letters, numbers and hyphens. Changing it moves the public address of the post.'
                    : 'Leave empty and the API builds one from the title.'}
                </span>
              )}
            </div>

            <label className="field">
              <span className="field-label">
                Excerpt
                <CharCounter value={form.excerpt} max={EXCERPT_MAX} />
              </span>
              <textarea
                id="post-excerpt"
                value={form.excerpt}
                onChange={event => patch({ excerpt: event.target.value })}
                rows={3}
                maxLength={EXCERPT_MAX + 60}
                placeholder="One or two sentences shown in post lists, search results and social shares."
                aria-invalid={Boolean(errors.excerpt) || undefined}
              />
              {errors.excerpt ? (
                <span className="field-error" role="alert">
                  {errors.excerpt}
                </span>
              ) : (
                <span className="field-hint-row">
                  <span>Social cards and the blog list use this. Leave it empty to fall back to the article's opening.</span>
                  {wordCount > 10 && (
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => patch({ excerpt: excerptFromHtml(cleanHtml, EXCERPT_MAX) })}
                      disabled={Boolean(form.excerpt.trim())}
                    >
                      <Sparkles size={12} />
                      Suggest from the article
                    </button>
                  )}
                </span>
              )}
            </label>
          </section>

          <section className="panel editor-panel editor-content-panel">
            <div className="editor-content-head">
              <div>
                <p className="eyebrow">ARTICLE</p>
                <h2>Content</h2>
              </div>
              <span className="editor-content-note">
                {wordCount.toLocaleString()} words · images can be dragged in
              </span>
            </div>
            <RichTextEditor
              ref={editorRef}
              value={form.html}
              onChange={html => patch({ html })}
              onPickImage={() => setPicker({ open: true, target: 'inline' })}
              onUploadFile={uploadForEditor}
              invalid={Boolean(errors.content)}
              error={errors.content}
              placeholder="Write the article. Use the toolbar for headings, lists, quotes, links and images."
            />
          </section>
        </div>

        <aside className="editor-side">
          <section className="panel editor-panel publish-panel">
            <p className="eyebrow">PUBLISHING</p>
            <h2>{post ? `${stateLabel(state)}` : 'Not saved yet'}</h2>
            <p className="publish-note">{stateNote(state, post)}</p>

            {post && (
              <dl className="publish-meta">
                {post.publishedAt && (
                  <>
                    <dt>{state === 'scheduled' ? 'Goes live' : 'Published'}</dt>
                    <dd>
                      {formatDateTime(post.publishedAt)}
                      <span>{relativeTime(post.publishedAt)}</span>
                    </dd>
                  </>
                )}
                <dt>Updated</dt>
                <dd>
                  {formatDateTime(post.updatedAt)}
                  <span>{relativeTime(post.updatedAt)}</span>
                </dd>
                <dt>Created</dt>
                <dd>{formatDateTime(post.createdAt)}</dd>
              </dl>
            )}

            <div className="publish-actions">
              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={() => void (isPublished ? save({}) : publishNow())}
                disabled={saving || Boolean(busyAction)}
              >
                {busyAction === 'publish' || (saving && busyAction === 'save') ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <Send size={15} />
                )}
                {isPublished ? 'Save changes' : 'Publish now'}
              </button>

              {!isPublished && (
                <button
                  type="button"
                  className="btn btn-ghost btn-block"
                  onClick={() => void save({})}
                  disabled={saving || Boolean(busyAction)}
                >
                  {saving ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
                  Save draft
                </button>
              )}

              <button
                type="button"
                className="btn btn-ghost btn-block"
                onClick={() => {
                  setScheduleOpen(open => !open);
                  setScheduleError(null);
                  if (!scheduleValue) {
                    const target = new Date(Date.now() + 60 * 60 * 1000);
                    target.setSeconds(0, 0);
                    setScheduleValue(toLocalInputValue(target));
                  }
                }}
                disabled={saving || Boolean(busyAction)}
                aria-expanded={scheduleOpen}
              >
                <CalendarClock size={15} />
                {state === 'scheduled' ? 'Change the schedule' : 'Schedule for later'}
              </button>

              {isPublished && (
                <button
                  type="button"
                  className="btn btn-ghost btn-block"
                  onClick={() => void unpublish()}
                  disabled={saving || Boolean(busyAction)}
                >
                  {busyAction === 'draft' ? <Loader2 size={15} className="spin" /> : <X size={15} />}
                  Unpublish
                </button>
              )}

              {liveUrl && (
                <a className="btn btn-ghost btn-block" href={liveUrl} target="_blank" rel="noopener noreferrer">
                  <Eye size={15} />
                  View live post
                </a>
              )}
            </div>

            {scheduleOpen && (
              <div className="schedule-box">
                <label className="field">
                  <span className="field-label">Publish at</span>
                  <input
                    id="post-schedule"
                    type="datetime-local"
                    value={scheduleValue}
                    onChange={event => {
                      setScheduleValue(event.target.value);
                      setScheduleError(null);
                    }}
                    min={toLocalInputValue(new Date(Date.now() - 60_000))}
                  />
                  <span className="field-hint">
                    {scheduleValue
                      ? `${formatDateTime(fromLocalInputValue(scheduleValue))} · your device's timezone`
                      : 'Pick a date and time in your own timezone — it is stored in UTC.'}
                  </span>
                </label>
                {scheduleError && (
                  <p className="field-error" role="alert">
                    {scheduleError}
                  </p>
                )}
                <div className="schedule-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setScheduleOpen(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => void applySchedule()}
                    disabled={saving || Boolean(busyAction)}
                  >
                    {busyAction === 'schedule' ? <Loader2 size={14} className="spin" /> : <CalendarClock size={14} />}
                    {state === 'scheduled' ? 'Update schedule' : 'Schedule post'}
                  </button>
                </div>
              </div>
            )}

            {post && (
              <button type="button" className="btn btn-danger-ghost btn-block delete-post" onClick={() => setConfirmDelete(true)} disabled={deleting}>
                <Trash2 size={14} />
                Delete this post
              </button>
            )}
          </section>

          <section className="panel editor-panel">
            <p className="eyebrow">CHECKLIST</p>
            <h2>Before you publish</h2>
            <ul className="checklist">
              {checklist.map(item => (
                <li className={item.ok ? 'check-ok' : item.required ? 'check-missing' : 'check-todo'} key={item.key}>
                  {item.ok ? <Check size={13} /> : item.required ? <CircleAlert size={13} /> : <Info size={13} />}
                  <span>
                    {item.label}
                    {item.detail && <small>{item.detail}</small>}
                  </span>
                </li>
              ))}
            </ul>
            {missingRequired.length > 0 && (
              <p className="checklist-summary checklist-summary-bad">
                {missingRequired.length} required item{missingRequired.length === 1 ? '' : 's'} still missing.
              </p>
            )}
            {missingRequired.length === 0 && missingNice.length > 0 && (
              <p className="checklist-summary">
                Ready to publish — {missingNice.length} optional improvement{missingNice.length === 1 ? '' : 's'} left.
              </p>
            )}
            {missingRequired.length === 0 && missingNice.length === 0 && (
              <p className="checklist-summary checklist-summary-ok">Everything is filled in. Ready to publish.</p>
            )}
          </section>

          <section className="panel editor-panel">
            <p className="eyebrow">COVER</p>
            <h2>Cover image</h2>
            <CoverImageField
              url={form.coverImageUrl}
              alt={form.coverImageAlt}
              onUrlChange={value => patch({ coverImageUrl: value })}
              onAltChange={value => patch({ coverImageAlt: value })}
              onPick={() => setPicker({ open: true, target: 'cover' })}
              onClear={() => patch({ coverImageUrl: '', coverImageAlt: '' })}
              disabled={saving}
            />
            {errors.coverImageUrl && (
              <p className="field-error" role="alert">
                {errors.coverImageUrl}
              </p>
            )}
          </section>

          <section className="panel editor-panel">
            <p className="eyebrow">ORGANISE</p>
            <h2>Category, tags and author</h2>

            <label className="field">
              <span className="field-label">
                Category
                <CharCounter value={form.category} max={CATEGORY_MAX} />
              </span>
              <input
                id="post-category"
                value={form.category}
                onChange={event => patch({ category: event.target.value })}
                placeholder="Product updates"
                list="blog-categories"
                maxLength={CATEGORY_MAX + 20}
                autoComplete="off"
              />
              <datalist id="blog-categories">
                {categories.map(category => (
                  <option key={category} value={category} />
                ))}
              </datalist>
              {errors.category ? (
                <span className="field-error" role="alert">
                  {errors.category}
                </span>
              ) : (
                <span className="field-hint">Free text. Reusing a category lets readers filter by it.</span>
              )}
            </label>

            <div className="field">
              <span className="field-label">Tags</span>
              <TagInput value={form.tags} onChange={tags => patch({ tags })} disabled={saving} id="post-tags" />
              {knownTags.length > 0 && (
                <div className="tag-suggestions">
                  {knownTags
                    .filter(tag => !form.tags.includes(tag))
                    .slice(0, 8)
                    .map(tag => (
                      <button
                        type="button"
                        key={tag}
                        className="tag-pill tag-pill-button"
                        onClick={() => patch({ tags: [...form.tags, tag] })}
                        disabled={form.tags.length >= TAGS_MAX}
                      >
                        + {tag}
                      </button>
                    ))}
                </div>
              )}
            </div>

            <label className="field">
              <span className="field-label">
                Author name
                <CharCounter value={form.authorName} max={AUTHOR_MAX} />
              </span>
              <input
                id="post-authorName"
                value={form.authorName}
                onChange={event => patch({ authorName: event.target.value })}
                placeholder={adminLabel || 'Rown Team'}
                maxLength={AUTHOR_MAX + 20}
                autoComplete="off"
              />
              <span className="field-hint">Shown to readers. Defaults to your admin label, then “Rown Team”.</span>
            </label>
          </section>

          <section className="panel editor-panel">
            <p className="eyebrow">SEARCH & SOCIAL</p>
            <h2>SEO</h2>
            <SeoPanel
              slug={form.slug}
              title={form.title}
              excerpt={form.excerpt}
              canonicalUrl={form.canonicalUrl}
              seoTitle={form.seoTitle}
              seoDescription={form.seoDescription}
              onChange={seoPatch => patch(seoPatch)}
              disabled={saving}
            />
          </section>
        </aside>
      </div>

      <div className="editor-mobile-bar">
        <button type="button" className="btn btn-ghost" onClick={() => void save({})} disabled={saving || Boolean(busyAction)}>
          {saving ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
          Save
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void (isPublished ? save({}) : publishNow())}
          disabled={saving || Boolean(busyAction)}
        >
          <Send size={15} />
          {isPublished ? 'Save changes' : 'Publish'}
        </button>
      </div>

      <MediaLibraryDialog
        open={picker.open}
        onClose={() => setPicker(current => ({ ...current, open: false }))}
        onSelect={handlePickedImage}
        withCaption={picker.target === 'inline'}
        title={picker.target === 'cover' ? 'Choose a cover image' : 'Add an image to the article'}
      />

      <PostPreviewDialog open={showPreview} onClose={() => setShowPreview(false)} post={previewOf(form, post, state)} />

      <ConfirmDialog
        open={confirmDelete}
        busy={deleting}
        title="Delete this post?"
        confirmLabel="Delete permanently"
        cancelLabel="Keep it"
        requireText="delete"
        message={
          <>
            <p>
              <strong>{post?.title || form.title || 'This post'}</strong> and all of its comments will be permanently
              removed from the server.
            </p>
            <p className="confirm-hint">Type “delete” to confirm. This cannot be undone.</p>
          </>
        }
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

function suggestedSlugPreview(title: string): string {
  return slugify(title).slice(0, 60);
}

function stateLabel(state: 'draft' | 'scheduled' | 'published'): string {
  if (state === 'scheduled') return 'Scheduled';
  return state === 'published' ? 'Published' : 'Draft';
}

function stateNote(state: 'draft' | 'scheduled' | 'published', post: BlogPost | null): string {
  if (state === 'scheduled' && post?.publishedAt) {
    return `Hidden from readers until ${formatDateTime(post.publishedAt)} (${relativeTime(post.publishedAt)}). Publishing now overrides the schedule.`;
  }
  if (state === 'published') {
    return 'Live on the public blog. Saving changes updates it immediately.';
  }
  return 'Drafts are only visible inside this console. Publish when it is ready for readers.';
}
