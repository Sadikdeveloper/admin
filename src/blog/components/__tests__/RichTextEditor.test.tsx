import { createRef, useState } from 'react';
import type { Ref } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { RichTextEditor } from '../RichTextEditor';
import type { RichTextEditorHandle } from '../RichTextEditor';

const surface = () => screen.getByRole('textbox', { name: 'Article content' });

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
