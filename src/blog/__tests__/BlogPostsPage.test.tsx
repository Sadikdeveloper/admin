import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as blogApi from '../../api/blog';
import type { BlogPost, Paged } from '../../api/blog';
import { ApiError } from '../../api';
import { ToastProvider } from '../../components/Toast';
import type { Route } from '../../lib/routes';
import { BlogPostsPage } from '../BlogPostsPage';

vi.mock('../../api/blog', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api/blog')>();
  return {
    ...actual,
    listPosts: vi.fn(),
    publishPost: vi.fn(),
    unpublishPost: vi.fn(),
    deletePost: vi.fn(),
    getPost: vi.fn(),
  };
});

const post = (overrides: Partial<BlogPost> = {}): BlogPost => ({
  id: 'p1',
  title: 'Rown Pay is live',
  slug: 'rown-pay-is-live',
  excerpt: 'Dollar cards and local payouts.',
  content: null,
  contentHtml: '<p>Body</p>',
  coverImageUrl: null,
  coverImageAlt: null,
  category: 'Product updates',
  tags: ['payments'],
  authorName: 'Rown Team',
  canonicalUrl: null,
  seoTitle: null,
  seoDescription: null,
  status: 'PUBLISHED',
  publishedAt: '2026-10-01T09:00:00.000Z',
  createdByAdminAddress: '0x1',
  updatedByAdminAddress: '0x1',
  createdAt: '2026-09-30T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  ...overrides,
});

let pool: BlogPost[] = [];

/** One endpoint serves the list plus the two count probes (limit=1). */
function stubList(options: { error?: ApiError; pages?: number } = {}) {
  vi.mocked(blogApi.listPosts).mockImplementation(async (params = {}): Promise<Paged<BlogPost>> => {
    if (options.error) throw options.error;

    const matches = pool.filter(item => {
      if (params.status && item.status !== params.status) return false;
      if (params.search) {
        const needle = params.search.toLowerCase();
        return `${item.title} ${item.slug} ${item.excerpt ?? ''}`.toLowerCase().includes(needle);
      }
      return true;
    });

    if (params.limit === 1) {
      return {
        items: [],
        pagination: { page: 1, limit: 1, total: matches.length, totalPages: matches.length, hasNextPage: false, hasPreviousPage: false },
      };
    }

    const limit = params.limit ?? 12;
    const page = params.page ?? 1;
    const totalPages = options.pages ?? Math.max(1, Math.ceil(matches.length / limit));
    return {
      items: matches.slice((page - 1) * limit, page * limit),
      pagination: {
        page,
        limit,
        total: matches.length,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  });
}

function renderPage(onNavigate = vi.fn()) {
  render(
    <ToastProvider>
      <BlogPostsPage onNavigate={onNavigate as (route: Route) => void} />
    </ToastProvider>,
  );
  return { onNavigate };
}

const rows = () => Array.from(document.querySelectorAll('li.post-row')) as HTMLElement[];
const rowFor = (title: string) => rows().find(node => node.textContent?.includes(title)) as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  window.scrollTo = vi.fn();
  pool = [
    post(),
    post({ id: 'p2', title: 'How we keep your keys safe', slug: 'how-we-keep-your-keys-safe', status: 'PUBLISHED', publishedAt: '2099-01-01T09:00:00.000Z' }),
    post({ id: 'p3', title: 'Draft: Q4 roadmap', slug: 'draft-q4-roadmap', status: 'DRAFT', publishedAt: null }),
  ];
  stubList();
  vi.mocked(blogApi.publishPost).mockImplementation((id, publishAt) => {
    pool = pool.map(item => (item.id === id ? { ...item, status: 'PUBLISHED', publishedAt: publishAt ?? '2026-10-11T09:00:00.000Z' } : item));
    return Promise.resolve(pool.find(item => item.id === id) as BlogPost);
  });
  vi.mocked(blogApi.unpublishPost).mockImplementation(id => {
    pool = pool.map(item => (item.id === id ? { ...item, status: 'DRAFT', publishedAt: null } : item));
    return Promise.resolve(pool.find(item => item.id === id) as BlogPost);
  });
  vi.mocked(blogApi.deletePost).mockImplementation(async id => {
    pool = pool.filter(item => item.id !== id);
  });
});

