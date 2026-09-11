import type { ReactNode } from 'react';
import { ChevronDown, CircleAlert, Info, RefreshCw, TriangleAlert, X } from 'lucide-react';
import type * as api from '../api';
import { PERIODS, formatTime, money, naira, num, percent, signedPercent } from '../lib/format';

/* ------------------------------------------------------------------ */
/* Page furniture                                                      */
/* ------------------------------------------------------------------ */

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  loading,
  hasData,
  onRefresh,
  refreshLabel,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  loading: boolean;
  hasData: boolean;
  onRefresh: () => void;
  refreshLabel: string;
}) {
  return (
    <header className="content-head">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="subtle">{subtitle}</p>
      </div>
      <div className="header-actions">
        <button className="icon-button" title={refreshLabel} aria-label={refreshLabel} onClick={onRefresh} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
        </button>
        <span className={`status ${!hasData && !loading ? 'status-stale' : ''}`}>
          <i />
          {loading ? 'Refreshing…' : hasData ? 'Live data' : 'No data'}
        </span>
      </div>
    </header>
  );
}

export function RangeTabs({
  range,
  setRange,
  meta,
  loading,
}: {
  range: string;
  setRange: (r: string) => void;
  meta?: api.AnalyticsMeta | null;
  loading: boolean;
}) {
  return (
    <section className="toolbar">
      <div className="range-tabs" role="tablist" aria-label="Time range">
        {PERIODS.map(({ key, label, blurb }) => (
          <button
            key={key}
            role="tab"
            type="button"
            title={blurb}
            aria-selected={range === key}
            className={range === key ? 'selected' : ''}
            onClick={() => setRange(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <span className="updated">
        {meta?.generatedAt ? `Updated ${formatTime(meta.generatedAt)}` : loading ? 'Loading…' : '—'}
      </span>
    </section>
  );
}

/** Surfaces the FX rate and any degradation the API reports, instead of hiding it. */
export function MetaStrip({ meta }: { meta?: api.AnalyticsMeta | null }) {
  if (!meta) return null;
  const { fx, timezone } = meta;
  return (
    <section className="meta-strip">
      <span className="meta-chip">
        <b>Timezone</b>
        {timezone || '—'}
      </span>
      <span className="meta-chip">
        <b>USD / NGN</b>
        {fx?.usdToNgn ? naira(fx.usdToNgn) : 'unavailable'}
      </span>
      {fx?.asOf && (
        <span className="meta-chip">
          <b>Rate as of</b>
          {formatTime(fx.asOf)}
        </span>
      )}
      {fx?.source && (
        <span className="meta-chip">
          <b>Source</b>
          {fx.source}
        </span>
      )}
      {fx?.degraded && (
        <span className="meta-chip meta-chip-warn">
          <TriangleAlert size={13} />
          NGN figures use a stale rate
        </span>
      )}
    </section>
  );
}

export function Banner({
  tone,
  message,
  onDismiss,
}: {
  tone: 'error' | 'info';
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className={`banner banner-${tone} page-banner`} role={tone === 'error' ? 'alert' : 'status'}>
      {tone === 'error' ? <CircleAlert size={16} className="banner-ico" /> : <Info size={16} className="banner-ico" />}
      <span>{message}</span>
      <button className="banner-close" onClick={onDismiss} aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  );
}

export function Panel({
  eyebrow,
  title,
  aside,
  children,
  footer,
  className = '',
}: {
  eyebrow: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        {aside}
      </div>
      {children}
      {footer && <div className="chart-foot">{footer}</div>}
    </section>
  );
}

export function EmptyState({ icon, message }: { icon: ReactNode; message: string }) {
  return (
    <div className="panel-empty">
      {icon}
      <p>{message}</p>
    </div>
  );
}

export function TimezoneTag({ meta }: { meta?: api.AnalyticsMeta | null }) {
  return (
    <span className="select-label">
      {meta?.timezone || '—'}
      <ChevronDown size={14} />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* KPIs                                                                */
/* ------------------------------------------------------------------ */

export function KpiGrid({ loading, children, count = 4 }: { loading: boolean; children: ReactNode; count?: number }) {
  return (
    <section className="kpi-grid">
      {loading
        ? Array.from({ length: count }, (_, i) => (
            <div className="kpi skeleton" key={i}>
              <div className="skel-line skel-sm" />
              <div className="skel-line skel-lg" />
              <div className="skel-line skel-xs" />
            </div>
          ))
        : children}
    </section>
  );
}

export function Kpi({
  label,
  value,
  secondary,
  change,
  icon,
  hint,
}: {
  label: string;
  value: string;
  secondary?: string | null;
  change?: api.Growth | null;
  icon: ReactNode;
  hint?: string;
}) {
  return (
    <div className="kpi" title={hint}>
      <div className="kpi-top">
        <span>{label}</span>
        <div className="kpi-icon">{icon}</div>
      </div>
      <strong>{value}</strong>
      {secondary && <span className="kpi-secondary">{secondary}</span>}
      {/* Metrics with no growth concept at all (e.g. the FX rate) omit the pill. */}
      {change !== undefined && <ChangePill change={change} />}
    </div>
  );
}

export function ChangePill({ change, compact = false }: { change?: api.Growth | null; compact?: boolean }) {
  if (!change) return <div className="change flat change-void">—</div>;
  const { percentageChange, direction, isNew, comparable } = change;

  let text: string;
  if (percentageChange != null) text = signedPercent(percentageChange);
  else if (isNew) text = 'New';
  else if (!comparable) text = 'No baseline';
  else text = 'No change';

  return (
    <div className={`change ${direction || 'flat'}`}>
      {text}
      {!compact && percentageChange != null && <span> vs previous</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bar list                                                            */
/* ------------------------------------------------------------------ */

export type BarDatum = { key: string; label: string; value: number; secondary?: string | null; change?: api.Growth | null };

export function BarList({ loading, rows, formatValue }: { loading: boolean; rows: BarDatum[]; formatValue: (v: number) => string }) {
  if (loading) {
    return (
      <div className="bars">
        {[1, 2, 3, 4].map(i => (
          <div className="bar-row skeleton" key={i}>
            <span className="skel-line" style={{ width: '60%' }} />
            <div className="bar-track">
              <i style={{ width: `${20 + i * 15}%` }} className="skel-bar" />
            </div>
            <strong className="skel-line" style={{ width: '50%' }} />
          </div>
        ))}
      </div>
    );
  }

  const max = Math.max(1, ...rows.map(r => Math.abs(r.value)));

  return (
    <div className="bars">
      {rows.map(row => (
        <div className="bar-row" key={row.key}>
          <span title={row.label}>{row.label}</span>
          <div className="bar-track">
            <i style={{ width: `${Math.min(100, (Math.abs(row.value) / max) * 100)}%` }} />
          </div>
          <strong>
            {formatValue(row.value)}
            {row.secondary && <span className="bar-secondary">{row.secondary}</span>}
          </strong>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Provider list                                                       */
/* ------------------------------------------------------------------ */

export function ProviderListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="provider-list">
      {Array.from({ length: rows }, (_, i) => (
        <div className="provider-row skeleton" key={i}>
          <div className="provider-icon skel-circle" />
          <div className="provider-name">
            <div className="skel-line" style={{ width: '70%' }} />
            <div className="skel-line skel-xs" style={{ width: '40%', marginTop: 4 }} />
          </div>
          <strong className="skel-line" style={{ width: '50px' }} />
        </div>
      ))}
    </div>
  );
}

export function StatRow({
  label,
  hint,
  value,
  secondary,
}: {
  label: string;
  hint?: string;
  value: string;
  secondary?: string | null;
}) {
  return (
    <div className="provider-row">
      <div className="provider-name">
        <strong>{label}</strong>
        {hint && <span>{hint}</span>}
      </div>
      <strong className="stat-value">
        {value}
        {secondary && <span className="bar-secondary">{secondary}</span>}
      </strong>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Money helpers shared by the analytics pages                         */
/* ------------------------------------------------------------------ */

/** USD is primary; NGN rides underneath as a secondary line when available. */
export function ngnLine(value: api.MoneyValue | undefined, current = true): string | null {
  const growth = value?.ngn;
  if (!growth) return null;
  const amount = current ? growth.current : growth.previous;
  if (amount == null || !Number.isFinite(amount)) return null;
  return naira(amount);
}

export function coverageNote(value: api.MoneyValue | undefined): string | null {
  const coverage = value?.ngnSnapshotCoverage;
  if (coverage == null || coverage >= 1) return null;
  return `NGN coverage ${percent(coverage * 100, 0)}`;
}

export { money, num, naira, percent };
