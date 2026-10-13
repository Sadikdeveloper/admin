import { useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, DragEvent, KeyboardEvent, ReactNode, Ref } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bold,
  Braces,
  Code,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Loader2,
  Minus,
  Pencil,
  Quote,
  Redo2,
  RemoveFormatting,
  SquareCode,
  Strikethrough,
  Trash2,
  Underline,
  Undo2,
  Upload,
} from 'lucide-react';
import { Modal } from '../../components/Modal';
import { countWords, htmlToPlainText, readingMinutes, sanitizeBlogHtml, sanitizeUrl } from '../../lib/blog-html';
import { ACCEPTED_IMAGE_TYPES } from '../../lib/blog';
import { describeUploadError } from '../../lib/blog-images';
import { bookmarkEditorRange, editorEnd, editorSelection, insertEditorBlocks, insertEditorHtml, rangeIsInEditor, sameRange } from '../../lib/blog-editor';
import { HtmlSnippetDialog } from './HtmlSnippetDialog';

export type InsertedImage = { src: string; alt?: string; caption?: string };

export type RichTextEditorHandle = {
  insertImage: (image: InsertedImage) => void;
  focus: () => void;
};

type ToolbarState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  code: boolean;
  bulletList: boolean;
  orderedList: boolean;
  block: string;
  link: boolean;
};

const EMPTY_TOOLBAR: ToolbarState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  code: false,
  bulletList: false,
  orderedList: false,
  block: 'p',
  link: false,
};

/** The API stores up to 1 MB of HTML, so warn before it turns into a 400. */
const HTML_SOFT_LIMIT = 900_000;