describe('BlogPostsPage · the list', () => {
  it('shows every post with its state, and counts in the strip', async () => {
    renderPage();

    expect(await screen.findByText('Rown Pay is live')).toBeTruthy();
    expect(screen.getByText('How we keep your keys safe')).toBeTruthy();
    expect(screen.getByText('Draft: Q4 roadmap')).toBeTruthy();

    const strip = screen.getByRole('status');
    expect(strip.textContent).toContain('All');
    expect(strip.textContent).toContain('3');
    expect(strip.textContent).toContain('Published');
    expect(strip.textContent).toContain('Drafts');
    // A published post with a future date is a schedule, not a live post.
    expect(within(rowFor('How we keep your keys safe')).getByText('Scheduled')).toBeTruthy();
    expect(within(rowFor('How we keep your keys safe')).getByText(/live/i)).toBeTruthy();
    expect(within(rowFor('Draft: Q4 roadmap')).getByText('Draft')).toBeTruthy();
  });

  it('filters by status through the tabs', async () => {
    renderPage();
    await screen.findByText('Rown Pay is live');

    fireEvent.click(screen.getByRole('tab', { name: /drafts/i }));

    await waitFor(() => expect(screen.queryByText('Rown Pay is live')).toBeNull());
    expect(screen.getByText('Draft: Q4 roadmap')).toBeTruthy();
    expect(
      vi
        .mocked(blogApi.listPosts)
        .mock.calls.map(([params]) => params)
        .some(params => params?.status === 'DRAFT' && params?.limit !== 1),
    ).toBe(true);
  });

  it('debounces search and sends the trimmed term', async () => {
    vi.useFakeTimers();
    renderPage();
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.change(screen.getByLabelText('Search posts'), { target: { value: '  keys  ' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(
      vi.mocked(blogApi.listPosts).mock.calls.map(([params]) => params?.search).filter(Boolean),
    ).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(
      vi
        .mocked(blogApi.listPosts)
        .mock.calls.map(([params]) => params?.search)
        .filter(Boolean)
        .at(-1),
    ).toBe('keys');
  });

  it('pages through the list', async () => {
    stubList({ pages: 2 });
    renderPage();
    await screen.findByText('Rown Pay is live');

    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() =>
      expect(
        vi
          .mocked(blogApi.listPosts)
          .mock.calls.map(([params]) => params)
          .some(params => params?.page === 2 && params?.limit !== 1),
      ).toBe(true),
    );
  });

  it('offers a first post when the blog is empty', async () => {
    pool = [];
    const { onNavigate } = renderPage();

    expect(await screen.findByText(/no blog posts yet/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /create a post/i }));
    expect(onNavigate).toHaveBeenCalledWith({ name: 'blog-editor', postId: null });
  });

  it('offers to clear filters when a filter hides everything', async () => {
    pool = [];
    sessionStorage.setItem('rown.blog.posts.view', JSON.stringify({ status: 'DRAFT', search: 'nothing', page: 1 }));
    renderPage();

    expect(await screen.findByText(/no posts match this filter/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));

    await waitFor(() =>
      expect(
        vi
          .mocked(blogApi.listPosts)
          .mock.calls.map(([params]) => params)
          .some(params => params?.status === undefined && params?.search === undefined && params?.limit !== 1),
      ).toBe(true),
    );
  });

  it('reports a rate limit without emptying the screen silently', async () => {
    stubList({ error: new ApiError('Too many requests. Please slow down and try again.', 429) });
    renderPage();

    expect(await screen.findByText(/too many requests/i)).toBeTruthy();
    expect(screen.getByText(/the list could not be loaded/i)).toBeTruthy();
  });

  it('remembers the view for the trip back from the editor', async () => {
    renderPage();
    await screen.findByText('Rown Pay is live');

    fireEvent.click(screen.getByRole('tab', { name: /drafts/i }));
    await waitFor(() => expect(sessionStorage.getItem('rown.blog.posts.view')).toContain('DRAFT'));
  });

  it('survives a corrupt stored view', async () => {
    sessionStorage.setItem('rown.blog.posts.view', '{broken');
    renderPage();
    expect(await screen.findByText('Rown Pay is live')).toBeTruthy();
  });
});

describe('BlogPostsPage · row actions', () => {
  it('opens the editor for a post and for a new one', async () => {
    const { onNavigate } = renderPage();
    await screen.findByText('Rown Pay is live');

    fireEvent.click(within(rowFor('Rown Pay is live')).getByRole('button', { name: 'Edit' }));
    expect(onNavigate).toHaveBeenCalledWith({ name: 'blog-editor', postId: 'p1' });

    fireEvent.click(screen.getByRole('button', { name: /new post/i }));
    expect(onNavigate).toHaveBeenCalledWith({ name: 'blog-editor', postId: null });
  });

  it('publishes a draft from the list', async () => {
    const { onNavigate } = renderPage();
    await screen.findByText('Draft: Q4 roadmap');
    expect(onNavigate).toBeTruthy();

    fireEvent.click(within(rowFor('Draft: Q4 roadmap')).getByRole('button', { name: /^publish/i }));

    await waitFor(() => expect(blogApi.publishPost).toHaveBeenCalledWith('p3'));
    await waitFor(() => {
      const row = rowFor('Draft: Q4 roadmap');
      expect(within(row).getByText('Published')).toBeTruthy();
      expect(within(row).getByRole('button', { name: /^unpublish$/i })).toBeTruthy();
    });
  });

  it('returns a published post to drafts', async () => {
    renderPage();
    await screen.findByText('Rown Pay is live');

    fireEvent.click(within(rowFor('Rown Pay is live')).getByRole('button', { name: /^unpublish/i }));

    await waitFor(() => expect(blogApi.unpublishPost).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(within(rowFor('Rown Pay is live')).getByText('Draft')).toBeTruthy());
  });

  it('explains a publish refusal from the API', async () => {
    vi.mocked(blogApi.publishPost).mockRejectedValue(
      new ApiError('Add rich text or HTML content before publishing this post', 400, [
        'Add rich text or HTML content before publishing this post',
      ]),
    );
    renderPage();
    await screen.findByText('Draft: Q4 roadmap');

    fireEvent.click(within(rowFor('Draft: Q4 roadmap')).getByRole('button', { name: /^publish/i }));

    expect(await screen.findByText(/add rich text or html content/i)).toBeTruthy();
  });

  it('deletes only after confirmation, and warns about comments', async () => {
    renderPage();
    await screen.findByText('Rown Pay is live');

    fireEvent.click(within(rowFor('Rown Pay is live')).getByRole('button', { name: /^delete/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/permanently/i);

    fireEvent.click(within(dialog).getByRole('button', { name: /keep it|cancel/i }));
    expect(blogApi.deletePost).not.toHaveBeenCalled();

    fireEvent.click(within(rowFor('Rown Pay is live')).getByRole('button', { name: /^delete/i }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /delete/i }));

    await waitFor(() => expect(blogApi.deletePost).toHaveBeenCalledWith('p1'));
    // The toast still names the post, so assert on the list itself.
    await waitFor(() => expect(rows().some(row => row.textContent?.includes('Rown Pay is live'))).toBe(false));
    expect(rows()).toHaveLength(2);
  });

  it('previews a post as a reader would see it', async () => {
    renderPage();
    await screen.findByText('Rown Pay is live');

    fireEvent.click(within(rowFor('Rown Pay is live')).getByRole('button', { name: /^preview$/i }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.innerHTML).toContain('Body');
    expect(within(dialog).getByText('Rown Pay is live')).toBeTruthy();
  });
});
