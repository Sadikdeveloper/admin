export const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
const accessKey = 'rown.admin.access';
const refreshKey = 'rown.admin.refresh';

export type Admin = { address: string; label: string | null; role: string };
export type Growth = { current: number; previous: number; absoluteChange: number; percentageChange: number | null; direction: 'up' | 'down' | 'flat'; isNew: boolean; isEmpty: boolean; comparable: boolean };
export type PeriodMetric = { period: string; label: string; value: { usd: Growth; ngn: Growth | null; ngnSnapshotCoverage: number }; volume: Growth };
export type Group = { key: string; label: string; periods: PeriodMetric[]; definition?: string };
export type UserGroup = { key: string; label: string; definition?: string; periods: { period: string; label: string; count: Growth }[] };
export type Provider = { name: string; code: string; providerKind: string; categories: string[]; periods: PeriodMetric[] };
export type UserStock = { asOf: string; totalUsers: number; walletUsers: number; kycEverVerified: number; kycVerifiedNow: number; usersWithActiveGuardian: number; usersWithoutActiveGuardian: number; activeGuardianRecords: number; walletUsersWithGuardianShare: number | null };
export type AnalyticsMeta = { generatedAt: string; timezone: string; fx: { usdToNgn: number | null; degraded: boolean; asOf: string | null; source: string | null }; notes?: string[] };
export type Overview = { meta: AnalyticsMeta; transactions: { totals: Group; byCategory: Group[] }; deposits: { totals: Group; byCategory: Group[] }; topups: { totals: Group; byCategory: Group[] }; providers: Provider[]; users: { groups: UserGroup[]; stock: UserStock } };
export type TransactionAnalytics = { meta: AnalyticsMeta; totals: Group; byCategory: Group[]; byProvider: Provider[] };
export type DepositAnalytics = { meta: AnalyticsMeta; totals: Group; byCategory: Group[]; byProvider: Provider[] };
export type TopupAnalytics = { meta: AnalyticsMeta; totals: Group; byCategory: Group[]; byProvider: Provider[] };
export type ProviderAnalytics = { meta: AnalyticsMeta; providers: Provider[] };
export type UserAnalytics = { meta: AnalyticsMeta; groups: UserGroup[]; stock: UserStock };
export type TransactionMatch = { source: string; matchedOn: string; reference: string; category: string; status: string; statusScope: string; createdAt: string | null; updatedAt: string | null; settledAt: string | null; customer: { id: string; phone: string; fullName: string | null; email: string | null; country: string | null; localCurrency: string; kycCompleted: boolean; hasCreatedWallet: boolean; createdAt: string | null } | null; amounts: Record<string, unknown>; provider: Record<string, unknown>; onchain: Record<string, unknown>; counterparty: Record<string, unknown> | null; lifecycle: Record<string, unknown>; related: Array<{ source: string; reference: string; id: string }>; providerPayload?: Record<string, unknown> | null };
export type SearchResult = { query: string; isRownReference: boolean; matches: TransactionMatch[] };

export const session = {
  get access() { return localStorage.getItem(accessKey); },
  get refresh() { return localStorage.getItem(refreshKey); },
  set(data: { accessToken?: string; refreshToken?: string }) {
    if (!data?.accessToken || !data?.refreshToken) return;
    localStorage.setItem(accessKey, data.accessToken);
    localStorage.setItem(refreshKey, data.refreshToken);
  },
  clear() {
    localStorage.removeItem(accessKey);
    localStorage.removeItem(refreshKey);
  },
};

/**
 * Converts technical error messages from the server into
 * plain, friendly text the operator can act on.
 */
