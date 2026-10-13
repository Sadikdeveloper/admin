import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as blogApi from '../../api/blog';
import type { BlogMediaAsset, Paged } from '../../api/blog';
import { ApiError } from '../../api';
import { ToastProvider } from '../../components/Toast';
import { BlogMediaPage } from '../BlogMediaPage';

/*
 * Only the network calls are faked. `uploadBlogImage` stays real so the
 * browser-side checks (type, size, magic bytes) are exercised too.
 */
vi.mock('../../api/blog', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api/blog')>();
  return { ...actual, listMedia: vi.fn(), uploadMedia: vi.fn() };
});

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);

const asset = (overrides: Partial<BlogMediaAsset> = {}): BlogMediaAsset => ({
  id: 'a1',
  storageKey: 'blog/2026-10/a1.png',
  publicUrl: 'https://cdn.rown.xyz/blog-media/blog/2026-10/a1.png',
  contentType: 'image/png',
  sizeBytes: 2048,
  uploadedByAdminAddress: '0x1',
  createdAt: '2026-10-10T09:00:00.000Z',
  ...overrides,
});

let pool: BlogMediaAsset[] = [];

function stubList(options: { error?: ApiError; pages?: number } = {}) {
  vi.mocked(blogApi.listMedia).mockImplementation(async (params = {}): Promise<Paged<BlogMediaAsset>> => {
    if (options.error) throw options.error;
    const limit = params.limit ?? 24;
    const page = params.page ?? 1;
    const totalPages = options.pages ?? Math.max(1, Math.ceil(pool.length / limit));
    return {
      items: pool.slice((page - 1) * limit, page * limit),
      pagination: { page, limit, total: pool.length, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 },
    };
  });
}

function renderPage() {
  return render(
    <ToastProvider>
      <BlogMediaPage />
    </ToastProvider>,
  );
}

const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;
const queue = () => document.querySelector('ul.upload-queue') as HTMLElement | null;
const queueText = () => queue()?.textContent ?? '';
const cardOf = (name: string) => screen.getByTitle(`Open details for ${name}`).closest('.media-card') as HTMLElement;
const findAll = async (pattern: RegExp) => {
  const matches = await screen.findAllByText(pattern);
  expect(matches.length).toBeGreaterThan(0);
  return matches[0];
};
const pngFile = (name = 'cover.png', bytes = PNG_BYTES, type = 'image/png') => new File([bytes], name, { type });

function chooseFiles(...files: File[]) {
  fireEvent.change(fileInput(), { target: { files } });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.scrollTo = vi.fn();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(() => Promise.resolve(true)) },
  });
  pool = [asset(), asset({ id: 'a2', storageKey: 'blog/2026-10/a2.jpg', publicUrl: 'https://cdn.rown.xyz/a2.jpg', contentType: 'image/jpeg' })];
  stubList();
  vi.mocked(blogApi.uploadMedia).mockImplementation(async (file: File | Blob) =>
    Promise.resolve(
      asset({ id: `new-${pool.length + 1}`, storageKey: `blog/2026-10/new-${pool.length + 1}.png`, sizeBytes: file.size }),
    ),
  );
});

describe('BlogMediaPage · the library', () => {
  it('lists stored images with their size and type', async () => {
    renderPage();

    expect(await screen.findByText('a1.png')).toBeTruthy();
    expect(screen.getByText('a2.jpg')).toBeTruthy();
    expect(cardOf('a1.png').textContent).toMatch(/2 KB · PNG/);
    expect(screen.getByText(/2 images/)).toBeTruthy();
  });

  it('opens the asset detail with everything the API stores', async () => {
    renderPage();
    await screen.findByText('a1.png');

    fireEvent.click(screen.getByTitle('Open details for a1.png'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('https://cdn.rown.xyz/blog-media/blog/2026-10/a1.png');
    expect(dialog.textContent).toContain('blog/2026-10/a1.png');
    expect(dialog.textContent).toMatch(/image\/png/i);
  });

  it('copies a CDN URL to the clipboard', async () => {
    renderPage();
    await screen.findByText('a1.png');

    fireEvent.click(screen.getAllByRole('button', { name: /copy url/i })[0]);

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    expect(vi.mocked(navigator.clipboard.writeText).mock.calls[0][0]).toContain('https://cdn.rown.xyz');
  });

  it('filters the loaded page by name', async () => {
    renderPage();
    await screen.findByText('a1.png');

    fireEvent.change(screen.getByLabelText('Filter images'), { target: { value: 'a2' } });

    await waitFor(() => expect(screen.queryByText('a1.png')).toBeNull());
    expect(screen.getByText('a2.jpg')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filter images'), { target: { value: 'zzz' } });
    expect(await screen.findByText(/no loaded images match that filter/i)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /clear filter/i }).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('Filter images'), { target: { value: '' } });
    expect(await screen.findByText('a1.png')).toBeTruthy();
  });

  it('pages through the library', async () => {
    stubList({ pages: 2 });
    renderPage();
    await screen.findByText('a1.png');

    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => expect(vi.mocked(blogApi.listMedia).mock.calls.some(([params]) => params?.page === 2)).toBe(true));
  });

  it('invites the first upload when the library is empty', async () => {
    pool = [];
    renderPage();

    expect(await screen.findByText(/no images yet\. upload the first one/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /upload an image/i })).toBeTruthy();
    expect(screen.getByText(/images cannot be deleted from the console/i)).toBeTruthy();
  });

  it('shows a banner when the list cannot be loaded', async () => {
    stubList({ error: new ApiError('We can’t reach the Rown server right now.', 0) });
    renderPage();

    expect(await screen.findByText(/reach the rown server/i)).toBeTruthy();
    expect(screen.getByText(/the library could not be loaded/i)).toBeTruthy();
  });
});

