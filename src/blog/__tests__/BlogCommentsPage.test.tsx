import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as blogApi from '../../api/blog';
import type { BlogComment, Paged } from '../../api/blog';
import { ApiError } from '../../api';
import { ToastProvider } from '../../components/Toast';
import type { Route } from '../../lib/routes';
import { BlogCommentsPage } from '../BlogCommentsPage';

vi.mock('../../api/blog', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api/blog')>();
  return { ...actual, listComments: vi.fn(), moderateComment: vi.fn(), deleteComment: vi.fn() };
});

const comment = (overrides: Partial<BlogComment> = {}): BlogComment => ({
  id: 'c1',
  postId: 'p1',
  displayName: 'Adaeze',
  body: 'Does this work in Ghana from day one?',
  status: 'PENDING',
  moderatedAt: null,
  moderatedByAdminAddress: null,
  createdAt: '2026-10-10T09:00:00.000Z',
  updatedAt: '2026-10-10T09:00:00.000Z',
  post: { id: 'p1', title: 'Rown Pay is live', slug: 'rown-pay-is-live' },
  ...overrides,
});

const PENDING = [comment(), comment({ id: 'c2', displayName: 'Tunde', body: 'Great news' })];
const APPROVED = [comment({ id: 'c3', displayName: 'Musa', body: 'Approved one', status: 'APPROVED' })];

/**
 * A stateful fake of the moderation endpoints: the tab counts are refetched
 * after every action, so they have to reflect what the actions did.
 */
let pool: BlogComment[] = [];

function stubList(options: { error?: ApiError } = {}) {
  const pageOf = (items: BlogComment[], params: { page?: number; limit?: number }): Paged<BlogComment> => ({
    items,
    pagination: {
      page: params.page ?? 1,
      limit: params.limit ?? 20,
      total: items.length,
      totalPages: Math.max(1, Math.ceil(items.length / (params.limit ?? 20))),
      hasNextPage: false,
      hasPreviousPage: false,
    },
  });

  vi.mocked(blogApi.listComments).mockImplementation(async (params = {}) => {
    if (options.error) throw options.error;
    // limit=1 is how the tabs ask for a count without pulling the rows.
    const matches = params.status ? pool.filter(item => item.status === params.status) : [...pool];
    if (params.limit === 1) {
      return { items: [], pagination: { ...pageOf(matches, params).pagination, limit: 1 } };
    }
    return pageOf(matches, params);
  });

  vi.mocked(blogApi.moderateComment).mockImplementation(async (id, status) => {
    const found = pool.find(item => item.id === id);
    if (!found) throw new ApiError('We couldn’t find what you were looking for.', 404);
    const updated = { ...found, status, moderatedAt: '2026-10-11T09:00:00.000Z' };
    pool = pool.map(item => (item.id === id ? updated : item));
    return updated;
  });

  vi.mocked(blogApi.deleteComment).mockImplementation(async id => {
    pool = pool.filter(item => item.id !== id);
  });
}

function renderPage(onNavigate = vi.fn()) {
  render(
    <ToastProvider>
      <BlogCommentsPage onNavigate={onNavigate as (route: Route) => void} />
    </ToastProvider>,
  );
  return { onNavigate };
}

const rowFor = (name: string) => screen.getAllByRole('listitem').find(node => node.textContent?.includes(name)) as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.scrollTo = vi.fn();
  pool = [...PENDING, ...APPROVED];
  stubList();
});