function friendlyApiError(status: number, serverMessage: string | undefined): string {
  const msg = (serverMessage || '').toLowerCase();

  switch (status) {
    case 400:
      if (/nonce|challenge|signature|sign/i.test(msg))
        return 'Something went wrong verifying your wallet. Please try connecting again.';
      return 'We couldn\'t process your request. Please check what you entered and try again.';

    case 401:
      if (/expired|token|session/i.test(msg))
        return 'Your session has expired. Please sign in again to continue.';
      if (/allowlist|not authorized|not allowed|forbidden/i.test(msg))
        return 'This wallet isn\'t on the approved admin list yet. Please contact your team lead to get access.';
      return 'We couldn\'t verify your identity. Please sign in again.';

    case 403:
      return 'You don\'t have permission to do that. If you think this is a mistake, please contact your team lead.';

    case 404:
      return 'We couldn\'t find what you were looking for. It may have been removed or the address may be incorrect.';

    case 408:
      return 'The request took too long to complete. Please check your internet connection and try again.';

    case 409:
      return 'There\'s a conflict with the current data. Please refresh the page and try again.';

    case 422:
      return 'The information provided isn\'t quite right. Please double-check and try again.';

    case 429:
      return 'You\'re making requests a bit too quickly. Please wait a moment and try again.';

    case 500:
    case 502:
    case 503:
    case 504:
      return 'Our servers are having trouble right now. Please wait a minute and try again. If the problem persists, let the team know.';

    default:
      if (serverMessage && serverMessage.length < 120 && !/\{|\[|stack|trace/i.test(serverMessage)) {
        return serverMessage;
      }
      return `Something went wrong (error ${status}). Please try again in a moment.`;
  }
}

function unwrap<T>(body: { data?: T } | T | null | undefined): T {
  if (body && typeof body === 'object' && 'data' in body && (body as { data?: T }).data !== undefined) {
    return (body as { data: T }).data;
  }
  return body as T;
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (session.access) headers.set('Authorization', `Bearer ${session.access}`);

  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, { ...init, headers });
  } catch {
    throw new Error("We can't reach the Rown server right now. Please check your internet connection and try again.");
  }

  if (response.status === 401 && retry && session.refresh) {
    try {
      const refreshed = await request<{ data: { accessToken: string; refreshToken: string } } | { accessToken: string; refreshToken: string }>('/admin/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: session.refresh }) }, false);
      session.set(unwrap(refreshed));
      return request<T>(path, init, false);
    } catch {
      session.clear();
      throw new Error('Your session has expired. Please sign in again to continue.');
    }
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(friendlyApiError(response.status, body?.message));
  }
  return body as T;
}

export async function getNonce(address: string) {
  const result = await request<{ data: { message: string } } | { message: string }>('/admin/auth/nonce', { method: 'POST', body: JSON.stringify({ address }) });
  return { data: unwrap<{ message: string }>(result) };
}

export async function verify(message: string, signature: string) {
  const result = await request<{ data: { accessToken: string; refreshToken: string; admin: Admin } } | { accessToken: string; refreshToken: string; admin: Admin }>('/admin/auth/verify', { method: 'POST', body: JSON.stringify({ message, signature }) });
  const payload = unwrap<{ accessToken: string; refreshToken: string; admin: Admin }>(result);
  if (!payload?.accessToken || !payload?.admin) {
    throw new Error('Sign-in could not be completed. Please try connecting again.');
  }
  session.set(payload);
  return payload;
}

export async function getMe() {
  const result = await request<{ data: Admin } | Admin>('/admin/auth/me');
  return { data: unwrap<Admin>(result) };
}

export async function logout() {
  try { await request('/admin/auth/logout', { method: 'POST' }); } finally { session.clear(); }
}

export async function getOverview(params: AnalyticsParams = {}) {
  const query = buildAnalyticsQuery(params);
  return unwrap<Overview>(await request<{ data: Overview } | Overview>(`/admin/analytics/overview?${query}`));
}

export async function searchTransactions(query: string) {
  return unwrap<SearchResult>(await request<{ data: SearchResult } | SearchResult>(`/admin/transactions/search?q=${encodeURIComponent(query)}`));
}

export async function getTransactionByReference(reference: string) {
  return unwrap<SearchResult>(await request<{ data: SearchResult } | SearchResult>(`/admin/transactions/${encodeURIComponent(reference)}`));
}

export async function getTransactions(params: AnalyticsParams = {}) {
  const query = buildAnalyticsQuery(params);
  return unwrap<TransactionAnalytics>(await request<{ data: TransactionAnalytics } | TransactionAnalytics>(`/admin/analytics/transactions?${query}`));
}

export async function getDeposits(params: AnalyticsParams = {}) {
  const query = buildAnalyticsQuery(params);
  return unwrap<DepositAnalytics>(await request<{ data: DepositAnalytics } | DepositAnalytics>(`/admin/analytics/deposits?${query}`));
}

export async function getTopups(params: AnalyticsParams = {}) {
  const query = buildAnalyticsQuery(params);
  return unwrap<TopupAnalytics>(await request<{ data: TopupAnalytics } | TopupAnalytics>(`/admin/analytics/topups?${query}`));
}

export async function getProviders(params: AnalyticsParams = {}) {
  const query = buildAnalyticsQuery(params);
  return unwrap<ProviderAnalytics>(await request<{ data: ProviderAnalytics } | ProviderAnalytics>(`/admin/analytics/providers?${query}`));
}

export async function getUsers(params: AnalyticsParams = {}) {
  const query = buildAnalyticsQuery(params);
  return unwrap<UserAnalytics>(await request<{ data: UserAnalytics } | UserAnalytics>(`/admin/analytics/users?${query}`));
}

type AnalyticsParams = { from?: string; to?: string };

function buildAnalyticsQuery(params: AnalyticsParams): string {
  return new URLSearchParams({ timezone: 'Africa/Lagos', ...params }).toString();
}