describe('BlogMediaPage · uploading', () => {
  it('uploads a valid image and refreshes the library', async () => {
    renderPage();
    await screen.findByText('a1.png');

    chooseFiles(pngFile('hero.png'));

    await waitFor(() => expect(blogApi.uploadMedia).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(queueText()).toMatch(/uploaded/));
    // The new asset is fetched back into the grid rather than invented locally.
    await waitFor(() => expect(blogApi.listMedia).toHaveBeenCalledTimes(2));
  });

  it('rejects a non-image in the browser before any request', async () => {
    renderPage();
    await screen.findByText('a1.png');

    chooseFiles(new File([new TextEncoder().encode('hello')], 'notes.txt', { type: 'text/plain' }));

    await waitFor(() => expect(queueText()).toMatch(/only jpeg, png, gif, and webp/i));
    expect(blogApi.uploadMedia).not.toHaveBeenCalled();
  });

  it('rejects a file that is too large, with the real size in the message', async () => {
    renderPage();
    await screen.findByText('a1.png');

    const huge = new File([new Uint8Array(6 * 1024 * 1024)], 'huge.png', { type: 'image/png' });
    chooseFiles(huge);

    await waitFor(() => expect(queueText()).toMatch(/5 mb or smaller/i));
    expect(blogApi.uploadMedia).not.toHaveBeenCalled();
  });

  it('catches a file whose name lies about its contents', async () => {
    renderPage();
    await screen.findByText('a1.png');

    const gifBytes = new Uint8Array([...Array.from('GIF89a').map(c => c.charCodeAt(0)), 1, 2, 3]);
    chooseFiles(new File([gifBytes], 'pretend.png', { type: 'image/png' }));

    await waitFor(() => expect(queueText()).toMatch(/labelled image\/png/i));
    expect(blogApi.uploadMedia).not.toHaveBeenCalled();
  });

  it('explains an unconfigured media store (503) at the top of the page', async () => {
    vi.mocked(blogApi.uploadMedia).mockRejectedValue(
      new ApiError('Blog image uploads are not configured on the server yet.', 503, [
        'Blog image uploads are not configured. Set the BLOG_MEDIA_* storage settings.',
      ]),
    );
    renderPage();
    await screen.findByText('a1.png');

    chooseFiles(pngFile('hero.png'));

    await waitFor(() => expect(queueText()).toMatch(/storage is not set up/i));
    // The warning also stays at the top of the page, with the settings an engineer must add.
    await findAll(/blog image storage is not set up/i);
    expect(document.body.textContent).toMatch(/BLOG_MEDIA_BUCKET/);
  });

  it('reports a rate limit and lets the operator retry', async () => {
    vi.mocked(blogApi.uploadMedia).mockRejectedValue(new ApiError('Too many uploads. Please wait a minute.', 429));
    renderPage();
    await screen.findByText('a1.png');

    chooseFiles(pngFile('hero.png'));

    await waitFor(() => expect(queueText()).toMatch(/too many uploads/i));
    expect(queueText()).toMatch(/15 uploads per minute/);
    expect(screen.getByRole('button', { name: /dismiss hero\.png/i })).toBeTruthy();
  });

  it('removes a finished item from the queue', async () => {
    renderPage();
    await screen.findByText('a1.png');

    chooseFiles(pngFile('hero.png'));
    await waitFor(() => expect(queueText()).toMatch(/uploaded/));

    fireEvent.click(screen.getByRole('button', { name: /dismiss hero\.png/i }));

    await waitFor(() => expect(queue()).toBeNull());
  });
});
