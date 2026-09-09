import { Activity, BarChart3, Layers, PlugZap } from 'lucide-react';
import type * as api from '../api';
import { metricFor } from '../lib/format';
import {
  BarList,
  EmptyState,
  Kpi,
  KpiGrid,
  MetaStrip,
  PageHeader,
  Panel,
  ProviderListSkeleton,
  RangeTabs,
  TimezoneTag,
  money,
  ngnLine,
  num,
} from '../components/ui';

export function ProvidersPage({
  data,
  loading,
  range,
  setRange,
  onRefresh,
}: {
  data: api.ProviderAnalytics | null;
  loading: boolean;
  range: string;
  setRange: (r: string) => void;
  onRefresh: () => void;
}) {
  const providers = data?.providers || [];

  const rows = providers
    .map(provider => {
      const period = metricFor(provider, range);
      return {
        key: provider.code,
        label: provider.name,
        value: period?.value?.usd?.current || 0,
        secondary: ngnLine(period?.value),
        change: period?.value?.usd,
        volume: period?.volume?.current || 0,
        kind: provider.providerKind,
        categories: provider.categories || [],
      };
    })
    .sort((a, b) => b.value - a.value);

  const totalValue = rows.reduce((sum, row) => sum + row.value, 0);
  const totalVolume = rows.reduce((sum, row) => sum + row.volume, 0);
  const kinds = new Set(rows.map(r => r.kind).filter(Boolean));
  const leader = rows[0];

  return (
    <>
      <PageHeader
        eyebrow="OPERATIONS / PROVIDERS"
        title="Provider performance"
        subtitle="Settlement value and volume routed through each connected provider."
        loading={loading}
        hasData={Boolean(data)}
        onRefresh={onRefresh}
        refreshLabel="Refresh provider analytics"
      />

      <RangeTabs range={range} setRange={setRange} meta={data?.meta} loading={loading} />
      <MetaStrip meta={data?.meta} />

      <KpiGrid loading={loading}>
        <Kpi label="Routed value" value={money(totalValue)} icon={<BarChart3 />} hint="Sum across all providers" />
        <Kpi label="Routed volume" value={num(totalVolume)} icon={<Activity />} />
        <Kpi label="Active providers" value={num(rows.length)} icon={<PlugZap />} />
        <Kpi
          label="Top provider"
          value={leader?.label || '—'}
          secondary={leader ? money(leader.value) : null}
          icon={<Layers />}
          hint={`${kinds.size} provider kinds connected`}
        />
      </KpiGrid>

      <div className="dashboard-grid">
        <Panel
          className="chart-panel"
          eyebrow="ROUTING SHARE"
          title="Value by provider"
          aside={<TimezoneTag meta={data?.meta} />}
          footer={
            <>
              <span>Value in USD</span>
              <span>
                <i className="legend-dot" />
                Settled only
              </span>
            </>
          }
        >
          {loading || rows.length > 0 ? (
            <BarList loading={loading} rows={rows} formatValue={money} />
          ) : (
            <EmptyState icon={<BarChart3 size={24} />} message="No provider volume in this window yet." />
          )}
        </Panel>

        <Panel
          className="provider-panel"
          eyebrow="COVERAGE"
          title="Provider directory"
          aside={<span className="count">{rows.length} total</span>}
        >
          {loading ? (
            <ProviderListSkeleton rows={5} />
          ) : rows.length > 0 ? (
            <div className="provider-list">
              {rows.map(row => (
                <div className="provider-row" key={row.key}>
                  <div className="provider-icon">{(row.label || '?').slice(0, 1).toUpperCase()}</div>
                  <div className="provider-name">
                    <strong>{row.label}</strong>
                    <span>
                      {(row.kind || 'provider').replaceAll('_', ' ')}
                      {row.categories.length ? ` · ${row.categories.join(', ')}` : ''}
                    </span>
                  </div>
                  <strong className="stat-value">
                    {money(row.value)}
                    <span className="bar-secondary">{num(row.volume)} txns</span>
                  </strong>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={<PlugZap size={24} />} message="No providers connected yet." />
          )}
        </Panel>
      </div>

      {rows.length > 0 && (
        <Panel className="search-panel" eyebrow="DETAILS" title="Provider matrix">
          <div className="user-metrics-table provider-matrix">
            <div className="metrics-table-head">
              <span className="metric-col-label">Provider</span>
              <span className="metric-col-value">Value (USD)</span>
              <span className="metric-col-value">Volume</span>
              <span className="metric-col-value">Share</span>
            </div>
            {rows.map(row => (
              <div className="metrics-table-row" key={row.key}>
                <span className="metric-col-label">
                  <strong>{row.label}</strong>
                  <span className="metric-def">{(row.kind || 'provider').replaceAll('_', ' ')}</span>
                </span>
                <span className="metric-col-value">
                  <strong>{money(row.value)}</strong>
                  {row.secondary && <span className="metric-def">{row.secondary}</span>}
                </span>
                <span className="metric-col-value">
                  <strong>{num(row.volume)}</strong>
                </span>
                <span className="metric-col-value">
                  <strong>{totalValue > 0 ? `${((row.value / totalValue) * 100).toFixed(1)}%` : '—'}</strong>
                </span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}
