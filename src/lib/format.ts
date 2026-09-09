import type { Growth, PeriodMetric, Provider, UserGroup, Group } from '../api';

/* ------------------------------------------------------------------ */
/* Periods                                                             */
/* ------------------------------------------------------------------ */

/**
 * The analytics API precomputes every window on each response, so the range
 * tabs select an already-fetched period rather than triggering a refetch.
 * The keys here must match the `period` values the server emits.
 */
export const PERIODS = [
  { key: 'daily', label: 'Today', blurb: 'since midnight' },
  { key: 'weekly', label: 'This week', blurb: 'rolling 7 days' },
  { key: 'monthly', label: 'This month', blurb: 'rolling 30 days' },
  { key: 'allTime', label: 'All time', blurb: 'since launch' },
] as const;

export type PeriodKey = (typeof PERIODS)[number]['key'];

export const DEFAULT_PERIOD: PeriodKey = 'allTime';

export function periodLabel(key: string): string {
  return PERIODS.find(p => p.key === key)?.label ?? key;
}

/** Picks a period from a list, falling back to all-time so a view never blanks out. */
export function pickPeriod<T extends { period: string }>(periods: T[] | undefined, key: string): T | undefined {
  if (!periods?.length) return undefined;
  return periods.find(p => p.period === key) ?? periods.find(p => p.period === 'allTime') ?? periods[0];
}

export function metricFor(group: Group | Provider | undefined, key: string): PeriodMetric | undefined {
  return pickPeriod(group?.periods, key);
}

export function userCount(groups: UserGroup[] | undefined, groupKey: string, period: string): Growth | undefined {
  const group = groups?.find(g => g.key === groupKey);
  return pickPeriod(group?.periods, period)?.count;
}

/* ------------------------------------------------------------------ */
/* Numbers & money                                                     */
/* ------------------------------------------------------------------ */

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export function num(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

export function money(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  // Sub-dollar amounts would otherwise all render as "$0".
  const digits = abs > 0 && abs < 1 ? 2 : 0;
  return `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value)}`;
}

export function naira(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `₦${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)}`;
}

export function compactMoney(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `$${compact.format(value)}`;
}

export function percent(value?: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

/** Growth deltas read better with an explicit sign. */
export function signedPercent(value?: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

/* ------------------------------------------------------------------ */
/* Text & time                                                         */
/* ------------------------------------------------------------------ */

export function humanise(value?: string | null): string {
  if (!value) return '—';
  return value
    // Split camelCase and PascalCase before lowercasing, so API keys like
    // `providerAcceptedAt` read as "Provider accepted at".
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .toLowerCase()
    .trim()
    .replace(/^\w/, c => c.toUpperCase());
}

export function shortAddress(address: string): string {
  if (!address || address.length < 12) return address || '—';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString([], {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

/* ------------------------------------------------------------------ */
/* Date ranges (the API accepts `from` / `to` ISO dates)               */
/* ------------------------------------------------------------------ */

export function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return toISODate(date);
}

export function describeRange(from?: string, to?: string): string {
  if (!from && !to) return 'All available history';
  if (from && to) return `${from} → ${to}`;
  if (from) return `From ${from}`;
  return `Up to ${to}`;
}
