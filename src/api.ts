const BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
const accessKey = 'rown.admin.access';
const refreshKey = 'rown.admin.refresh';

export type Admin = { address: string; label: string | null; role: string };
export type Growth = { current: number; previous: number; absoluteChange: number; percentageChange: number | null; direction: 'up' | 'down' | 'flat'; isNew: boolean; isEmpty: boolean; comparable: boolean };
export type PeriodMetric = { period: string; label: string; value: { usd: Growth; ngn: Growth | null; ngnSnapshotCoverage: number }; volume: Growth };
export type Group = { key: string; label: string; periods: PeriodMetric[]; definition?: string };
export type UserGroup = { key: string; label: string; periods: { period: string; count: Growth }[]; definition?: string };
export type Overview = { meta: { generatedAt: string; timezone: string; fx: { usdToNgn: number | null; degraded: boolean; asOf: string | null; source: string | null }; notes?: string[] }; transactions: { totals: Group; byCategory: Group[] }; deposits: { totals: Group; byCategory: Group[] }; topups: { totals: Group; byCategory: Group[] }; providers: { name: string; code: string; providerKind: string; categories: string[]; periods: PeriodMetric[] }[]; users: UserGroup[] };
export type SearchResult = { query: string; matches: Array<Record<string, unknown>> };

export const session = { get access() { return localStorage.getItem(accessKey); }, get refresh() { return localStorage.getItem(refreshKey); }, set(data: { accessToken: string; refreshToken: string }) { localStorage.setItem(accessKey, data.accessToken); localStorage.setItem(refreshKey, data.refreshToken); }, clear() { localStorage.removeItem(accessKey); localStorage.removeItem(refreshKey); } };

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (session.access) headers.set('Authorization', `Bearer ${session.access}`);
  const response = await fetch(`${BASE}${path}`, { ...init, headers });
  if (response.status === 401 && retry && session.refresh) {
    try { const refreshed = await request<{ data: { accessToken: string; refreshToken: string } }>('/admin/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: session.refresh }) }, false); session.set(refreshed.data); return request<T>(path, init, false); } catch { session.clear(); }
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message || `Request failed (${response.status})`);
  return body as T;
}

export async function getNonce(address: string) { return request<{ data: { message: string } }>('/admin/auth/nonce', { method: 'POST', body: JSON.stringify({ address }) }); }
export async function verify(message: string, signature: string) { const result = await request<{ data: { accessToken: string; refreshToken: string; admin: Admin } }>('/admin/auth/verify', { method: 'POST', body: JSON.stringify({ message, signature }) }); session.set(result.data); return result.data; }
export async function getMe() { return request<{ data: Admin }>('/admin/auth/me'); }
export async function logout() { try { await request('/admin/auth/logout', { method: 'POST' }); } finally { session.clear(); } }
export async function getOverview(params: { from?: string; to?: string } = {}) { const query = new URLSearchParams({ timezone: 'Africa/Lagos', ...params }).toString(); return (await request<{ data: Overview }>(`/admin/analytics/overview?${query}`)).data; }
export async function searchTransactions(query: string) { return (await request<{ data: SearchResult }>(`/admin/transactions/search?q=${encodeURIComponent(query)}`)).data; }
