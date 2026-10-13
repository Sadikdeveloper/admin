import { createRef, useState } from 'react';
import type { Ref } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RichTextEditor } from '../RichTextEditor';
import type { InsertedImage, RichTextEditorHandle } from '../RichTextEditor';
import { ImageUploadError } from '../../../lib/blog-images';

const surface = () => screen.getByRole('textbox', { name: 'Article content' });

function setCaret(node: Node, offset: number) {
  act(() => {
    surface().focus();
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  });
  fireEvent.mouseUp(surface());
}

function screenshot(name = 'step.png') {
  return new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: 'image/png' });
}

function pasteImage(file: File) {
  fireEvent.paste(surface(), { clipboardData: { files: [file], getData: () => '<img src="blob:temporary">' } });
}


/**
 * The editor is controlled by the post form, so the tests drive it the same
 * way: whatever it reports becomes the value it is given back.
 */
function Harness({
  initial = '',
  onChange = vi.fn(),
  editorRef,
  ...props
}: {
  initial?: string;
  onChange?: (html: string) => void;
  editorRef?: Ref<RichTextEditorHandle>;
} & Omit<React.ComponentProps<typeof RichTextEditor>, 'value' | 'onChange' | 'ref'>) {
  const [value, setValue] = useState(initial);
  return (
    <RichTextEditor
      ref={editorRef}
      value={value}
      onChange={html => {
        onChange(html);
        setValue(html);
      }}
      {...props}
    />
  );
}