describe('BlogCommentsPage · the queue', () => {
  it('opens on pending comments with a count on every tab', async () => {
    renderPage();

    expect(await screen.findByText(/does this work in ghana/i)).toBeTruthy();
    expect(screen.getByText('Tunde')).toBeTruthy();

    const tabs = screen.getByRole('tablist', { name: 'Comment status' });
    expect(within(tabs).getByRole('tab', { name: /pending/i }).textContent).toContain('2');
    expect(within(tabs).getByRole('tab', { name: /approved/i }).textContent).toContain('1');
    expect(within(tabs).getByRole('tab', { name: /rejected/i }).textContent).toContain('0');
    expect(within(tabs).getByRole('tab', { name: /all/i }).textContent).toContain('3');
    expect(within(tabs).getByRole('tab', { name: /pending/i }).getAttribute('aria-selected')).toBe('true');
  });

  it('shows the post a comment belongs to and links to its editor', async () => {
    const { onNavigate } = renderPage();
    await screen.findByText(/does this work in ghana/i);

    fireEvent.click(screen.getAllByRole('button', { name: /rown pay is live/i })[0]);
    expect(onNavigate).toHaveBeenCalledWith({ name: 'blog-editor', postId: 'p1' });
  });

  it('renders comment bodies as text, never as HTML', async () => {
    stubList();
    vi.mocked(blogApi.listComments).mockImplementation(async (params = {}) => {
      if (params.limit === 1) {
        return { items: [], pagination: { page: 1, limit: 1, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false } };
      }
      return {
        items: [comment({ id: 'xss', body: '<img src=x onerror="alert(1)"> nice post' })],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
      };
    });

    renderPage();
    const row = await screen.findByText(/nice post/i);
    expect(row.querySelector('img')).toBeNull();
    expect(row.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it('switching tab refetches and resets to the first page', async () => {
    renderPage();
    await screen.findByText(/does this work in ghana/i);

    fireEvent.click(screen.getByRole('tab', { name: /approved/i }));

    await waitFor(() => expect(screen.getByText('Approved one')).toBeTruthy());
    const listCall = vi
      .mocked(blogApi.listComments)
      .mock.calls.map(([params]) => params)
      .filter(params => params?.limit !== 1)
      .at(-1);
    expect(listCall).toMatchObject({ status: 'APPROVED', page: 1 });
  });

  it('changing the page size refetches', async () => {
    renderPage();
    await screen.findByText(/does this work in ghana/i);

    fireEvent.change(screen.getByLabelText('Comments per page'), { target: { value: '50' } });

    await waitFor(() =>
      expect(
        vi
          .mocked(blogApi.listComments)
          .mock.calls.map(([params]) => params)
          .some(params => params?.limit === 50),
      ).toBe(true),
    );
  });

  it('says so when the queue is empty', async () => {
    vi.mocked(blogApi.listComments).mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
    });
    renderPage();

    expect(await screen.findByText(/nothing waiting for moderation/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /show all comments/i })).toBeTruthy();
  });

  it('surfaces a rate limit in a banner and keeps the console usable', async () => {
    stubList({ error: new ApiError('Too many requests. Please slow down and try again.', 429) });
    renderPage();

    expect(await screen.findByText(/too many requests/i)).toBeTruthy();
    expect(screen.getByText(/the queue could not be loaded/i)).toBeTruthy();
  });
});

