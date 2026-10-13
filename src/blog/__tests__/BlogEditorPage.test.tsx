import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as blogApi from '../../api/blog';
import type { BlogPost } from '../../api/blog';
import { ApiError } from '../../api';
import { ToastProvider } from '../../components/Toast';
import { BLANK_POST_FORM } from '../../lib/blog-draft';
import { navGuard } from '../../lib/nav-guard';
import { BlogEditorPage } from '../BlogEditorPage';
import { uploadBlogImage } from '../../lib/blog-images';

vi.mock('../../api/blog', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api/blog')>();
  return {
    ...actual,
    getPost: vi.fn(),
    createPost: vi.fn(),
    updatePost: vi.fn(),
    publishPost: vi.fn(),
    unpublishPost: vi.fn(),
    deletePost: vi.fn(),
    listMedia: vi.fn(),
    uploadMedia: vi.fn(),
  };
});

vi.mock('../../lib/blog-images', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/blog-images')>();
  return { ...actual, uploadBlogImage: vi.fn() };
});

const POST_ID = '11111111-1111-4111-8111-111111111111';

const post = (overrides: Partial<BlogPost> = {}): BlogPost => ({
  id: POST_ID,
  title: 'Stored post',
  slug: 'stored-post',
  excerpt: null,
  content: null,
  contentHtml: '<p>Stored body</p>',
  coverImageUrl: null,
  coverImageAlt: null,
  category: 'Product updates',
  tags: ['payments'],
  authorName: 'Rown Team',
  canonicalUrl: null,
  seoTitle: null,
  seoDescription: null,
  status: 'DRAFT',
  publishedAt: null,
  createdByAdminAddress: '0x1',
  updatedByAdminAddress: '0x1',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
  ...overrides,
});

const titleInput = () => screen.getByPlaceholderText('Building better financial tools') as HTMLInputElement;
const slugInput = () => document.querySelector('#post-slug') as HTMLInputElement;
const article = () => screen.getByRole('textbox', { name: 'Article content' });
const button = (name: RegExp) => screen.getAllByRole('button', { name }).filter(node => !node.hasAttribute('disabled'))[0];

function renderEditor(postId: string | null = null, onNavigate = vi.fn()) {
  render(
    <ToastProvider>
      <BlogEditorPage postId={postId} adminLabel="Mock Operator" onNavigate={onNavigate} />
    </ToastProvider>,
  );
  return { onNavigate };
}

/** Labels appear in both the desktop sidebar and the mobile action bar. */
async function findText(pattern: RegExp | string): Promise<string> {
  const matches = await screen.findAllByText(pattern);
  expect(matches.length).toBeGreaterThan(0);
  return matches[0].textContent ?? '';
}

function writeArticle(html: string) {
  act(() => {
    article().innerHTML = html;
  });
  fireEvent.input(article());
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  navGuard.clear();
  navGuard.check({ name: 'blog' }); // consume address-swap allowances left by mocked navigation
  vi.mocked(blogApi.getPost).mockResolvedValue(post());
  vi.mocked(blogApi.createPost).mockImplementation(input =>
    Promise.resolve(post({ id: 'new-id', title: input.title ?? '', slug: 'generated-slug' })),
  );
  vi.mocked(blogApi.updatePost).mockImplementation((id, input) =>
    Promise.resolve(post({ id, title: input.title ?? 'Stored post' })),
  );
  vi.mocked(blogApi.publishPost).mockImplementation((id, publishAt) =>
    Promise.resolve(post({ id, status: 'PUBLISHED', publishedAt: publishAt ?? '2026-10-10T09:00:00.000Z' })),
  );
  vi.mocked(blogApi.unpublishPost).mockImplementation(id => Promise.resolve(post({ id, status: 'DRAFT', publishedAt: null })));
  vi.mocked(blogApi.deletePost).mockResolvedValue(undefined);
});