describe('RichTextEditor', () => {
  it('renders an empty surface with somewhere for the caret to live', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    expect(surface().innerHTML).toBe('<p><br></p>');
    expect(surface().getAttribute('contenteditable')).toBe('true');
    expect(screen.getByText('nothing to read yet')).toBeTruthy();
    // An empty editor must not be reported as content.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the article it is opened with', () => {
    render(<Harness initial="<p>Stored copy</p>" />);
    expect(surface().innerHTML).toBe('<p>Stored copy</p>');
    expect(screen.getByText(/2 words/)).toBeTruthy();
  });

  it('reports what the operator types', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    act(() => {
      surface().innerHTML = '<p>Hello <strong>world</strong></p>';
    });
    fireEvent.input(surface());

    expect(onChange).toHaveBeenLastCalledWith('<p>Hello <strong>world</strong></p>');
    expect(surface().innerHTML).toBe('<p>Hello <strong>world</strong></p>');
    expect(screen.getByText(/2 words/)).toBeTruthy();
    expect(screen.getByText(/1 min read|nothing to read yet/)).toBeTruthy();
  });

  it('reports an empty string when only an empty paragraph is left', () => {
    const onChange = vi.fn();
    render(<Harness initial="<p>Text</p>" onChange={onChange} />);

    act(() => {
      surface().innerHTML = '<p><br></p>';
    });
    fireEvent.input(surface());

    expect(onChange).toHaveBeenLastCalledWith('');
    // …and the caret home is restored rather than left as a blank div.
    expect(surface().innerHTML).toBe('<p><br></p>');
    expect(screen.getByText('nothing to read yet')).toBeTruthy();
  });

  it('takes a replacement value from the parent', () => {
    const onChange = vi.fn();
    const { rerender } = render(<RichTextEditor value="<p>One</p>" onChange={onChange} />);
    expect(surface().innerHTML).toBe('<p>One</p>');

    rerender(<RichTextEditor value="<p>Two</p>" onChange={onChange} />);
    expect(surface().innerHTML).toBe('<p>Two</p>');

    // Restoring a saved draft must not be reported back as a new edit.
    rerender(<RichTextEditor value="<p>Two</p>" onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('inserts an image as a figure through the editor handle', () => {
    const onChange = vi.fn();
    const ref = createRef<RichTextEditorHandle>();
    render(<Harness editorRef={ref} initial="<p>Before</p>" onChange={onChange} />);

    act(() => {
      ref.current?.insertImage({ src: 'https://cdn.rown.xyz/a.png', alt: 'Cover', caption: 'Launch day' });
    });

    const html = String(onChange.mock.calls.at(-1)?.[0] ?? '');
    expect(html).toContain('<p>Before</p>');
    expect(html).toContain('<figure class="cms-figure">');
    expect(html).toMatch(/<img src="https:\/\/cdn\.rown\.xyz\/a\.png" alt="Cover"/);
    expect(html).toContain('<figcaption>Launch day</figcaption>');
    expect(surface().querySelector('img')).toBeTruthy();
  });

  it('refuses to insert an unsafe image source', () => {
    const onChange = vi.fn();
    const ref = createRef<RichTextEditorHandle>();
    render(<Harness editorRef={ref} initial="<p>Before</p>" onChange={onChange} />);

    act(() => {
      ref.current?.insertImage({ src: 'javascript:alert(1)', alt: 'x' });
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(surface().querySelector('img')).toBeNull();
  });

  it('edits raw HTML in source mode and strips anything unsafe on the way out', () => {
    const onChange = vi.fn();
    render(<Harness initial="<p>Kept</p>" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit HTML' }));
    const textarea = screen.getByLabelText('Article HTML') as HTMLTextAreaElement;
    expect(textarea.value).toBe('<p>Kept</p>');

    fireEvent.change(textarea, {
      target: {
        value: '<p onclick="steal()">Kept</p><script>alert(1)</script><img src="https://cdn.rown.xyz/b.png" alt="B">',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Back to editor' }));

    expect(onChange).toHaveBeenLastCalledWith('<p>Kept</p><img src="https://cdn.rown.xyz/b.png" alt="B">');
    expect(screen.getByRole('status').textContent).toMatch(/some html was removed/i);
    expect(surface().innerHTML).toBe('<p>Kept</p><img src="https://cdn.rown.xyz/b.png" alt="B">');
  });

  it('keeps a source-mode edit even though the surface is unmounted meanwhile', () => {
    const onChange = vi.fn();
    render(<Harness initial="" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit HTML' }));
    fireEvent.change(screen.getByLabelText('Article HTML'), { target: { value: '<h2>Written as HTML</h2>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back to editor' }));

    expect(onChange).toHaveBeenCalledWith('<h2>Written as HTML</h2>');
    expect(surface().innerHTML).toBe('<h2>Written as HTML</h2>');
  });

  it('goes read-only when disabled', () => {
    render(<Harness initial="<p>Locked</p>" disabled />);
    expect(surface().getAttribute('contenteditable')).toBe('false');
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Add or edit a link' })).toHaveProperty('disabled', true);
  });

  it('flags an invalid state for assistive tech and shows the message', () => {
    render(
      <Harness
        invalid
        error="Write the article before publishing — the API refuses to publish an empty post."
      />,
    );
    expect(surface().getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toMatch(/write the article/i);
  });

  it('warns before an article grows past what the API accepts', () => {
    const huge = `<p>${'x'.repeat(1000)}</p>`.repeat(1000); // ~1 MB
    render(<Harness initial={huge} />);
    expect(screen.getByRole('alert').textContent).toMatch(/over 900 KB/i);
  });

  it('asks the parent to open the media library', () => {
    const onPickImage = vi.fn();
    render(<Harness onPickImage={onPickImage} />);
    fireEvent.click(screen.getByRole('button', { name: /image/i }));
    expect(onPickImage).toHaveBeenCalled();
  });
});


describe('RichTextEditor · tutorial authoring', () => {
  it('inserts between tutorial steps and puts the caret immediately below the image', () => {
    const ref = createRef<RichTextEditorHandle>();
    render(<Harness editorRef={ref} initial="<p>First step</p><p>Later step</p>" />);
    setCaret(surface().firstChild!.firstChild!, 10);
    act(() => ref.current?.insertImage({ src: '/one.png' }));
    const figure = surface().querySelector('figure')!;
    expect(figure.previousSibling?.textContent).toBe('First step');
    expect(figure.nextSibling?.textContent).toBe('');
    expect(window.getSelection()?.getRangeAt(0).startContainer).toBe(figure.nextSibling);
    expect(surface().lastChild?.textContent).toBe('Later step');
  });

  it('remembers the image insertion point while the picker takes the selection', () => {
    const ref = createRef<RichTextEditorHandle>();
    const onPickImage = vi.fn(() => window.getSelection()?.removeAllRanges());
    render(<Harness editorRef={ref} initial="<p>BeforeAfter</p><p>Last</p>" onPickImage={onPickImage} />);
    setCaret(surface().firstChild!.firstChild!, 6);
    fireEvent.click(screen.getByRole('button', { name: 'Insert image' }));
    act(() => ref.current?.insertImage({ src: '/step.png' }));
    expect(surface().children[0].textContent).toBe('Before');
    expect(surface().children[1].tagName).toBe('FIGURE');
    expect(surface().children[2].textContent).toBe('After');
  });

  it('can move, describe and remove an inline screenshot without touching the cover', () => {
    const onChange = vi.fn();
    render(<Harness initial='<p>Step one</p><figure><img src="/one.png" alt=""><figcaption>Old</figcaption></figure><p>Step two</p>' onChange={onChange} />);
    fireEvent.click(surface().querySelector('img')!);
    fireEvent.click(screen.getByRole('button', { name: 'Move image up' }));
    expect(surface().firstElementChild?.tagName).toBe('FIGURE');
    fireEvent.click(screen.getByRole('button', { name: 'Move image down' }));
    expect(surface().children[1].tagName).toBe('FIGURE');
    fireEvent.click(screen.getByRole('button', { name: 'Image details' }));
    const dialog = screen.getByRole('dialog', { name: 'Image details' });
    fireEvent.change(within(dialog).getByLabelText('Alt text'), { target: { value: 'The transfer form' } });
    fireEvent.change(within(dialog).getByLabelText('Caption'), { target: { value: 'Fill in the recipient details' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update image' }));
    expect(surface().querySelector('img')?.alt).toBe('The transfer form');
    expect(surface().querySelector('figcaption')?.textContent).toBe('Fill in the recipient details');
    fireEvent.click(screen.getByRole('button', { name: 'Remove image from article' }));
    expect(surface().querySelector('img')).toBeNull();
    expect(surface().textContent).toBe('Step oneStep two');
    expect(onChange).toHaveBeenLastCalledWith('<p>Step one</p><p>Step two</p>');
  });

  it('inserts a safe HTML snippet at the saved cursor with a sanitized preview', () => {
    render(<Harness initial="<p>BeforeAfter</p><p>Last</p>" />);
    setCaret(surface().firstChild!.firstChild!, 6);
    fireEvent.click(screen.getByRole('button', { name: 'Insert HTML' }));
    const dialog = screen.getByRole('dialog', { name: 'Insert HTML at the cursor' });
    fireEvent.change(within(dialog).getByLabelText('HTML snippet'), { target: { value: '<h2 onclick="bad()">Step two</h2><table><tr><td>Example</td></tr></table><script>bad()</script>' } });
    const preview = within(dialog).getByRole('region', { name: 'HTML snippet preview' });
    expect(preview.innerHTML).toContain('Step two');
    expect(preview.innerHTML).not.toMatch(/onclick|<script/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Insert into article' }));
    expect(Array.from(surface().children).map(node => node.tagName)).toEqual(['P', 'H2', 'TABLE', 'P', 'P']);
    expect(surface().textContent).toBe('BeforeStep twoExampleAfterLast');
    expect(surface().innerHTML).not.toMatch(/onclick|<script/);
  });

  it('does not enable insertion for a snippet containing only unsafe markup', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Insert HTML' }));
    fireEvent.change(screen.getByLabelText('HTML snippet'), { target: { value: '<script>bad()</script><iframe src="https://example.com"></iframe>' } });
    expect(screen.getByRole('button', { name: 'Insert into article' })).toHaveProperty('disabled', true);
  });

  it('reports source changes immediately so saving or previewing does not require switching modes', () => {
    const onChange = vi.fn();
    render(<Harness initial="<p>Old</p>" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit HTML' }));
    fireEvent.change(screen.getByLabelText('Article HTML'), { target: { value: '<h2>New HTML</h2><p>Latest body</p>' } });
    expect(onChange).toHaveBeenLastCalledWith('<h2>New HTML</h2><p>Latest body</p>');
    expect(screen.getByText(/4 words/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Insert HTML' })).toHaveProperty('disabled', true);
  });

  it('honors disabled state in source mode and adopts an external replacement', () => {
    const onChange = vi.fn();
    const { rerender } = render(<RichTextEditor value="<p>Original</p>" onChange={onChange} onPickImage={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit HTML' }));
    rerender(<RichTextEditor value="<p>Saved version</p>" onChange={onChange} onPickImage={vi.fn()} disabled />);
    expect(screen.getByLabelText('Article HTML')).toHaveProperty('value', '<p>Saved version</p>');
    expect(screen.getByLabelText('Article HTML')).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Insert image' })).toHaveProperty('disabled', true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('cleans incoming HTML before it can be displayed in the visual editor', () => {
    render(<Harness initial='<p onclick="steal()"><b>Safe</b></p><script>bad()</script><img src="javascript:bad()">' />);
    expect(surface().innerHTML).toBe('<p><strong>Safe</strong></p>');
  });

  it('cleans pasted HTML and escapes plain-text tags rather than executing them', () => {
    render(<Harness initial="<p>Start</p>" />);
    setCaret(surface().firstChild!.firstChild!, 5);
    fireEvent.paste(surface(), { clipboardData: { getData: (type: string) => type === 'text/html' ? '<b onclick="bad()"> bold</b><script>bad()</script>' : '' } });
    expect(surface().innerHTML).toBe('<p>Start<strong> bold</strong></p>');
    fireEvent.paste(surface(), { clipboardData: { getData: (type: string) => type === 'text/plain' ? '<script>literal</script>' : '' } });
    expect(surface().querySelector('script')).toBeNull();
    expect(surface().textContent).toContain('<script>literal</script>');
  });

  it('uploads a pasted screenshot at the original cursor, even if typing moves elsewhere', async () => {
    let finish!: (image: InsertedImage) => void;
    const onUploadFile = vi.fn(() => new Promise<InsertedImage>(resolve => { finish = resolve; }));
    const uploading = vi.fn();
    render(<Harness initial="<p>BeforeAfter</p><p>Other step</p>" onUploadFile={onUploadFile} onUploadingChange={uploading} />);
    setCaret(surface().firstChild!.firstChild!, 6);
    pasteImage(screenshot());
    await waitFor(() => expect(onUploadFile).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Edit HTML' })).toHaveProperty('disabled', true);
    setCaret(surface().lastChild!.firstChild!, 5);
    await act(async () => finish({ src: '/uploaded.png', alt: 'Screenshot' }));
    expect(surface().children[0].textContent).toBe('Before');
    expect(surface().children[1].tagName).toBe('FIGURE');
    expect(surface().children[2].textContent).toBe('After');
    const current = window.getSelection()!.getRangeAt(0);
    expect(surface().lastChild!.contains(current.startContainer)).toBe(true);
    expect(document.activeElement).toBe(surface());
    expect(surface().innerHTML).not.toContain('data-cms-bookmark');
    await waitFor(() => expect(uploading).toHaveBeenLastCalledWith(0));
  });

  it('supports screenshot clipboards exposing file items rather than files', async () => {
    const file = screenshot();
    const onUploadFile = vi.fn(async () => ({ src: '/clipboard.png' }));
    render(<Harness onUploadFile={onUploadFile} />);
    fireEvent.paste(surface(), { clipboardData: { files: [], items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }], getData: () => '' } });
    await waitFor(() => expect(surface().querySelector('img')?.getAttribute('src')).toBe('/clipboard.png'));
    expect(onUploadFile).toHaveBeenCalledWith(file);
  });

  it('uploads selected files sequentially and inserts every image, not just the last one', async () => {
    let inFlight = 0;
    let maximum = 0;
    const onUploadFile = vi.fn(async (file: File) => {
      inFlight += 1;
      maximum = Math.max(maximum, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { src: `/${file.name}` };
    });
    render(<Harness initial="<p>Step</p><p>End</p>" onUploadFile={onUploadFile} />);
    setCaret(surface().firstChild!.firstChild!, 4);
    fireEvent.change(screen.getByLabelText('Upload inline images'), { target: { files: [screenshot('one.png'), screenshot('two.png')] } });
    await waitFor(() => expect(surface().querySelectorAll('img')).toHaveLength(2));
    expect(maximum).toBe(1);
    expect(Array.from(surface().querySelectorAll('img')).map(img => img.getAttribute('src'))).toEqual(['/one.png', '/two.png']);
    expect(surface().lastChild?.textContent).toBe('End');
  });

  it('uses the drop location rather than the last typing position', async () => {
    const onUploadFile = vi.fn(async () => ({ src: '/dropped.png' }));
    render(<Harness initial="<p>First</p><p>BeforeAfter</p>" onUploadFile={onUploadFile} />);
    setCaret(surface().firstChild!.firstChild!, 0);
    const dropRange = document.createRange();
    dropRange.setStart(surface().lastChild!.firstChild!, 6);
    dropRange.collapse(true);
    const original = Object.getOwnPropertyDescriptor(document, 'caretRangeFromPoint');
    Object.defineProperty(document, 'caretRangeFromPoint', { configurable: true, value: vi.fn(() => dropRange) });
    try {
      fireEvent.drop(surface(), { clientX: 10, clientY: 10, dataTransfer: { files: [screenshot()], getData: () => '' } });
      await waitFor(() => expect(surface().querySelector('img')).toBeTruthy());
      expect(surface().children[0].textContent).toBe('First');
      expect(surface().children[1].textContent).toBe('Before');
      expect(surface().children[2].tagName).toBe('FIGURE');
      expect(surface().children[3].textContent).toBe('After');
    } finally {
      if (original) Object.defineProperty(document, 'caretRangeFromPoint', original);
      else Reflect.deleteProperty(document, 'caretRangeFromPoint');
    }
  });

  it('shows an upload failure, keeps the article and allows the next upload', async () => {
    const onUploadFile = vi.fn().mockRejectedValueOnce(new Error('Storage is not configured')).mockResolvedValueOnce({ src: '/next.png' });
    render(<Harness initial="<p>Keep this</p>" onUploadFile={onUploadFile} />);
    pasteImage(screenshot('bad.png'));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Storage is not configured');
    expect(surface().textContent).toBe('Keep this');
    pasteImage(screenshot('good.png'));
    await waitFor(() => expect(surface().querySelector('img')?.getAttribute('src')).toBe('/next.png'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not insert a delayed upload into an externally replaced article', async () => {
    let finish!: (image: InsertedImage) => void;
    const onUploadFile = vi.fn(() => new Promise<InsertedImage>(resolve => { finish = resolve; }));
    const { rerender } = render(<RichTextEditor value="<p>Old</p>" onChange={vi.fn()} onUploadFile={onUploadFile} />);
    setCaret(surface().firstChild!.firstChild!, 2);
    pasteImage(screenshot());
    await waitFor(() => expect(onUploadFile).toHaveBeenCalledTimes(1));
    rerender(<RichTextEditor value="<p>New version</p>" onChange={vi.fn()} onUploadFile={onUploadFile} />);
    await act(async () => finish({ src: '/late.png' }));
    expect(surface().innerHTML).toBe('<p>New version</p>');
    expect(screen.getByRole('alert').textContent).toMatch(/article changed/i);
  });
});


describe('RichTextEditor · image queues and moves', () => {
  it('does not report placeholder paragraphs as content when leaving HTML source', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit HTML' }));
    expect(screen.getByLabelText('Article HTML')).toHaveProperty('value', '');
    fireEvent.click(screen.getByRole('button', { name: 'Back to editor' }));
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(surface().innerHTML).toBe('<p><br></p>');
  });

  it.each(['rate', 'storage'] as const)('stops a bulk inline upload after a %s failure', async kind => {
    const onUploadFile = vi.fn().mockRejectedValue(new ImageUploadError({ kind, message: 'Upload unavailable', detail: 'Try later.' }));
    const uploading = vi.fn();
    render(<Harness onUploadFile={onUploadFile} onUploadingChange={uploading} />);
    fireEvent.change(screen.getByLabelText('Upload inline images'), { target: { files: [screenshot('one.png'), screenshot('two.png'), screenshot('three.png')] } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Upload unavailable Try later.'));
    await waitFor(() => expect(uploading).toHaveBeenLastCalledWith(0));
    expect(onUploadFile).toHaveBeenCalledTimes(1);
    expect(surface().querySelector('img')).toBeNull();
  });

  it('moves an internally dragged screenshot with its caption instead of duplicating it', () => {
    render(<Harness initial='<p>First</p><figure><img src="/one.png"><figcaption>Caption</figcaption></figure><p>Last</p>' />);
    const img = surface().querySelector('img')!;
    const drop = document.createRange();
    drop.setStart(surface().firstChild!.firstChild!, 0);
    drop.collapse(true);
    const original = Object.getOwnPropertyDescriptor(document, 'caretRangeFromPoint');
    Object.defineProperty(document, 'caretRangeFromPoint', { configurable: true, value: vi.fn(() => drop) });
    try {
      fireEvent.dragStart(img);
      fireEvent.drop(surface(), { dataTransfer: { files: [], getData: () => '<img src="/one.png">' } });
      expect(surface().querySelectorAll('img')).toHaveLength(1);
      expect(surface().firstElementChild?.tagName).toBe('FIGURE');
      expect(surface().querySelector('figcaption')?.textContent).toBe('Caption');
      expect(surface().textContent).toBe('CaptionFirstLast');
    } finally {
      if (original) Object.defineProperty(document, 'caretRangeFromPoint', original);
      else Reflect.deleteProperty(document, 'caretRangeFromPoint');
    }
  });
});


describe('RichTextEditor · pending uploads', () => {
  it('keeps successive pasted screenshots at the same cursor in their upload order', async () => {
    let finish!: (image: InsertedImage) => void;
    const upload = vi.fn().mockImplementationOnce(() => new Promise<InsertedImage>(resolve => { finish = resolve; })).mockResolvedValueOnce({ src: '/second.png' });
    render(<Harness initial="<p>BeforeAfter</p>" onUploadFile={upload} />);
    setCaret(surface().firstChild!.firstChild!, 6);
    pasteImage(screenshot('first.png'));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    pasteImage(screenshot('second.png'));
    await act(async () => finish({ src: '/first.png' }));
    await waitFor(() => expect(surface().querySelectorAll('img')).toHaveLength(2));
    expect(Array.from(surface().querySelectorAll('img')).map(img => img.getAttribute('src'))).toEqual(['/first.png', '/second.png']);
    expect(surface().textContent).toBe('BeforeAfter');
  });

  it('does not steal focus if the writer moves to a different form field while uploading', async () => {
    let finish!: (image: InsertedImage) => void;
    const upload = vi.fn(() => new Promise<InsertedImage>(resolve => { finish = resolve; }));
    render(<><input aria-label="Post title" /><Harness initial="<p>BeforeAfter</p>" onUploadFile={upload} /></>);
    setCaret(surface().firstChild!.firstChild!, 6);
    pasteImage(screenshot());
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    const title = screen.getByLabelText('Post title');
    act(() => title.focus());
    await act(async () => finish({ src: '/step.png' }));
    expect(surface().querySelector('img')).toBeTruthy();
    expect(document.activeElement).toBe(title);
  });
});
