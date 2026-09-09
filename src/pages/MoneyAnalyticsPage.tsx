import type { FormEvent, ReactNode } from 'react';
import { Activity, ArrowUpRight, BarChart3, FileText, PlugZap } from 'lucide-react';
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
  StatRow,
  TimezoneTag,
  coverageNote,
  money,
  ngnLine,
  num,
} from '../components/ui';
import { SearchPanel } from '../components/TransactionMatchCard';

/** Transactions, deposits and top-ups all return the same analytics shape. */
export type MoneyAnalytics = api.TransactionAnalytics | api.DepositAnalytics | api.TopupAnalytics;

export function MoneyAnalyticsPage({
  data,
  loading,
  range,
  setRange,
  onRefresh,
  eyebrow,
  title,
  subtitle,
  valueLabel,
  volumeLabel,
  search,
}: {
  data: MoneyAnalytics | null;
  loading: boolean;
  range: string;
  setRange: (r: string) => void;
  onRefresh: () => void;
  eyebrow: string;
  title: string;
  subtitle: string;
  valueLabel: string;
  volumeLabel: string;
  search?: {
    query: string;
    setQuery: (q: string) => void;
    onSubmit: (e: FormEvent) => void;
    onClear: () => void;
    loading: boolean;
    result: api.SearchResult | null;
  };
}) {
  const metric = metricFor(data?.totals, range);
  const value = metric?.value;

  const categories = (data?.byCategory || []).filter(group => group.key !== 'ALL');
  const providers = data?.byProvider || [];

  const categoryRows = categories.map(group => {
    const period = metricFor(group, range);
    return {
      key: group.key,
      label: group.label,
      value: period?.value?.usd?.current || 0,
      secondary: ngnLine(period?.value),
      change: period?.value?.usd,
    };
  });

  const hasNet = value?.net != null;
  const hasFees = value?.fees != null;

  return (
    <>
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        subtitle={subtitle}
        loading={loading}
        hasData={Boolean(data)}
        onRefresh={onRefresh}
        refreshLabel={`Refresh ${title.toLowerCase()}`}
      />

      <RangeTabs range={range} setRange={setRange} meta={data?.meta} loading={loading} />
      <MetaStrip meta={data?.meta} />

      <KpiGrid loading={loading}>
        <Kpi
          label={valueLabel}
          value={money(value?.usd?.current)}
          secondary={ngnLine(value)}
          change={value?.usd}
          icon={<BarChart3 />}
          hint={coverageNote(value) || undefined}
        />
        <Kpi label={volumeLabel} value={num(metric?.volume?.current)} change={metric?.volume} icon={<Activity />} />
        {hasNet ? (
          <Kpi
            label="Net value (USD)"
            value={money(value?.net?.usd?.current)}
            change={value?.net?.usd}
            icon={<ArrowUpRight />}
            hint="Gross value less fees"
          />
        ) : (
          <Kpi
            label="Active categories"
            value={num(categories.length)}
            icon={<ArrowUpRight />}
            hint="Categories with data in this window"
          />
        )}
        {hasFees ? (
          <Kpi label="Fees collected" value={money(value?.fees?.usd?.current)} change={value?.fees?.usd} icon={<FileText />} />
        ) : (
          <Kpi label="Providers involved" value={num(providers.length)} icon={<PlugZap />} />
        )}
      </KpiGrid>

      <div className="dashboard-grid">
        <Panel
          className="chart-panel"
          eyebrow="CATEGORY BREAKDOWN"
          title="Value by category"
          aside={<TimezoneTag meta={data?.meta} />}
          footer={
            <>
              <span>Value in USD (gross){coverageNote(value) ? ` · ${coverageNote(value)}` : ''}</span>
              <span>
                <i className="legend-dot" />
                Settled only
              </span>
            </>
          }
        >
          {loading || categoryRows.length > 0 ? (
            <BarList loading={loading} rows={categoryRows} formatValue={money} />
          ) : (
            <EmptyState icon={<BarChart3 size={24} />} message="No categories recorded in this window yet." />
          )}
        </Panel>

        <Panel
          className="provider-panel"
          eyebrow="PROVIDERS"
          title="Per-provider value"
          aside={<span className="count">{providers.length} providers</span>}
        >
          {loading ? (
            <ProviderListSkeleton />
          ) : providers.length > 0 ? (
            <div className="provider-list">
              {providers.map(provider => (
                <ProviderRow key={provider.code} provider={provider} range={range} />
              ))}
            </div>
          ) : (
            <EmptyState icon={<PlugZap size={24} />} message="No provider activity in this window yet." />
          )}
        </Panel>
      </div>

      {search && (
        <SearchPanel
          eyebrow="LOOKUP"
          query={search.query}
          setQuery={search.setQuery}
          onSubmit={search.onSubmit}
          onClear={search.onClear}
          loading={search.loading}
          result={search.result}
        />
      )}
    </>
  );
}

export function ProviderRow({ provider, range }: { provider: api.Provider; range: string }) {
  const period = metricFor(provider, range);
  return (
    <div className="provider-row">
      <div className="provider-icon">{(provider.name || '?').slice(0, 1).toUpperCase()}</div>
      <div className="provider-name">
        <strong>{provider.name}</strong>
        <span>
          {(provider.providerKind || 'provider').replaceAll('_', ' ')}
          {provider.categories?.length ? ` · ${provider.categories.length} categories` : ''}
        </span>
      </div>
      <strong className="stat-value">
        {money(period?.value?.usd?.current)}
        <span className="bar-secondary">{num(period?.volume?.current)} txns</span>
      </strong>
    </div>
  );
}

export function StatList({ children }: { children: ReactNode }) {
  return <div className="provider-list">{children}</div>;
}

export { StatRow };