describe('BlogEditorPage · a brand new post', () => {
  it('starts empty and saves a draft the API can store', async () => {
    const { onNavigate } = renderEditor(null);

    expect(screen.getByRole('heading', { name: 'New post' })).toBeTruthy();
    expect(titleInput().value).toBe('');

    fireEvent.change(titleInput(), { target: { value: 'Hello world' } });
    writeArticle('<p>Body copy</p>');

    fireEvent.click(button(/save draft/i));

    await waitFor(() => expect(blogApi.createPost).toHaveBeenCalledTimes(1));
    const input = vi.mocked(blogApi.createPost).mock.calls[0][0];
    expect(input.title).toBe('Hello world');
    // Nobody typed a slug, so the API derives one (and de-duplicates it).
    expect(input.slug).toBeNull();
    expect(input.contentHtml).toBe('<p>Body copy</p>');
    expect(input.content).toMatchObject({ type: 'doc' });
    expect(input.tags).toEqual([]);

    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith({ name: 'blog-editor', postId: 'new-id' }));
    // The address swap must not trip the unsaved-work guard.
    expect(navGuard.check({ name: 'blog' })).toBeNull();
    expect(localStorage.getItem('rown.blog.draft.new')).toBeNull();
  });

  it('refuses to publish an empty article before the API has to', async () => {
    renderEditor(null);
    fireEvent.change(titleInput(), { target: { value: 'No article yet' } });

    fireEvent.click(button(/^publish$/i));

    expect(await findText(/write the article before publishing/i)).toMatch(/write the article/i);
    expect(blogApi.createPost).not.toHaveBeenCalled();
    expect(blogApi.publishPost).not.toHaveBeenCalled();
  });

  it('refuses to publish markup that only looks like content', async () => {
    renderEditor(null);
    fireEvent.change(titleInput(), { target: { value: 'Emptyish' } });
    writeArticle('<p><br></p><p>   </p>');

    fireEvent.click(button(/^publish$/i));

    await findText(/write the article before publishing/i);
    expect(blogApi.publishPost).not.toHaveBeenCalled();
  });

  it('publishes once there is an article', async () => {
    renderEditor(null);
    fireEvent.change(titleInput(), { target: { value: 'Ready to go' } });
    writeArticle('<p>Real content</p>');

    fireEvent.click(button(/^publish$/i));

    await waitFor(() => expect(blogApi.createPost).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(blogApi.publishPost).toHaveBeenCalledWith('new-id', undefined));
    await findText(/post published|post is live|draft created/i);
  });

  it('blocks an invalid slug before saving', async () => {
    renderEditor(null);
    fireEvent.change(titleInput(), { target: { value: 'Bad slug' } });
    fireEvent.change(slugInput(), { target: { value: 'not a valid slug!' } });
    writeArticle('<p>Content</p>');

    fireEvent.click(button(/save draft/i));

    await findText(/letters, numbers and single hyphens/i);
    expect(slugInput().getAttribute('aria-invalid')).toBe('true');
    expect(blogApi.createPost).not.toHaveBeenCalled();
  });
});