function ToolButton({
  label,
  shortcut,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`rte-btn${active ? ' active' : ''}`}
      title={shortcut ? `${label} · ${shortcut}` : label}
      aria-label={label}
      aria-pressed={active ? true : undefined}
      disabled={disabled}
      // Preventing the default keeps the editor selection alive while the
      // toolbar takes the click — without it formatting does nothing on touch.
      onMouseDown={event => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ToolDivider() {
  return <span className="rte-divider" aria-hidden="true" />;
}

export function RichTextEditor({
  ref,
  value,
  onChange,
  onPickImage,
  onUploadFile,
  onUploadingChange,
  disabled = false,
  invalid = false,
  error,
  placeholder = 'Write the article…',
  label = 'Article content',
}: {
  ref?: Ref<RichTextEditorHandle>;
  value: string;
  onChange: (html: string) => void;
  onPickImage?: () => void;
  onUploadFile?: (file: File) => Promise<InsertedImage | null>;
  onUploadingChange?: (count: number) => void;
  disabled?: boolean;
  invalid?: boolean;
  error?: string | null;
  placeholder?: string;
  label?: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draggedImage = useRef<Element | null>(null);
  const sourceInputRef = useRef<HTMLTextAreaElement>(null);
  const uploadQueue = useRef<Promise<void>>(Promise.resolve());
  const uploadAnchor = useRef<{ owner: HTMLDivElement; version: number; range: Range } | null>(null);
  const mounted = useRef(true);
  const documentVersion = useRef(0);
  const savedRange = useRef<Range | null>(null);
  const lastHtml = useRef<string>(value ?? '');
  /* False until the mounted value has been written into the contenteditable. */
  const hydrated = useRef(false);
  const surfaceId = useId();

  const [toolbar, setToolbar] = useState<ToolbarState>(EMPTY_TOOLBAR);
  const [isEmpty, setIsEmpty] = useState(true);
  const [stats, setStats] = useState({ words: 0, characters: 0, minutes: 0 });
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceDraft, setSourceDraft] = useState('');
  const [sourceNotice, setSourceNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [htmlDialogOpen, setHtmlDialogOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<HTMLImageElement | null>(null);
  const [imageDetails, setImageDetails] = useState<{ alt: string; caption: string } | null>(null);
  const editable = useRef(true);
  editable.current = !disabled && !sourceMode;
  const [dragging, setDragging] = useState(false);
  const [linkDialog, setLinkDialog] = useState<{ open: boolean; url: string; text: string; newTab: boolean; editing: boolean }>({
    open: false,
    url: '',
    text: '',
    newTab: true,
    editing: false,
  });
  const [linkError, setLinkError] = useState<string | null>(null);
  const linkUrlRef = useRef<HTMLInputElement>(null);

  /* ---------------------------------------------------------------- */
  /* DOM helpers                                                       */
  /* ---------------------------------------------------------------- */

  const closestElement = (node: Node | null): Element | null => {
    if (!node) return null;
    return node.nodeType === 1 ? (node as Element) : node.parentElement;
  };

  const ancestorWith = (node: Node | null, tag: string): Element | null => {
    const editor = editorRef.current;
    let current = closestElement(node);
    while (current && current !== editor) {
      if (current.tagName === tag) return current;
      current = current.parentElement;
    }
    return null;
  };

  const unwrap = (element: Element) => {
    const parent = element.parentNode;
    if (!parent) return;
    while (element.firstChild) parent.insertBefore(element.firstChild, element);
    parent.removeChild(element);
    parent.normalize();
  };

  const refreshMeta = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const text = editor.innerText || editor.textContent || '';
    const words = countWords(text.replace(/\u200b/g, ' ').trim());
    setIsEmpty(words === 0 && !editor.querySelector('img, hr, pre, li, blockquote'));
    setStats({ words, characters: text.replace(/\u200b/g, '').replace(/\n+$/, '').length, minutes: readingMinutes(words) });
  }, []);

  /**
   * Pushes the current DOM out to the form. The editor owns its own markup, so
   * this is the only place that reports changes upward.
   *
   * An editor holding nothing but `<p><br></p>` reports an empty string: the
   * caret needs a paragraph to live in, but the post should stay empty so the
   * API (and the publish check) sees no content.
   */
  const sync = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const raw = editor.innerHTML;
    const next = isEmptyMarkup(raw) ? '' : raw;
    lastHtml.current = next;
    onChange(next);
    refreshMeta();
  }, [onChange, refreshMeta]);

  /** Keeps one empty paragraph in the surface so the caret always has a home. */
  const ensureEditable = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (!editor.children.length && !(editor.textContent ?? '').trim()) editor.innerHTML = '<p><br></p>';
  }, []);

  const updateToolbar = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const state = (command: string) => {
      try {
        return document.queryCommandState(command);
      } catch {
        return false;
      }
    };
    let block = 'p';
    try {
      block = (document.queryCommandValue('formatBlock') || 'p').toLowerCase().replace(/[<>]/g, '') || 'p';
    } catch {
      block = 'p';
    }

    const selection = window.getSelection();
    const start = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).startContainer : null;
    const codeElement = ancestorWith(start, 'CODE');

    setToolbar({
      bold: state('bold'),
      italic: state('italic'),
      underline: state('underline'),
      strike: state('strikeThrough'),
      code: Boolean(codeElement && !ancestorWith(codeElement, 'PRE')),
      bulletList: state('insertUnorderedList'),
      orderedList: state('insertOrderedList'),
      block,
      link: Boolean(ancestorWith(start, 'A')),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------------------------------------------------- */
  /* Selection                                                         */
  /* ---------------------------------------------------------------- */

  const saveSelection = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const range = editorSelection(editor);
    if (range) savedRange.current = range;
  }, []);

  const restoreSelection = useCallback((): Range | null => {
    const editor = editorRef.current;
    if (!editor) return null;
    editor.focus();
    // Tag formatting (<strong>) survives the API sanitizer; CSS formatting
    // (<span style="…">) is stripped, so always ask the browser for tags.
    try {
      document.execCommand('styleWithCSS', false, 'false');
    } catch {
      /* engines without this command simply keep their default */
    }

    const selection = window.getSelection();
    if (!selection) return null;
    const saved = savedRange.current;
    if (saved && editor.contains(saved.commonAncestorContainer)) {
      selection.removeAllRanges();
      selection.addRange(saved);
      return saved;
    }
    const fallback = document.createRange();
    fallback.selectNodeContents(editor);
    fallback.collapse(false);
    selection.removeAllRanges();
    selection.addRange(fallback);
    savedRange.current = fallback.cloneRange();
    return fallback;
  }, []);

  const exec = useCallback(
    (command: string, commandValue?: string) => {
      if (disabled || sourceMode) return;
      restoreSelection();
      try {
        document.execCommand(command, false, commandValue);
      } catch {
        /* command unavailable — nothing else to do */
      }
      sync();
      updateToolbar();
    },
    [disabled, sourceMode, restoreSelection, sync, updateToolbar],
  );

  /* ---------------------------------------------------------------- */
  /* External value sync (never while the operator is typing)          */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || sourceMode) return;
    const next = value ?? '';
    /*
     * The surface mounts empty, so the first run always writes the value in —
     * otherwise an editor opened on a saved post would show a blank page while
     * the form still holds the article.
     */
    /*
     * `editor.innerHTML === ''` means the surface was just (re)mounted — source
     * mode unmounts it — so it always needs the value written back in.
     */
    if (hydrated.current && next === lastHtml.current && editor.innerHTML !== '') {
      ensureEditable();
      return;
    }
    const clean = sanitizeBlogHtml(next);
    if (editor.innerHTML !== clean) {
      editor.innerHTML = clean;
      documentVersion.current += 1;
    }
    savedRange.current = null;
    setSelectedImage(null);
    setImageDetails(null);
    lastHtml.current = next;
    hydrated.current = true;
    ensureEditable();
    refreshMeta();
  }, [value, sourceMode, refreshMeta, ensureEditable]);

  useEffect(() => {
    ensureEditable();
    refreshMeta();
  }, [ensureEditable, refreshMeta]);

  useEffect(() => {
    const onSelectionChange = () => {
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (!editor || !selection || selection.rangeCount === 0) return;
      if (!editor.contains(selection.getRangeAt(0).commonAncestorContainer)) return;
      saveSelection();
      updateToolbar();
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [saveSelection, updateToolbar]);

  /* ---------------------------------------------------------------- */
  /* Block insertion (images, dividers)                                */
  /* ---------------------------------------------------------------- */

  const placeCaret = useCallback((range: Range, focus = true) => {
    const editor = editorRef.current;
    if (!editor || !rangeIsInEditor(editor, range)) return;
    if (focus) editor.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    savedRange.current = range.cloneRange();
  }, []);

  const insertBlockElements = useCallback(
    (elements: Element[], atRange?: Range): Range | null => {
      const editor = editorRef.current;
      if (!editor || !elements.length || !editable.current) return null;
      // A detached range belongs to a previous/replaced article. Never insert
      // a delayed upload into an unrelated place or a different post.
      if (atRange && !rangeIsInEditor(editor, atRange)) return null;
      const range = atRange?.cloneRange() ?? restoreSelection();
      if (!range) return null;
      const current = editorSelection(editor);
      const active = document.activeElement;
      const keepOutsideFocus = Boolean(atRange && active && active !== editor && active !== document.body && !editor.parentElement?.parentElement?.contains(active));
      const keepCurrent = Boolean(atRange && current && !sameRange(current, atRange) && document.activeElement === editor);
      const restoreCurrent = keepCurrent && current ? bookmarkEditorRange(editor, current) : null;
      const caret = insertEditorBlocks(editor, range, elements);
      const preserved = restoreCurrent?.();
      if (preserved) placeCaret(preserved, false);
      else if (caret && !keepOutsideFocus) placeCaret(caret);
      sync();
      updateToolbar();
      return caret;
    },
    [placeCaret, restoreSelection, sync, updateToolbar],
  );

  const insertImage = useCallback(
    (image: InsertedImage, atRange?: Range): Range | null => {
      const src = sanitizeUrl(image.src ?? '', false);
      if (!src) return null;
      const figure = document.createElement('figure');
      figure.className = 'cms-figure';
      const img = document.createElement('img');
      img.src = src;
      img.alt = image.alt ?? '';
      img.loading = 'lazy';
      figure.appendChild(img);
      const caption = image.caption?.trim();
      if (caption) {
        const figcaption = document.createElement('figcaption');
        figcaption.textContent = caption;
        figure.appendChild(figcaption);
      }
      return insertBlockElements([figure], atRange);
    },
    [insertBlockElements],
  );

  useImperativeHandle(
    ref,
    () => ({
      insertImage,
      focus: () => {
        if (sourceMode) sourceInputRef.current?.focus();
        else restoreSelection();
      },
    }),
    [insertImage, restoreSelection, sourceMode],
  );

  const selectedBlock = selectedImage && editorRef.current?.contains(selectedImage)
    ? selectedImage.closest('figure') ?? selectedImage
    : null;

  const moveSelectedImage = (direction: 'up' | 'down') => {
    if (!selectedBlock || !editable.current || uploading > 0) return;
    const sibling = direction === 'up' ? selectedBlock.previousElementSibling : selectedBlock.nextElementSibling;
    if (!sibling) return;
    const parent = selectedBlock.parentNode!;
    parent.insertBefore(selectedBlock, direction === 'up' ? sibling : sibling.nextSibling);
    const range = document.createRange();
    range.setStartAfter(selectedBlock);
    range.collapse(true);
    placeCaret(range);
    sync();
  };

  const removeSelectedImage = () => {
    if (!selectedBlock || !editable.current || uploading > 0) return;
    const range = document.createRange();
    range.setStartBefore(selectedBlock);
    range.collapse(true);
    selectedBlock.remove();
    ensureEditable();
    setSelectedImage(null);
    placeCaret(range);
    sync();
  };

  const applyImageDetails = () => {
    if (!selectedImage || !selectedBlock || !imageDetails || !editable.current) return;
    selectedImage.alt = imageDetails.alt.trim();
    if (selectedBlock.tagName === 'FIGURE') {
      let caption = selectedBlock.querySelector('figcaption');
      if (imageDetails.caption.trim()) {
        if (!caption) {
          caption = document.createElement('figcaption');
          selectedBlock.appendChild(caption);
        }
        caption.textContent = imageDetails.caption.trim();
      } else caption?.remove();
    }
    setImageDetails(null);
    sync();
  };

  /* ---------------------------------------------------------------- */
  /* Inline code (no execCommand equivalent exists)                    */
  /* ---------------------------------------------------------------- */

  const toggleInlineCode = () => {
    const editor = editorRef.current;
    if (!editor || disabled || sourceMode) return;
    const range = restoreSelection();
    const selection = window.getSelection();
    if (!range || !selection) return;

    const existing = ancestorWith(range.startContainer, 'CODE');
    if (existing && !ancestorWith(existing, 'PRE')) {
      unwrap(existing);
      sync();
      updateToolbar();
      return;
    }

    const code = document.createElement('code');
    if (range.collapsed) {
      // A zero-width space gives the caret somewhere to live; it is stripped
      // again before the post is saved.
      code.appendChild(document.createTextNode('\u200b'));
      range.insertNode(code);
      const caret = document.createRange();
      caret.setStart(code.firstChild as Text, 1);
      caret.collapse(true);
      selection.removeAllRanges();
      selection.addRange(caret);
      savedRange.current = caret.cloneRange();
    } else {
      try {
        code.appendChild(range.extractContents());
      } catch {
        code.textContent = range.toString();
        range.deleteContents();
      }
      range.insertNode(code);
      const caret = document.createRange();
      caret.selectNodeContents(code);
      caret.collapse(false);
      selection.removeAllRanges();
      selection.addRange(caret);
      savedRange.current = caret.cloneRange();
    }
    sync();
    updateToolbar();
  };

  /* ---------------------------------------------------------------- */
  /* Links                                                             */
  /* ---------------------------------------------------------------- */

  const openLinkDialog = () => {
    if (disabled || sourceMode) return;
    saveSelection();
    const selection = window.getSelection();
    const anchor = ancestorWith(selection && selection.rangeCount > 0 ? selection.getRangeAt(0).startContainer : null, 'A');
    const selectedText = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).toString() : '';
    setLinkError(null);
    setLinkDialog({
      open: true,
      url: anchor?.getAttribute('href') ?? '',
      text: anchor ? anchor.textContent ?? '' : selectedText,
      newTab: anchor ? anchor.getAttribute('target') === '_blank' : true,
      editing: Boolean(anchor),
    });
  };

  const closeLinkDialog = () => {
    setLinkDialog(current => ({ ...current, open: false }));
    setLinkError(null);
  };

  const applyLink = () => {
    const editor = editorRef.current;
    if (!editor) return;

    const href = sanitizeUrl(linkDialog.url, true);
    if (!href) {
      setLinkError('Use a full https:// or http:// address, a mailto:/tel: link, or a path like /blog/…');
      return;
    }

    const range = restoreSelection();
    const selection = window.getSelection();
    if (!range || !selection) return;

    const target = linkDialog.newTab ? '_blank' : null;
    const rel = target ? 'noopener noreferrer nofollow' : null;
    const existing = linkDialog.editing ? ancestorWith(range.startContainer, 'A') : null;

    if (existing) {
      existing.setAttribute('href', href);
      if (target) existing.setAttribute('target', target);
      else existing.removeAttribute('target');
      if (rel) existing.setAttribute('rel', rel);
      else existing.removeAttribute('rel');
      const text = linkDialog.text.trim();
      if (text && existing.textContent !== text) existing.textContent = text;
    } else {
      const anchor = document.createElement('a');
      anchor.setAttribute('href', href);
      if (target) anchor.setAttribute('target', target);
      if (rel) anchor.setAttribute('rel', rel);

      if (range.collapsed) {
        anchor.textContent = linkDialog.text.trim() || href;
        range.insertNode(anchor);
        // A trailing space keeps typing outside the link, which is what people
        // expect right after inserting one.
        const space = document.createTextNode('\u00a0');
        anchor.parentNode?.insertBefore(space, anchor.nextSibling);
        const caret = document.createRange();
        caret.setStart(space, 1);
        caret.collapse(true);
        selection.removeAllRanges();
        selection.addRange(caret);
        savedRange.current = caret.cloneRange();
      } else {
        try {
          anchor.appendChild(range.extractContents());
        } catch {
          anchor.textContent = range.toString();
          range.deleteContents();
        }
        if (!(anchor.textContent ?? '').trim()) anchor.textContent = href;
        range.insertNode(anchor);
      }
    }

    sync();
    updateToolbar();
    closeLinkDialog();
  };

  const removeLink = () => {
    const editor = editorRef.current;
    if (!editor || disabled || sourceMode) return;
    restoreSelection();
    const selection = window.getSelection();
    const anchor = ancestorWith(selection && selection.rangeCount > 0 ? selection.getRangeAt(0).startContainer : null, 'A');
    if (anchor) {
      unwrap(anchor);
      sync();
      updateToolbar();
      return;
    }
    exec('unlink');
  };

  /* ---------------------------------------------------------------- */
  /* Clipboard, drops and uploads                                      */
  /* ---------------------------------------------------------------- */

  const insertPayload = useCallback(
    (html: string) => {
      const editor = editorRef.current;
      if (!editor || !html || !editable.current) return;
      const range = restoreSelection();
      if (!range) return;
      const caret = insertEditorHtml(editor, range, html);
      if (caret) placeCaret(caret);
      sync();
      updateToolbar();
    },
    [placeCaret, restoreSelection, sync, updateToolbar],
  );

  const uploadFiles = useCallback(
    (files: File[]) => {
      const owner = editorRef.current;
      if (!onUploadFile || !files.length || !owner || !editable.current) return;
      saveSelection();
      const version = documentVersion.current;
      const insertion = savedRange.current?.cloneRange() ?? editorEnd(owner);
      // Uploads can take time. Never delete text that was selected (or typed)
      // while waiting for a screenshot to arrive.
      insertion.collapse(false);
      const previous = uploadAnchor.current;
      // Rapid successive pastes at the same caret share a moving anchor, so
      // the second queued screenshot appears after the first, not before it.
      const anchor = previous && previous.owner === owner && previous.version === version && sameRange(previous.range, insertion)
        ? previous
        : { owner, version, range: insertion };
      uploadAnchor.current = anchor;
      setUploadError(null);
      setUploading(current => current + files.length);
      uploadQueue.current = uploadQueue.current.then(async () => {
        for (const [index, file] of files.entries()) {
          try {
            if (!mounted.current || editorRef.current !== owner || documentVersion.current !== version) continue;
            const image = await onUploadFile(file);
            if (!mounted.current || editorRef.current !== owner) continue;
            if (documentVersion.current !== version) {
              setUploadError('The article changed while the image was uploading. It was not inserted; you can select the uploaded image from the media library.');
              continue;
            }
            if (image) anchor.range = insertImage(image, anchor.range) ?? anchor.range;
          } catch (error) {
            const problem = describeUploadError(error);
            if (mounted.current) setUploadError([problem.message, problem.detail].filter(Boolean).join(' '));
            if (problem.kind === 'storage' || problem.kind === 'rate') {
              // Every remaining file would fail for the same server-side reason.
              if (mounted.current) setUploading(current => Math.max(0, current - (files.length - index - 1)));
              break;
            }
          } finally {
            if (mounted.current) setUploading(current => Math.max(0, current - 1));
          }
        }
      });
    },
    [insertImage, onUploadFile, saveSelection],
  );

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    onUploadingChange?.(uploading);
  }, [onUploadingChange, uploading]);

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    uploadFiles(files);
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (!editable.current) return;
    event.preventDefault();
    saveSelection();
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    // Screenshots often include an unusable blob/file URL in text/html. Prefer
    // the real clipboard bytes and upload those, rather than a broken image.
    const files = Array.from(clipboard.files ?? []).filter(file => file.type.startsWith('image/'));
    if (!files.length) {
      for (const item of Array.from(clipboard.items ?? [])) {
        if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length && onUploadFile) {
      uploadFiles(files);
      return;
    }
    const html = clipboard.getData('text/html');
    if (html) insertPayload(html);
    else {
      const text = clipboard.getData('text/plain');
      if (text) insertPayload(plainTextToHtml(text));
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!editable.current) return;
    const editor = editorRef.current;
    // Dropping has a position of its own; don't reuse the last typing caret.
    const hitDocument = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const position = hitDocument.caretPositionFromPoint?.(event.clientX, event.clientY);
    let dropRange = hitDocument.caretRangeFromPoint?.(event.clientX, event.clientY) ?? null;
    if (position) {
      dropRange = document.createRange();
      dropRange.setStart(position.offsetNode, position.offset);
      dropRange.collapse(true);
    }
    if (editor && rangeIsInEditor(editor, dropRange)) placeCaret(dropRange);
    else saveSelection();
    const moving = draggedImage.current;
    draggedImage.current = null;
    if (moving && editor?.contains(moving)) {
      if (uploading > 0 || dropRange && moving.contains(dropRange.startContainer)) return;
      // Move the existing figure, including its caption, instead of pasting a
      // duplicate of the browser's dragged-image HTML.
      insertBlockElements([moving]);
      return;
    }
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length && onUploadFile) {
      uploadFiles(files);
      return;
    }
    const html = event.dataTransfer?.getData('text/html');
    if (html) insertPayload(html);
    else {
      const text = event.dataTransfer?.getData('text/plain');
      if (text) insertPayload(plainTextToHtml(text));
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    if (event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openLinkDialog();
    }
  };

  /* ---------------------------------------------------------------- */
  /* HTML source mode                                                  */
  /* ---------------------------------------------------------------- */

  const enterSourceMode = () => {
    saveSelection();
    const html = editorRef.current?.innerHTML ?? value ?? '';
    setSourceDraft(isEmptyMarkup(html) ? '' : sanitizeBlogHtml(html));
    setSourceNotice(null);
    setSourceMode(true);
    setSelectedImage(null);
  };

  const exitSourceMode = () => {
    if (disabled) return;
    const clean = sanitizeBlogHtml(sourceDraft);
    setSourceNotice(
      clean === sourceDraft.trim()
        ? null
        : 'Some HTML was removed or normalized. Scripts, event handlers, inline styles and embeds are not supported.',
    );
    setSourceMode(false);
    savedRange.current = null;
    /*
     * The contenteditable is unmounted while the textarea is showing, so the
     * change has to be published from here — waiting for the surface would
     * silently throw the edit away.
     */
    const next = isEmptyMarkup(clean) ? '' : clean;
    lastHtml.current = next;
    hydrated.current = true;
    onChange(next);
    const editor = editorRef.current;
    if (editor) {
      editor.innerHTML = clean;
      refreshMeta();
      updateToolbar();
    }
  };

  const updateSourceDraft = (html: string) => {
    setSourceDraft(html);
    lastHtml.current = html;
    // Keep raw, possibly incomplete markup in the form/local backup. The save
    // and preview pipelines sanitize it without requiring a mode switch.
    onChange(html);
  };

  useEffect(() => {
    if (!sourceMode) return;
    if (value !== lastHtml.current) {
      setSourceDraft(value ?? '');
      lastHtml.current = value ?? '';
    }
  }, [sourceMode, value]);

  useEffect(() => {
    if (!sourceMode) return;
    const text = htmlToPlainText(sanitizeBlogHtml(sourceDraft));
    const words = countWords(text);
    setStats({ words, characters: text.length, minutes: readingMinutes(words) });
  }, [sourceDraft, sourceMode]);

  const tooLarge = (value ?? '').length > HTML_SOFT_LIMIT;
  const visualDisabled = disabled || sourceMode;

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  return (
    <div className={`rte${disabled ? ' rte-disabled' : ''}${invalid ? ' rte-invalid' : ''}`}>
      <div className="rte-toolbar" role="toolbar" aria-label="Text formatting" aria-controls={surfaceId}>
        <div className="rte-group">
          <ToolButton disabled={visualDisabled} label="Paragraph" active={toolbar.block === 'p' || toolbar.block === 'div' || toolbar.block === 'body'} onClick={() => exec('formatBlock', '<p>')}>
            <span className="rte-glyph" aria-hidden="true">
              ¶
            </span>
          </ToolButton>
          <ToolButton disabled={visualDisabled} label="Section heading" active={toolbar.block === 'h2'} onClick={() => exec('formatBlock', '<h2>')}>
            <Heading2 size={16} />
          </ToolButton>
          <ToolButton disabled={visualDisabled} label="Subheading" active={toolbar.block === 'h3'} onClick={() => exec('formatBlock', '<h3>')}>
            <Heading3 size={16} />
          </ToolButton>
        </div>
        <ToolDivider />
        <div className="rte-group">
          <ToolButton disabled={visualDisabled} label="Bold" shortcut="Ctrl/⌘ + B" active={toolbar.bold} onClick={() => exec('bold')}>
            <Bold size={16} />
          </ToolButton>
          <ToolButton disabled={visualDisabled} label="Italic" shortcut="Ctrl/⌘ + I" active={toolbar.italic} onClick={() => exec('italic')}>
            <Italic size={16} />
          </ToolButton>
          <ToolButton disabled={visualDisabled} label="Underline" shortcut="Ctrl/⌘ + U" active={toolbar.underline} onClick={() => exec('underline')}>
            <Underline size={16} />
          </ToolButton>
          <ToolButton disabled={visualDisabled} label="Strikethrough" active={toolbar.strike} onClick={() => exec('strikeThrough')}>
            <Strikethrough size={16} />
          </ToolButton>
          <ToolButton disabled={visualDisabled} label="Inline code" active={toolbar.code} onClick={toggleInlineCode}>
            <Code size={16} />
          </ToolButton>
          <ToolButton disabled={visualDisabled} label="Clear formatting" onClick={() => exec('removeFormat')}>
            <RemoveFormatting size={16} />
          </ToolButton>
        </div>
        <ToolDivider />
        <div className="rte-group">
          <ToolButton disabled={visualDisabled} label="Bulleted list" active={toolbar.bulletList} onClick={() => exec('insertUnorderedList')}>
            <List size={16} />
          </ToolButton>
          <ToolButton disabled={visualDisabled} label="Numbered list" active={toolbar.orderedList} onClick={() => exec('insertOrderedList')}>
            <ListOrdered size={16} />
          </ToolButton>
          <ToolButton disabled={visualDisabled} label="Quote" active={toolbar.block === 'blockquote'} onClick={() => exec('formatBlock', '<blockquote>')}>
            <Quote size={16} />
          </ToolButton>
          <ToolButton disabled={visualDisabled} label="Code block" active={toolbar.block === 'pre'} onClick={() => exec('formatBlock', '<pre>')}>
            <SquareCode size={16} />
          </ToolButton>
          <ToolButton disabled={visualDisabled} label="Divider" onClick={() => insertBlockElements([document.createElement('hr')])}>
            <Minus size={16} />
          </ToolButton>
        </div>
        <ToolDivider />
        <div className="rte-group">
          <ToolButton disabled={visualDisabled} label="Add or edit a link" shortcut="Ctrl/⌘ + K" active={toolbar.link} onClick={openLinkDialog}>
            <Link2 size={16} />
          </ToolButton>
          <ToolButton disabled={visualDisabled || !toolbar.link} label="Remove link" onClick={removeLink}>
            <Link2Off size={16} />
          </ToolButton>
        </div>
        <ToolDivider />
        <div className="rte-group">
          <ToolButton disabled={visualDisabled} label="Undo" shortcut="Ctrl/⌘ + Z" onClick={() => exec('undo')}>
            <Undo2 size={16} />
          </ToolButton>
          <ToolButton disabled={visualDisabled} label="Redo" shortcut="Ctrl/⌘ + Y" onClick={() => exec('redo')}>
            <Redo2 size={16} />
          </ToolButton>
        </div>
      </div>

      <div className="rte-insert-bar" role="group" aria-label="Insert content">
        {onPickImage && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={visualDisabled || uploading > 0} onMouseDown={event => event.preventDefault()} onClick={() => { saveSelection(); onPickImage(); }}>
            <ImagePlus size={15} />
            Insert image
          </button>
        )}
        {onUploadFile && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={visualDisabled || uploading > 0} onMouseDown={event => event.preventDefault()} onClick={() => { saveSelection(); fileInputRef.current?.click(); }}>
            <Upload size={15} />
            Upload images here
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" disabled={visualDisabled || uploading > 0} onMouseDown={event => event.preventDefault()} onClick={() => { saveSelection(); setHtmlDialogOpen(true); }}>
          <Code size={15} />
          Insert HTML
        </button>
        <button type="button" className={`btn btn-ghost btn-sm${sourceMode ? ' active' : ''}`} aria-label={sourceMode ? 'Back to the visual editor' : 'Edit HTML'} aria-pressed={sourceMode} disabled={disabled || uploading > 0} onMouseDown={event => event.preventDefault()} onClick={() => (sourceMode ? exitSourceMode() : enterSourceMode())}>
          <Braces size={15} />
          {sourceMode ? 'Visual editor' : 'HTML source'}
        </button>
      </div>
      <p className="rte-insert-hint">
        {sourceMode ? 'Edit the whole article as HTML. Save and preview include your latest changes without switching modes.' : 'Click where an image belongs, then insert, upload, paste or drop it. Keep typing below it. Click an image to add a caption or move it; drag it to reorder.'}
      </p>
      {onUploadFile && (
        <input ref={fileInputRef} type="file" accept={ACCEPTED_IMAGE_TYPES} multiple className="visually-hidden" aria-label="Upload inline images" tabIndex={-1} disabled={visualDisabled || uploading > 0} onChange={onFileInput} />
      )}

      {sourceMode ? (
        <div className="rte-source">
          <textarea
            ref={sourceInputRef}
            id={surfaceId}
            value={sourceDraft}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            onChange={event => updateSourceDraft(event.target.value)}
            spellCheck={false}
            aria-label="Article HTML"
            placeholder={'<p>Write or paste HTML here…</p>'}
          />
          <div className="rte-source-actions">
            <span className="rte-hint">Supported article HTML only — scripts, event handlers, inline styles and embeds are removed.</span>
            <button type="button" className="btn btn-ghost btn-sm" disabled={disabled} onClick={exitSourceMode}>
              Back to editor
            </button>
          </div>
        </div>
      ) : (
        <div className={`rte-surface-wrap${dragging ? ' rte-dragging' : ''}${uploading > 0 ? ' rte-busy' : ''}`}>
          <div
            id={surfaceId}
            ref={editorRef}
            className={`rte-surface blog-prose${isEmpty ? ' is-empty' : ''}`}
            contentEditable={!disabled}
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label={label}
            aria-invalid={invalid || undefined}
            data-placeholder={placeholder}
            onInput={() => { setSelectedImage(null); sync(); saveSelection(); }}
            onClick={event => {
              const target = event.target;
              if (target instanceof HTMLImageElement) {
                setSelectedImage(target);
                const range = document.createRange();
                range.setStartAfter(target.closest('figure') ?? target);
                range.collapse(true);
                placeCaret(range);
              } else setSelectedImage(null);
            }}
            onBlur={saveSelection}
            onKeyUp={saveSelection}
            onMouseUp={() => {
              saveSelection();
              updateToolbar();
            }}
            onPaste={onPaste}
            onDrop={onDrop}
            onDragStart={event => {
              if (!editable.current || uploading > 0) { event.preventDefault(); return; }
              const target = event.target;
              draggedImage.current = target instanceof HTMLImageElement ? target.closest('figure') ?? target : null;
            }}
            onDragEnd={() => { draggedImage.current = null; setDragging(false); }}
            onDragOver={event => {
              if (disabled) return;
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onKeyDown={onKeyDown}
          />
          {uploading > 0 && (
            <div className="rte-upload-status" role="status">
              <Loader2 size={16} className="spin" />
              <span>
                Uploading {uploading} image{uploading === 1 ? '' : 's'}…
              </span>
            </div>
          )}
          {dragging && (
            <div className="rte-drop-overlay" aria-hidden="true">
              Drop an image to add it to the article
            </div>
          )}
        </div>
      )}

      {selectedBlock && !sourceMode && (
        <div className="rte-image-actions" role="group" aria-label="Selected image actions">
          <span>Selected image</span>
          <button type="button" className="btn btn-ghost btn-xs" disabled={disabled || uploading > 0 || !selectedBlock.previousElementSibling} onMouseDown={event => event.preventDefault()} onClick={() => moveSelectedImage('up')} aria-label="Move image up">
            <ArrowUp size={14} /> Move up
          </button>
          <button type="button" className="btn btn-ghost btn-xs" disabled={disabled || uploading > 0 || !selectedBlock.nextElementSibling} onMouseDown={event => event.preventDefault()} onClick={() => moveSelectedImage('down')} aria-label="Move image down">
            <ArrowDown size={14} /> Move down
          </button>
          <button type="button" className="btn btn-ghost btn-xs" disabled={disabled || uploading > 0} onMouseDown={event => event.preventDefault()} onClick={() => setImageDetails({ alt: selectedImage?.alt ?? '', caption: selectedBlock.querySelector('figcaption')?.textContent ?? '' })}>
            <Pencil size={14} /> Image details
          </button>
          <button type="button" className="btn btn-danger-ghost btn-xs" disabled={disabled || uploading > 0} onMouseDown={event => event.preventDefault()} onClick={removeSelectedImage} aria-label="Remove image from article">
            <Trash2 size={14} /> Remove
          </button>
        </div>
      )}

      {sourceNotice && !sourceMode && (
        <p className="rte-notice" role="status">
          {sourceNotice}
        </p>
      )}
      {uploadError && <p className="field-error" role="alert">{uploadError}</p>}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {tooLarge && (
        <p className="field-error" role="alert">
          This article is over 900 KB of HTML and the API will reject it. Remove a few images or split it into two posts.
        </p>
      )}

      <div className="rte-foot" aria-live="off">
        <span>{stats.words.toLocaleString()} words</span>
        <span aria-hidden="true">·</span>
        <span>{stats.characters.toLocaleString()} characters</span>
        <span aria-hidden="true">·</span>
        <span>{stats.minutes > 0 ? `${stats.minutes} min read` : 'nothing to read yet'}</span>
      </div>

      <Modal
        open={Boolean(imageDetails)}
        title="Image details"
        description="Describe this screenshot for readers using assistive technology and add an optional caption."
        onClose={() => setImageDetails(null)}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setImageDetails(null)}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={applyImageDetails} disabled={disabled}>Update image</button>
          </>
        }
      >
        <label className="field">
          <span className="field-label">Alt text</span>
          <input value={imageDetails?.alt ?? ''} onChange={event => setImageDetails(current => current ? { ...current, alt: event.target.value } : null)} maxLength={250} />
        </label>
        {selectedBlock?.tagName === 'FIGURE' && (
          <label className="field">
            <span className="field-label">Caption</span>
            <input value={imageDetails?.caption ?? ''} onChange={event => setImageDetails(current => current ? { ...current, caption: event.target.value } : null)} />
          </label>
        )}
      </Modal>

      <HtmlSnippetDialog open={htmlDialogOpen} onClose={() => setHtmlDialogOpen(false)} onInsert={insertPayload} />

      <Modal
        open={linkDialog.open}
        title={linkDialog.editing ? 'Edit link' : 'Add a link'}
        description={'New-tab links are saved with rel="noopener noreferrer nofollow", and unsafe destinations are rejected.'}
        onClose={closeLinkDialog}
        size="sm"
        className="link-modal"
        initialFocus={linkUrlRef}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={closeLinkDialog}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={applyLink}>
              {linkDialog.editing ? 'Update link' : 'Add link'}
            </button>
          </>
        }
      >
        <label className="field">
          <span className="field-label">Link to</span>
          <input
            ref={linkUrlRef}
            value={linkDialog.url}
            onChange={event => {
              setLinkError(null);
              setLinkDialog(current => ({ ...current, url: event.target.value }));
            }}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyLink();
              }
            }}
            placeholder="https://rown.xyz/about"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-invalid={Boolean(linkError) || undefined}
          />
        </label>
        <label className="field">
          <span className="field-label">Text to show</span>
          <input
            value={linkDialog.text}
            onChange={event => setLinkDialog(current => ({ ...current, text: event.target.value }))}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyLink();
              }
            }}
            placeholder={linkDialog.url.trim() || 'Read the announcement'}
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={linkDialog.newTab}
            onChange={event => setLinkDialog(current => ({ ...current, newTab: event.target.checked }))}
          />
          <span>Open in a new tab</span>
        </label>
        {linkError && (
          <p className="field-error" role="alert">
            {linkError}
          </p>
        )}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** True for markup that holds no readable content (what a fresh editor looks like). */
function isEmptyMarkup(html: string): boolean {
  const trimmed = (html ?? '').trim();
  if (!trimmed) return true;
  return /^(?:\s|<br\s*\/?>|<p>(?:\s|&nbsp;|<br\s*\/?>|\u200b)*<\/p>|<div>(?:\s|<br\s*\/?>)*<\/div>)*$/i.test(trimmed);
}

function plainTextToHtml(text: string): string {
  const escaped = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  if (!escaped.includes('\n')) return escaped;
  return escaped
    .split(/\n{2,}/)
    .map(block => `<p>${block.replace(/\n/g, '<br>')}</p>`)
    .join('');
}