describe('BlogCommentsPage · moderation', () => {
  it('approves a comment and moves the counts', async () => {
    renderPage();
    await screen.findByText(/does this work in ghana/i);

    fireEvent.click(within(rowFor('Adaeze')).getByRole('button', { name: /^approve$/i }));

    await waitFor(() => expect(blogApi.moderateComment).toHaveBeenCalledWith('c1', 'APPROVED'));
    await waitFor(() => expect(within(rowFor('Adaeze')).getByText('Approved')).toBeTruthy());

    const tabs = screen.getByRole('tablist', { name: 'Comment status' });
    expect(within(tabs).getByRole('tab', { name: /pending/i }).textContent).toContain('1');
    expect(within(tabs).getByRole('tab', { name: /approved/i }).textContent).toContain('2');
  });

  it('rejects and re-queues', async () => {
    renderPage();
    await screen.findByText(/does this work in ghana/i);

    fireEvent.click(within(rowFor('Tunde')).getByRole('button', { name: /^reject$/i }));
    await waitFor(() => expect(blogApi.moderateComment).toHaveBeenCalledWith('c2', 'REJECTED'));
    await waitFor(() => expect(within(rowFor('Tunde')).getByText('Rejected')).toBeTruthy());

    fireEvent.click(within(rowFor('Tunde')).getByRole('button', { name: /re-queue/i }));
    await waitFor(() => expect(blogApi.moderateComment).toHaveBeenCalledWith('c2', 'PENDING'));
  });

  it('puts a comment back when moderation fails', async () => {
    vi.mocked(blogApi.moderateComment).mockRejectedValue(
      new ApiError('We can’t reach the Rown server right now. Please check your internet connection and try again.', 0),
    );
    renderPage();
    await screen.findByText(/does this work in ghana/i);

    fireEvent.click(within(rowFor('Adaeze')).getByRole('button', { name: /^approve$/i }));

    expect(await screen.findByText(/reach the rown server/i)).toBeTruthy();
    await waitFor(() => expect(within(rowFor('Adaeze')).getByText('Pending')).toBeTruthy());
  });

  it('deletes a single comment after confirmation', async () => {
    renderPage();
    await screen.findByText(/does this work in ghana/i);

    fireEvent.click(within(rowFor('Adaeze')).getByRole('button', { name: /^delete$/i }));
    expect(await screen.findByRole('heading', { name: /delete this comment/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /keep it/i }));
    expect(blogApi.deleteComment).not.toHaveBeenCalled();

    fireEvent.click(within(rowFor('Adaeze')).getByRole('button', { name: /^delete$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /delete permanently/i }));

    await waitFor(() => expect(blogApi.deleteComment).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(screen.queryByText(/does this work in ghana/i)).toBeNull());
  });
});

describe('BlogCommentsPage · bulk actions', () => {
  it('selects, approves in bulk and reports progress', async () => {
    renderPage();
    await screen.findByText(/does this work in ghana/i);

    fireEvent.click(screen.getByLabelText('Select comment by Adaeze'));
    fireEvent.click(screen.getByLabelText('Select comment by Tunde'));

    const bulkBar = screen.getByRole('region', { name: 'Bulk actions' });
    expect(within(bulkBar).getByText(/2 selected/)).toBeTruthy();

    fireEvent.click(within(bulkBar).getByRole('button', { name: /^approve$/i }));

    await waitFor(() => expect(blogApi.moderateComment).toHaveBeenCalledTimes(2));
    expect(blogApi.moderateComment).toHaveBeenCalledWith('c1', 'APPROVED');
    expect(blogApi.moderateComment).toHaveBeenCalledWith('c2', 'APPROVED');
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull());
  });

  it('selects the whole page and clears the selection', async () => {
    renderPage();
    await screen.findByText(/does this work in ghana/i);

    fireEvent.click(screen.getByLabelText('Select every comment on this page'));
    expect(screen.getByRole('region', { name: 'Bulk actions' }).textContent).toContain('2 selected');

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull();
  });

  it('deletes everything selected after one confirmation', async () => {
    renderPage();
    await screen.findByText(/does this work in ghana/i);

    fireEvent.click(screen.getByLabelText('Select every comment on this page'));
    fireEvent.click(within(screen.getByRole('region', { name: 'Bulk actions' })).getByRole('button', { name: /^delete$/i }));

    expect(await screen.findByRole('heading', { name: /delete 2 comments/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /delete permanently/i }));

    await waitFor(() => expect(blogApi.deleteComment).toHaveBeenCalledTimes(2));
  });

  it('keeps going when one comment in a bulk run fails', async () => {
    vi.mocked(blogApi.moderateComment)
      .mockRejectedValueOnce(new ApiError('We couldn’t find what you were looking for.', 404))
      .mockImplementation((id, status) => Promise.resolve(comment({ id, status })));

    renderPage();
    await screen.findByText(/does this work in ghana/i);

    fireEvent.click(screen.getByLabelText('Select every comment on this page'));
    fireEvent.click(within(screen.getByRole('region', { name: 'Bulk actions' })).getByRole('button', { name: /^reject$/i }));

    await waitFor(() => expect(blogApi.moderateComment).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/finished with 1 problem/i)).toBeTruthy();
  });
});