describe('BlogEditorPage · an existing post', () => {
  it('loads the stored article into the form', async () => {
    renderEditor(POST_ID);

    await waitFor(() => expect(titleInput().value).toBe('Stored post'));
    expect(slugInput().value).toBe('stored-post');
    expect(article().innerHTML).toBe('<p>Stored body</p>');
    expect(screen.getAllByText('Draft').length).toBeGreaterThan(0);
    expect(vi.mocked(blogApi.getPost)).toHaveBeenCalledWith(POST_ID);
  });

  it('shows a readable screen when the post is gone', async () => {
    vi.mocked(blogApi.getPost).mockRejectedValue(new ApiError('We couldn’t find what you were looking for.', 404));
    renderEditor(POST_ID);

    expect(await screen.findByRole('heading', { name: 'Post not found' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /back to|all posts|posts/i })).toBeTruthy();
  });

  it('saves edits with PATCH and keeps publishing a separate call', async () => {
    renderEditor(POST_ID);
    await waitFor(() => expect(titleInput().value).toBe('Stored post'));

    fireEvent.change(titleInput(), { target: { value: 'Renamed' } });
    fireEvent.click(button(/^save$/i));

    await waitFor(() => expect(blogApi.updatePost).toHaveBeenCalledTimes(1));
    const [id, input] = vi.mocked(blogApi.updatePost).mock.calls[0];
    expect(id).toBe(POST_ID);
    expect(input.title).toBe('Renamed');
    expect(blogApi.publishPost).not.toHaveBeenCalled();
  });

  it('publishes a dirty draft by saving first', async () => {
    renderEditor(POST_ID);
    await waitFor(() => expect(titleInput().value).toBe('Stored post'));

    fireEvent.change(titleInput(), { target: { value: 'Edited then published' } });
    fireEvent.click(button(/^publish$/i));

    await waitFor(() => expect(blogApi.updatePost).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(blogApi.publishPost).toHaveBeenCalledWith(POST_ID, undefined));
  });

  it('moves a published post back to drafts', async () => {
    vi.mocked(blogApi.getPost).mockResolvedValue(
      post({ status: 'PUBLISHED', publishedAt: '2026-10-01T09:00:00.000Z' }),
    );
    renderEditor(POST_ID);

    await waitFor(() => expect(screen.getAllByText('Published').length).toBeGreaterThan(0));
    fireEvent.click(button(/back to draft|unpublish|move to draft/i));

    await waitFor(() => expect(blogApi.unpublishPost).toHaveBeenCalledWith(POST_ID));
  });

  it('points a duplicate slug at the slug field', async () => {
    vi.mocked(blogApi.updatePost).mockRejectedValue(
      new ApiError('A blog post with this slug already exists', 409, ['slug must be unique']),
    );
    renderEditor(POST_ID);
    await waitFor(() => expect(titleInput().value).toBe('Stored post'));

    fireEvent.change(slugInput(), { target: { value: 'taken-slug' } });
    fireEvent.click(button(/^save$/i));

    await waitFor(() => expect(blogApi.updatePost).toHaveBeenCalled());
    await findText(/slug must be unique|already taken/i);
    expect(slugInput().getAttribute('aria-invalid')).toBe('true');
  });

  it('explains an unreachable server without losing the article', async () => {
    vi.mocked(blogApi.updatePost).mockRejectedValue(
      new ApiError('We can’t reach the Rown server right now. Please check your internet connection and try again.', 0),
    );
    renderEditor(POST_ID);
    await waitFor(() => expect(titleInput().value).toBe('Stored post'));

    fireEvent.change(titleInput(), { target: { value: 'Offline edit' } });
    fireEvent.click(button(/^save$/i));

    await findText(/reach the rown server/i);
    expect(titleInput().value).toBe('Offline edit');
  });

  it('maps a server validation failure onto the offending field', async () => {
    vi.mocked(blogApi.updatePost).mockRejectedValue(
      new ApiError('Bad request', 400, ['excerpt must be shorter than or equal to 500 characters']),
    );
    renderEditor(POST_ID);
    await waitFor(() => expect(titleInput().value).toBe('Stored post'));

    fireEvent.change(titleInput(), { target: { value: 'Trigger a save' } });
    fireEvent.click(button(/^save$/i));

    await findText(/excerpt must be shorter/i);
  });

  it('warns before navigating away with unsaved work', async () => {
    renderEditor(POST_ID);
    await waitFor(() => expect(titleInput().value).toBe('Stored post'));
    expect(navGuard.check({ name: 'blog' })).toBeNull();

    fireEvent.change(titleInput(), { target: { value: 'Unsaved' } });

    await waitFor(() => expect(navGuard.check({ name: 'blog' })).toMatch(/unsaved changes/i));
    // Staying on the same post is never blocked.
    expect(navGuard.check({ name: 'blog-editor', postId: POST_ID })).toBeNull();
  });

  it('deletes only after a typed confirmation', async () => {
    const { onNavigate } = renderEditor(POST_ID);
    await waitFor(() => expect(titleInput().value).toBe('Stored post'));

    fireEvent.click(button(/delete this post/i));
    expect(await screen.findByRole('heading', { name: /delete this post/i })).toBeTruthy();

    const confirm = screen.getByRole('button', { name: /delete permanently/i });
    expect(confirm).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByLabelText(/type delete to confirm/i), { target: { value: 'delete' } });
    fireEvent.click(screen.getByRole('button', { name: /delete permanently/i }));

    await waitFor(() => expect(blogApi.deletePost).toHaveBeenCalledWith(POST_ID));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith({ name: 'blog' }));
  });
});

