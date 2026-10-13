import { useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import type { ClipboardEvent, DragEvent, KeyboardEvent, ReactNode, Ref } from 'react';
import {
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
  Quote,
  Redo2,
  RemoveFormatting,
  SquareCode,
  Strikethrough,
  Underline,
  Undo2,
} from 'lucide-react';
import { Modal } from '../../components/Modal';
import { countWords, readingMinutes, sanitizeBlogHtml, sanitizeUrl } from '../../lib/blog-html';

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

/** Blocks we split at the caret when inserting an image or divider. */
const SPLIT_HOSTS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
/** Blocks we insert after, because splitting them would break their structure. */
const AFTER_HOSTS = new Set(['UL', 'OL', 'LI', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'FIGURE', 'PRE', 'DL']);
const TEXT_BLOCKS = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'DIV'];

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
  disabled?: boolean;
  invalid?: boolean;
  error?: string | null;
  placeholder?: string;
  label?: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
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
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) savedRange.current = range.cloneRange();
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
    if (editor.innerHTML !== next) editor.innerHTML = next;
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
      updateToolbar();
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [updateToolbar]);

  /* ---------------------------------------------------------------- */
  /* Block insertion (images, dividers)                                */
  /* ---------------------------------------------------------------- */

  const closestBlock = (node: Node | null): Element | null => {
    const editor = editorRef.current;
    let current = closestElement(node);
    while (current && current !== editor) {
      if (SPLIT_HOSTS.has(current.tagName) || AFTER_HOSTS.has(current.tagName) || current.tagName === 'DIV') return current;
      current = current.parentElement;
    }
    return null;
  };

  const outermostBlock = (node: Element): Element | null => {
    const editor = editorRef.current;
    if (!editor) return null;
    let current: Element = node;
    while (current.parentElement && current.parentElement !== editor) current = current.parentElement;
    return current === editor ? null : current;
  };

  /** Makes sure there is always somewhere to type after an inserted block. */
  const ensureTrailingParagraph = (): HTMLElement | null => {
    const editor = editorRef.current;
    if (!editor) return null;
    const children = Array.from(editor.children);
    const last = children.length ? children[children.length - 1] : null;
    if (last && TEXT_BLOCKS.includes(last.tagName)) return null;
    const paragraph = document.createElement('p');
    paragraph.appendChild(document.createElement('br'));
    editor.appendChild(paragraph);
    return paragraph;
  };

  const insertBlockElements = useCallback(
    (elements: Element[]) => {
      const editor = editorRef.current;
      if (!editor || !elements.length || disabled || sourceMode) return;

      const range = restoreSelection();
      const selection = window.getSelection();
      if (!range || !selection) return;
      range.deleteContents();

      const host = closestBlock(range.startContainer);
      const last = elements[elements.length - 1];

      if (host && host !== editor && SPLIT_HOSTS.has(host.tagName)) {
        // Split the paragraph at the caret so the block sits between the halves
        // instead of being nested inside a <p>.
        const tail = document.createRange();
        tail.selectNodeContents(host);
        try {
          tail.setStart(range.endContainer, range.endOffset);
        } catch {
          tail.setStartAfter(host.lastChild ?? host);
        }
        const tailFragment = tail.extractContents();
        const parent = host.parentNode ?? editor;
        const reference = host.nextSibling;

        elements.forEach(element => parent.insertBefore(element, reference));

        const tailHasContent = (tailFragment.textContent ?? '').trim() || tailFragment.querySelector('img, hr, li');
        if (tailHasContent) {
          const clone = host.cloneNode(false) as Element;
          clone.appendChild(tailFragment);
          parent.insertBefore(clone, reference);
        } else if (!(host.textContent ?? '').trim() && !host.querySelector('img, hr')) {
          host.remove();
        }
      } else if (host && host !== editor && AFTER_HOSTS.has(host.tagName)) {
        const outer = outermostBlock(host) ?? host;
        const parent = outer.parentNode ?? editor;
        const reference = outer.nextSibling;
        elements.forEach(element => parent.insertBefore(element, reference));
      } else {
        const fragment = document.createDocumentFragment();
        elements.forEach(element => fragment.appendChild(element));
        range.insertNode(fragment);
      }

      const trailing = ensureTrailingParagraph();
      const caret = document.createRange();
      if (trailing) {
        caret.selectNodeContents(trailing);
        caret.collapse(true);
      } else {
        caret.setStartAfter(last);
        caret.collapse(true);
      }
      selection.removeAllRanges();
      selection.addRange(caret);
      savedRange.current = caret.cloneRange();

      sync();
      updateToolbar();
    },
    [disabled, sourceMode, restoreSelection, sync, updateToolbar],
  );

  const insertImage = useCallback(
    (image: InsertedImage) => {
      const src = sanitizeUrl(image.src ?? '', false);
      if (!src) return;
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
      insertBlockElements([figure]);
    },
    [insertBlockElements],
  );

  useImperativeHandle(
    ref,
    () => ({
      insertImage,
      focus: () => {
        if (sourceMode) return;
        restoreSelection();
      },
    }),
    [insertImage, restoreSelection, sourceMode],
  );

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
      if (!html) return;
      restoreSelection();
      try {
        document.execCommand('insertHTML', false, html);
      } catch {
        return;
      }
      sync();
    },
    [restoreSelection, sync],
  );

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    // Pasting from Word/Docs/Notion brings styles and scripts the API strips
    // anyway, so clean it here and the editor keeps showing the truth.
    event.preventDefault();
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const html = clipboard.getData('text/html');
    if (html) {
      insertPayload(sanitizeBlogHtml(html));
      return;
    }
    const text = clipboard.getData('text/plain');
    if (text) insertPayload(plainTextToHtml(text));
  };

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!onUploadFile || !files.length) return;
      setUploading(current => current + files.length);
      for (const file of files) {
        try {
          const image = await onUploadFile(file);
          if (image) insertImage(image);
        } finally {
          setUploading(current => Math.max(0, current - 1));
        }
      }
    },
    [insertImage, onUploadFile],
  );

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const files = Array.from(event.dataTransfer?.files ?? []).filter(file => file.type.startsWith('image/') || !file.type);
    if (files.length) {
      void uploadFiles(files);
      return;
    }
    const html = event.dataTransfer?.getData('text/html');
    if (html) {
      insertPayload(sanitizeBlogHtml(html));
      return;
    }
    const text = event.dataTransfer?.getData('text/plain');
    if (text) insertPayload(plainTextToHtml(text));
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
    setSourceDraft(sanitizeBlogHtml(value ?? ''));
    setSourceNotice(null);
    setSourceMode(true);
  };

  const exitSourceMode = () => {
    const clean = sanitizeBlogHtml(sourceDraft);
    setSourceNotice(
      clean === sourceDraft.trim()
        ? null
        : 'Some HTML was removed. The blog only keeps safe tags — scripts, inline styles, iframes and non-https images are stripped.',
    );
    setSourceMode(false);
    /*
     * The contenteditable is unmounted while the textarea is showing, so the
     * change has to be published from here — waiting for the surface would
     * silently throw the edit away.
     */
    lastHtml.current = clean;
    hydrated.current = true;
    onChange(clean);
    const editor = editorRef.current;
    if (editor) {
      editor.innerHTML = clean;
      refreshMeta();
      updateToolbar();
    }
  };

  const tooLarge = (value ?? '').length > HTML_SOFT_LIMIT;
  const canInsertImage = !disabled && Boolean(onPickImage || onUploadFile);

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  return (
    <div className={`rte${disabled ? ' rte-disabled' : ''}${invalid ? ' rte-invalid' : ''}`}>
      <div className="rte-toolbar" role="toolbar" aria-label="Text formatting" aria-controls={surfaceId}>
        <div className="rte-group">
          <ToolButton disabled={disabled} label="Paragraph" active={toolbar.block === 'p' || toolbar.block === 'div' || toolbar.block === 'body'} onClick={() => exec('formatBlock', '<p>')}>
            <span className="rte-glyph" aria-hidden="true">
              ¶
            </span>
          </ToolButton>
          <ToolButton disabled={disabled} label="Section heading" active={toolbar.block === 'h2'} onClick={() => exec('formatBlock', '<h2>')}>
            <Heading2 size={16} />
          </ToolButton>
          <ToolButton disabled={disabled} label="Subheading" active={toolbar.block === 'h3'} onClick={() => exec('formatBlock', '<h3>')}>
            <Heading3 size={16} />
          </ToolButton>
        </div>
        <ToolDivider />
        <div className="rte-group">
          <ToolButton disabled={disabled} label="Bold" shortcut="Ctrl/⌘ + B" active={toolbar.bold} onClick={() => exec('bold')}>
            <Bold size={16} />
          </ToolButton>
          <ToolButton disabled={disabled} label="Italic" shortcut="Ctrl/⌘ + I" active={toolbar.italic} onClick={() => exec('italic')}>
            <Italic size={16} />
          </ToolButton>
          <ToolButton disabled={disabled} label="Underline" shortcut="Ctrl/⌘ + U" active={toolbar.underline} onClick={() => exec('underline')}>
            <Underline size={16} />
          </ToolButton>
          <ToolButton disabled={disabled} label="Strikethrough" active={toolbar.strike} onClick={() => exec('strikeThrough')}>
            <Strikethrough size={16} />
          </ToolButton>
          <ToolButton disabled={disabled} label="Inline code" active={toolbar.code} onClick={toggleInlineCode}>
            <Code size={16} />
          </ToolButton>
          <ToolButton disabled={disabled} label="Clear formatting" onClick={() => exec('removeFormat')}>
            <RemoveFormatting size={16} />
          </ToolButton>
        </div>
        <ToolDivider />
        <div className="rte-group">
          <ToolButton disabled={disabled} label="Bulleted list" active={toolbar.bulletList} onClick={() => exec('insertUnorderedList')}>
            <List size={16} />
          </ToolButton>
          <ToolButton disabled={disabled} label="Numbered list" active={toolbar.orderedList} onClick={() => exec('insertOrderedList')}>
            <ListOrdered size={16} />
          </ToolButton>
          <ToolButton disabled={disabled} label="Quote" active={toolbar.block === 'blockquote'} onClick={() => exec('formatBlock', '<blockquote>')}>
            <Quote size={16} />
          </ToolButton>
          <ToolButton disabled={disabled} label="Code block" active={toolbar.block === 'pre'} onClick={() => exec('formatBlock', '<pre>')}>
            <SquareCode size={16} />
          </ToolButton>
          <ToolButton disabled={disabled} label="Divider" onClick={() => insertBlockElements([document.createElement('hr')])}>
            <Minus size={16} />
          </ToolButton>
        </div>
        <ToolDivider />
        <div className="rte-group">
          <ToolButton disabled={disabled} label="Add or edit a link" shortcut="Ctrl/⌘ + K" active={toolbar.link} onClick={openLinkDialog}>
            <Link2 size={16} />
          </ToolButton>
          <ToolButton disabled={disabled || !toolbar.link} label="Remove link" onClick={removeLink}>
            <Link2Off size={16} />
          </ToolButton>
          <ToolButton disabled={disabled || !canInsertImage} label="Insert image" onClick={() => onPickImage?.()}>
            <ImagePlus size={16} />
          </ToolButton>
        </div>
        <ToolDivider />
        <div className="rte-group">
          <ToolButton disabled={disabled} label="Undo" shortcut="Ctrl/⌘ + Z" onClick={() => exec('undo')}>
            <Undo2 size={16} />
          </ToolButton>
          <ToolButton disabled={disabled} label="Redo" shortcut="Ctrl/⌘ + Y" onClick={() => exec('redo')}>
            <Redo2 size={16} />
          </ToolButton>
          <ToolButton disabled={disabled} label={sourceMode ? 'Back to the visual editor' : 'Edit HTML'} active={sourceMode} onClick={() => (sourceMode ? exitSourceMode() : enterSourceMode())}>
            <Braces size={16} />
          </ToolButton>
        </div>
      </div>

      {sourceMode ? (
        <div className="rte-source">
          <textarea
            value={sourceDraft}
            onChange={event => setSourceDraft(event.target.value)}
            spellCheck={false}
            aria-label="Article HTML"
            placeholder={'<p>Write or paste HTML here…</p>'}
          />
          <div className="rte-source-actions">
            <span className="rte-hint">Safe tags only — scripts, inline styles, iframes and non-https media are stripped.</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={exitSourceMode}>
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
            onInput={sync}
            onBlur={saveSelection}
            onKeyUp={saveSelection}
            onMouseUp={() => {
              saveSelection();
              updateToolbar();
            }}
            onPaste={onPaste}
            onDrop={onDrop}
            onDragOver={event => {
              if (disabled) return;
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onKeyDown={onKeyDown}
          />
          {uploading > 0 && (
            <div className="rte-busy-overlay" role="status">
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

      {sourceNotice && !sourceMode && (
        <p className="rte-notice" role="status">
          {sourceNotice}
        </p>
      )}
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
