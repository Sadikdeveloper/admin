import { afterEach, describe, expect, it } from 'vitest';
import {
  bookmarkEditorRange,
  editorEnd,
  insertEditorBlocks,
  insertEditorHtml,
  rangeIsInEditor,
} from '../blog-editor';

let editor: HTMLDivElement;

function setup(html: string) {
  editor = document.createElement('div');
  editor.innerHTML = html;
  document.body.appendChild(editor);
  return editor;
}

function caret(node: Node, offset: number) {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  return range;
}

function image(src = '/step.png') {
  const figure = document.createElement('figure');
  const img = document.createElement('img');
  img.src = src;
  figure.appendChild(img);
  return figure;
}

afterEach(() => editor?.remove());

describe('blog editor insertion', () => {
  it('splits a paragraph at the caret and continues there, not at the article end', () => {
    setup('<p>BeforeAfter</p><p>Later step</p>');
    const figure = image();
    const next = insertEditorBlocks(editor, caret(editor.firstChild!.firstChild!, 6), [figure]);
    expect(editor.innerHTML).toBe('<p>Before</p><figure><img src="/step.png"></figure><p>After</p><p>Later step</p>');
    expect(next?.startContainer).toBe(figure.nextSibling);
    expect(next?.startOffset).toBe(0);
    expect(editor.lastChild?.textContent).toBe('Later step');
  });

  it('preserves formatting on both halves of the paragraph', () => {
    setup('<p><strong>BeforeAfter</strong> <em>tail</em></p>');
    insertEditorBlocks(editor, caret(editor.querySelector('strong')!.firstChild!, 6), [image()]);
    expect(editor.innerHTML).toBe('<p><strong>Before</strong></p><figure><img src="/step.png"></figure><p><strong>After</strong> <em>tail</em></p>');
  });

  it('keeps repeated screenshots in order with a typing paragraph after each insertion', () => {
    setup('<p>Step one</p><p>Next section</p>');
    let range = caret(editor.firstChild!.firstChild!, 8);
    range = insertEditorBlocks(editor, range, [image('/one.png')])!;
    range = insertEditorBlocks(editor, range, [image('/two.png')])!;
    expect(Array.from(editor.querySelectorAll('img')).map(img => img.getAttribute('src'))).toEqual(['/one.png', '/two.png']);
    expect(editor.querySelectorAll('figure').item(1).nextSibling).toBe(range.startContainer);
    expect(range.startContainer.textContent).toBe('');
    expect(editor.lastChild?.textContent).toBe('Next section');
  });

  it('keeps an image in its numbered list step instead of appending after the whole list', () => {
    setup('<ol><li>BeforeAfter</li><li>Step two</li></ol>');
    const li = editor.querySelector('li')!;
    const range = insertEditorBlocks(editor, caret(li.firstChild!, 6), [image()]);
    expect(li.innerHTML).toBe('Before<figure><img src="/step.png"></figure><p>After</p>');
    expect(editor.querySelectorAll('li')).toHaveLength(2);
    expect(range?.startContainer.parentNode).toBe(li);
  });

  it('splits paragraphs inside a list item and a table cell without breaking their containers', () => {
    setup('<ul><li><p>BeforeAfter</p></li></ul><table><tbody><tr><td><p>Cell text</p></td></tr></tbody></table>');
    insertEditorBlocks(editor, caret(editor.querySelector('li p')!.firstChild!, 6), [image('/list.png')]);
    insertEditorBlocks(editor, caret(editor.querySelector('td p')!.firstChild!, 4), [image('/cell.png')]);
    expect(editor.querySelector('li figure img')?.getAttribute('src')).toBe('/list.png');
    expect(editor.querySelector('td figure img')?.getAttribute('src')).toBe('/cell.png');
    expect(editor.querySelector('td')?.textContent).toBe('Cell text');
    expect(editor.querySelectorAll('li')).toHaveLength(1);
    expect(editor.querySelectorAll('td')).toHaveLength(1);
  });

  it('places screenshots after a code block, not inside its code', () => {
    setup('<pre><code>const value = 1;</code></pre><p>After</p>');
    const next = insertEditorBlocks(editor, caret(editor.querySelector('code')!.firstChild!, 5), [image()]);
    expect(editor.firstChild?.textContent).toBe('const value = 1;');
    expect(editor.children[1].tagName).toBe('FIGURE');
    expect(editor.children[2]).toBe(next?.startContainer);
  });

  it('handles a surface containing bare inline text and keeps later blocks in place', () => {
    setup('<strong>BeforeAfter</strong><p>Last</p>');
    insertEditorBlocks(editor, caret(editor.querySelector('strong')!.firstChild!, 6), [image()]);
    expect(editor.innerHTML).toBe('<strong>Before</strong><figure><img src="/step.png"></figure><p><strong>After</strong></p><p>Last</p>');
  });

  it('inserts inline HTML inline, replaces the selected text, and sanitizes first', () => {
    setup('<p>First replace last</p>');
    const range = caret(editor.firstChild!.firstChild!, 6);
    range.setEnd(editor.firstChild!.firstChild!, 13);
    const next = insertEditorHtml(editor, range, '<b onclick="steal()">safe</b><script>bad()</script>');
    expect(editor.innerHTML).toBe('<p>First <strong>safe</strong> last</p>');
    expect(rangeIsInEditor(editor, next)).toBe(true);
  });

  it('inserts mixed block snippets in their given order without nesting a table in a paragraph', () => {
    setup('<p>BeforeAfter</p>');
    insertEditorHtml(editor, caret(editor.firstChild!.firstChild!, 6), '<h2>Step</h2>Text<table><tr><td>Cell</td></tr></table><p>Instructions</p>');
    expect(Array.from(editor.children).map(element => element.tagName)).toEqual(['P', 'H2', 'P', 'TABLE', 'P', 'P']);
    expect(editor.querySelector('p table')).toBeNull();
    expect(editor.textContent).toBe('BeforeStepTextCellInstructionsAfter');
  });

  it('does not insert an unsafe-only snippet or write through a detached range', () => {
    setup('<p>Old</p>');
    const range = editorEnd(editor);
    expect(insertEditorHtml(editor, range, '<script>alert(1)</script>')).toBeNull();
    const oldText = editor.firstChild!.firstChild!;
    editor.innerHTML = '<p>Replacement</p>';
    const detached = caret(oldText, 1);
    expect(insertEditorBlocks(editor, detached, [image()])).toBeNull();
    expect(editor.innerHTML).toBe('<p>Replacement</p>');
  });

  it('bookmarks a cursor in extracted text so delayed uploads do not move the writer', () => {
    setup('<p>BeforeAfter</p><p>Last</p>');
    const insertion = caret(editor.firstChild!.firstChild!, 6);
    const current = caret(editor.firstChild!.firstChild!, 10);
    const restore = bookmarkEditorRange(editor, current);
    insertEditorBlocks(editor, insertion, [image()]);
    const restored = restore()!;
    const tail = editor.children[2];
    expect(tail.contains(restored.startContainer)).toBe(true);
    const beforeCaret = document.createRange();
    beforeCaret.selectNodeContents(tail);
    beforeCaret.setEnd(restored.startContainer, restored.startOffset);
    expect(beforeCaret.toString()).toBe('Afte');
    expect(editor.innerHTML).not.toContain('data-cms-bookmark');
    expect(editor.textContent).toBe('BeforeAfterLast');
  });
});