describe('BlogEditorPage · scheduling', () => {
  it('schedules with a future timestamp', async () => {
    renderEditor(POST_ID);
    await waitFor(() => expect(titleInput().value).toBe('Stored post'));

    fireEvent.click(button(/schedule for later/i));
    const when = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    expect(when).toBeTruthy();

    const future = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    fireEvent.change(when, {
      target: { value: `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T${pad(future.getHours())}:${pad(future.getMinutes())}` },
    });
    fireEvent.click(button(/schedule post/i));

    await waitFor(() => expect(blogApi.publishPost).toHaveBeenCalledTimes(1));
    const scheduled = vi.mocked(blogApi.publishPost).mock.calls[0][1];
    expect(scheduled).toBeTruthy();
    expect(new Date(scheduled as string).getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects a time in the past', async () => {
    renderEditor(POST_ID);
    await waitFor(() => expect(titleInput().value).toBe('Stored post'));

    fireEvent.click(button(/schedule for later/i));
    const when = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(when, { target: { value: '2020-01-01T09:00' } });
    fireEvent.click(button(/schedule post|update schedule/i));

    expect(await screen.findByText(/at least a minute from now/i)).toBeTruthy();
    expect(blogApi.publishPost).not.toHaveBeenCalled();
  });
});

describe('BlogEditorPage · the local backup', () => {
  it('offers newer local edits and restores them on request', async () => {
    vi.mocked(blogApi.getPost).mockResolvedValue(post({ updatedAt: '2026-10-01T10:00:00.000Z' }));
    localStorage.setItem(
      `rown.blog.draft.${POST_ID}`,
      JSON.stringify({
        version: 1,
        savedAt: '2026-10-05T10:00:00.000Z',
        form: { ...BLANK_POST_FORM, title: 'Local copy', slug: 'local-copy', slugEdited: true, html: '<p>local body</p>' },
      }),
    );

    renderEditor(POST_ID);

    expect(await screen.findByText(/unsaved edits from/i)).toBeTruthy();
    expect(titleInput().value).toBe('Stored post');

    fireEvent.click(screen.getByRole('button', { name: /restore my edits/i }));

    await waitFor(() => expect(titleInput().value).toBe('Local copy'));
    expect(article().innerHTML).toBe('<p>local body</p>');
    expect(screen.getByText(/local edits restored/i)).toBeTruthy();
  });

  it('can throw the local copy away instead', async () => {
    vi.mocked(blogApi.getPost).mockResolvedValue(post({ updatedAt: '2026-10-01T10:00:00.000Z' }));
    localStorage.setItem(
      `rown.blog.draft.${POST_ID}`,
      JSON.stringify({
        version: 1,
        savedAt: '2026-10-05T10:00:00.000Z',
        form: { ...BLANK_POST_FORM, title: 'Local copy', slugEdited: true },
      }),
    );

    renderEditor(POST_ID);
    fireEvent.click(await screen.findByRole('button', { name: /discard local copy/i }));

    await waitFor(() => expect(localStorage.getItem(`rown.blog.draft.${POST_ID}`)).toBeNull());
    expect(titleInput().value).toBe('Stored post');
  });

  it('ignores a local copy that is older than the server', async () => {
    vi.mocked(blogApi.getPost).mockResolvedValue(post({ updatedAt: '2026-10-09T10:00:00.000Z' }));
    localStorage.setItem(
      `rown.blog.draft.${POST_ID}`,
      JSON.stringify({ version: 1, savedAt: '2026-10-05T10:00:00.000Z', form: { ...BLANK_POST_FORM, title: 'Stale' } }),
    );

    renderEditor(POST_ID);
    await waitFor(() => expect(titleInput().value).toBe('Stored post'));
    expect(screen.queryByText(/unsaved edits from/i)).toBeNull();
  });
});

describe('BlogEditorPage · preview', () => {
  it('previews the article as a reader would see it', async () => {
    vi.mocked(blogApi.getPost).mockResolvedValue(
      post({ title: 'Preview me', contentHtml: '<p>Preview body</p>', category: 'Product updates' }),
    );
    renderEditor(POST_ID);
    await waitFor(() => expect(titleInput().value).toBe('Preview me'));

    fireEvent.click(screen.getByRole('button', { name: /preview as a reader/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Preview me')).toBeTruthy();
    expect(dialog.innerHTML).toContain('Preview body');
  });
});


describe('BlogEditorPage · tutorial content and first use', () => {
  it('never asks for an individual post when opening a brand-new article', () => {
    renderEditor(null);
    expect(blogApi.getPost).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Post not found' })).toBeNull();
  });

  it('saves the latest HTML-source edits without leaving source mode, preserving screenshot order', async () => {
    renderEditor(null);
    fireEvent.change(titleInput(), { target: { value: 'A transfer tutorial' } });
    fireEvent.click(screen.getByRole('button', { name: 'Edit HTML' }));
    const html = '<h2>Step one</h2><p><b>Open the form</b></p><figure><img src="/step-one.png" alt="Form"></figure><p>Enter the recipient</p><figure><img src="/step-two.png" alt="Recipient"><figcaption>Check the address</figcaption></figure><p onclick="bad()">Confirm</p><script>bad()</script>';
    fireEvent.change(screen.getByLabelText('Article HTML'), { target: { value: html } });
    fireEvent.click(button(/save draft/i));
    await waitFor(() => expect(blogApi.createPost).toHaveBeenCalledTimes(1));
    const input = vi.mocked(blogApi.createPost).mock.calls[0][0];
    expect(input.contentHtml).toContain('<strong>Open the form</strong>');
    expect(input.contentHtml).not.toMatch(/onclick|<script/);
    const saved = new DOMParser().parseFromString(input.contentHtml!, 'text/html');
    expect(Array.from(saved.querySelectorAll('img')).map(img => img.getAttribute('src'))).toEqual(['/step-one.png', '/step-two.png']);
    expect(input.content).toMatchObject({ type: 'doc', content: [
      { type: 'heading' },
      { type: 'paragraph' },
      { type: 'image', attrs: { src: '/step-one.png', alt: 'Form' } },
      { type: 'paragraph' },
      { type: 'image', attrs: { src: '/step-two.png', caption: 'Check the address' } },
      { type: 'paragraph' },
    ] });
  });

  it('previews source-mode edits immediately and keeps unsafe HTML out of the preview', async () => {
    renderEditor(null);
    fireEvent.click(screen.getByRole('button', { name: 'Edit HTML' }));
    fireEvent.change(screen.getByLabelText('Article HTML'), { target: { value: '<p onclick="bad()">Latest source text</p><script>bad()</script>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview as a reader' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reader preview' });
    expect(within(dialog).getByText('Latest source text')).toBeTruthy();
    expect(dialog.innerHTML).not.toMatch(/onclick|<script/);
  });

  it('backs up source changes even before they are applied to the visual editor', async () => {
    vi.useFakeTimers();
    renderEditor(null);
    fireEvent.click(screen.getByRole('button', { name: 'Edit HTML' }));
    const raw = '<h2>Unfinished tutorial</h2><p>Continue here';
    fireEvent.change(screen.getByLabelText('Article HTML'), { target: { value: raw } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    const backup = JSON.parse(localStorage.getItem('rown.blog.draft.new')!);
    expect(backup.form.html).toBe(raw);
    expect(navGuard.check({ name: 'blog' })).toMatch(/has not been saved/);
  });

  it('waits for inline uploads before saving, including keyboard shortcuts', async () => {
    let finish!: (asset: Awaited<ReturnType<typeof uploadBlogImage>>) => void;
    vi.mocked(uploadBlogImage).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    renderEditor(null);
    fireEvent.change(titleInput(), { target: { value: 'With a screenshot' } });
    writeArticle('<p>Instruction one</p>');
    const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'step.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Upload inline images'), { target: { files: [file] } });
    await waitFor(() => expect(uploadBlogImage).toHaveBeenCalledWith(file));
    expect(screen.getAllByRole('button', { name: 'Save draft' }).every(node => node.hasAttribute('disabled'))).toBe(true);
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(blogApi.createPost).not.toHaveBeenCalled();
    await act(async () => finish({ id: 'm1', publicUrl: '/uploaded.png', storageKey: 'step.png', contentType: 'image/png', sizeBytes: 8, uploadedByAdminAddress: '0x1', createdAt: new Date().toISOString() }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Save draft' }).every(node => !node.hasAttribute('disabled'))).toBe(true));
    fireEvent.click(button(/save draft/i));
    await waitFor(() => expect(blogApi.createPost).toHaveBeenCalledTimes(1));
    expect(vi.mocked(blogApi.createPost).mock.calls[0][0].contentHtml).toContain('/uploaded.png');
  });

  it('does not call a failed first save a deleted post', async () => {
    vi.mocked(blogApi.createPost).mockRejectedValue(new ApiError('Not found', 404));
    renderEditor(null);
    fireEvent.change(titleInput(), { target: { value: 'My first post' } });
    fireEvent.click(button(/save draft/i));
    await waitFor(() => expect(blogApi.createPost).toHaveBeenCalledTimes(1));
    expect((await screen.findAllByText(/content management API is unavailable/i)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/this post no longer exists/i)).toBeNull();
    expect(titleInput().value).toBe('My first post');
  });

  it('keeps a local backup when the endpoint is missing and can retry once it is available', async () => {
    vi.useFakeTimers();
    const backup = JSON.stringify({ version: 1, savedAt: '2099-01-01T00:00:00.000Z', form: { ...BLANK_POST_FORM, title: 'Local tutorial', html: '<p>Do not lose this</p>' } });
    localStorage.setItem(`rown.blog.draft.${POST_ID}`, backup);
    vi.mocked(blogApi.getPost).mockRejectedValueOnce(new blogApi.BlogEndpointError(`/admin/blog/posts/${POST_ID}`));
    renderEditor(POST_ID);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('heading', { name: 'Could not load this post' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Post not found' })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(localStorage.getItem(`rown.blog.draft.${POST_ID}`)).toBe(backup);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await act(async () => { await Promise.resolve(); });
    expect(blogApi.getPost).toHaveBeenCalledTimes(2);
    expect(titleInput().value).toBe('Stored post');
    expect(screen.getByText(/unsaved edits from/i)).toBeTruthy();
  });
});


describe('BlogEditorPage · mount and empty defaults', () => {
  it('does not count a pre-filled author as content or unsaved work', () => {
    renderEditor(null);
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    expect(article().innerHTML).toBe('<p><br></p>');
    expect(navGuard.check({ name: 'blog' })).toBeNull();
  });

  it('loads an existing article when effects are replayed under StrictMode', async () => {
    render(<StrictMode><ToastProvider><BlogEditorPage postId={POST_ID} adminLabel="Operator" onNavigate={vi.fn()} /></ToastProvider></StrictMode>);
    await waitFor(() => expect(titleInput().value).toBe('Stored post'));
    expect(article().innerHTML).toBe('<p>Stored body</p>');
    expect(screen.queryByRole('heading', { name: 'Loading post…' })).toBeNull();
  });
});
