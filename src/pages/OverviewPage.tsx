import type { FormEvent } from 'react';
import { Activity, ArrowDownLeft, ArrowUpRight, BarChart3, PlugZap, Users, Wallet } from 'lucide-react';
import type * as api from '../api';
import { greeting, metricFor, userCount } from '../lib/format';
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
  naira,
  ngnLine,
  num,
  percent,
} from '../components/ui';
import { SearchPanel } from '../components/TransactionMatchCard';
import { ProviderRow } from './MoneyAnalyticsPage';

export function OverviewPage({
  overview,
  loading,
  range,
  setRange,
  onRefresh,
  onNavigate,
  search,
}: {
  overview: api.Overview | null;
  loading: boolean;
  range: string;
  setRange: (r: string) => void;
  onRefresh: () => void;
  onNavigate: (page: 'transactions' | 'users' | 'providers' | 'deposits' | 'topups') => void;
  search: {
    query: string;
    setQuery: (q: string) => void;
    onSubmit: (e: FormEvent) => void;
    onClear: () => void;
    loading: boolean;
    result: api.SearchResult | null;
  };
}) {
  const txMetric = metricFor(overview?.transactions?.totals, range);
  const depositMetric = metricFor(overview?.deposits?.totals, range);
  const topupMetric = metricFor(overview?.topups?.totals, range);

  const categories = (overview?.transactions?.byCategory || []).filter(g => g.key !== 'ALL');
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

  const providers = overview?.providers || [];
  const stock = overview?.users?.stock;
  const groups = overview?.users?.groups;
  const fx = overview?.meta?.fx;

  return (
    <>
      <PageHeader
        eyebrow="OPERATIONS / OVERVIEW"
        title={`${greeting()}, operator.`}
        subtitle="Settlement intelligence for the Rown network."
        loading={loading}
        hasData={Boolean(overview)}
        onRefresh={onRefresh}
        refreshLabel="Refresh analytics"
      />

      <RangeTabs range={range} setRange={setRange} meta={overview?.meta} loading={loading} />
      <MetaStrip meta={overview?.meta} />

      <KpiGrid loading={loading}>
        <Kpi
          label="Transaction value"
          value={money(txMetric?.value?.usd?.current)}
          secondary={ngnLine(txMetric?.value)}
          change={txMetric?.value?.usd}
          icon={<BarChart3 />}
          hint={coverageNote(txMetric?.value) || undefined}
        />
        <Kpi
          label="Transaction volume"
          value={num(txMetric?.volume?.current)}
          change={txMetric?.volume}
          icon={<Activity />}
        />
        <Kpi
          label="Active users"
          value={num(userCount(groups, 'activeUsers', range)?.current)}
          change={userCount(groups, 'activeUsers', range)}
          icon={<Users />}
        />
        <Kpi
          label="USD / NGN rate"
          value={fx?.usdToNgn ? naira(fx.usdToNgn) : '—'}
          secondary={fx?.degraded ? 'Stale rate in use' : fx?.source ? `via ${fx.source}` : null}
          icon={<ArrowUpRight />}
        />
      </KpiGrid>

      {/* Money-in summary drawn from the deposits and top-ups endpoints. */}
      <section className="summary-grid">
        <SummaryTile
          icon={<ArrowDownLeft size={16} />}
          label="Deposits"
          value={money(depositMetric?.value?.usd?.current)}
          secondary={ngnLine(depositMetric?.value)}
          volume={num(depositMetric?.volume?.current)}
          onClick={() => onNavigate('deposits')}
          loading={loading}
        />
        <SummaryTile
          icon={<Wallet size={16} />}
          label="Top-ups"
          value={money(topupMetric?.value?.usd?.current)}
          secondary={ngnLine(topupMetric?.value)}
          volume={num(topupMetric?.volume?.current)}
          onClick={() => onNavigate('topups')}
          loading={loading}
        />
        <SummaryTile
          icon={<PlugZap size={16} />}
          label="Providers"
          value={num(providers.length)}
          secondary="connected"
          volume={`${num(
            providers.reduce((sum, p) => sum + (metricFor(p, range)?.volume?.current || 0), 0),
          )} txns`}
          onClick={() => onNavigate('providers')}
          loading={loading}
        />
        <SummaryTile
          icon={<Users size={16} />}
          label="Total users"
          value={num(stock?.totalUsers)}
          secondary={
            stock && stock.totalUsers > 0
              ? `${percent((stock.walletUsers / stock.totalUsers) * 100, 0)} with wallets`
              : null
          }
          volume={`${num(stock?.kycVerifiedNow)} KYC`}
          onClick={() => onNavigate('users')}
          loading={loading}
        />
      </section>

      <div className="dashboard-grid">
        <Panel
          className="chart-panel"
          eyebrow="MONEY MOVEMENT"
          title="Transactions by category"
          aside={<TimezoneTag meta={overview?.meta} />}
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
          {loading || categoryRows.length > 0 ? (
            <BarList loading={loading} rows={categoryRows} formatValue={money} />
          ) : (
            <EmptyState icon={<BarChart3 size={24} />} message="No transaction categories to display yet." />
          )}
        </Panel>

        <Panel
          className="provider-panel"
          eyebrow="NETWORK HEALTH"
          title="Provider activity"
          aside={<span className="count">{providers.length} providers</span>}
        >
          {loading ? (
            <ProviderListSkeleton />
          ) : providers.length > 0 ? (
            <>
              <div className="provider-list">
                {providers.slice(0, 5).map(provider => (
                  <ProviderRow key={provider.code} provider={provider} range={range} />
                ))}
              </div>
              {providers.length > 5 && (
                <button type="button" className="panel-link" onClick={() => onNavigate('providers')}>
                  View all {providers.length} providers
                  <ArrowUpRight size={13} />
                </button>
              )}
            </>
          ) : (
            <EmptyState icon={<PlugZap size={24} />} message="No provider data available yet." />
          )}
        </Panel>
      </div>

      {stock && (
        <Panel className="provider-panel" eyebrow="USER BASE" title="Onboarding snapshot">
          <div className="provider-list stock-columns">
            <StatRow label="Total users" value={num(stock.totalUsers)} />
            <StatRow label="Wallet users" value={num(stock.walletUsers)} />
            <StatRow label="KYC verified" value={num(stock.kycVerifiedNow)} />
            <StatRow
              label="Guardian coverage"
              value={stock.walletUsersWithGuardianShare != null ? percent(stock.walletUsersWithGuardianShare, 1) : '—'}
            />
          </div>
        </Panel>
      )}

      <SearchPanel
        eyebrow="SUPPORT TOOL"
        query={search.query}
        setQuery={search.setQuery}
        onSubmit={search.onSubmit}
        onClear={search.onClear}
        loading={search.loading}
        result={search.result}
      />
    </>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  secondary,
  volume,
  onClick,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  secondary?: string | null;
  volume: string;
  onClick: () => void;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="summary-tile skeleton">
        <div className="skel-line skel-sm" />
        <div className="skel-line skel-lg" />
      </div>
    );
  }
  return (
    <button type="button" className="summary-tile" onClick={onClick}>
      <span className="summary-label">
        {icon}
        {label}
      </span>
      <strong>{value}</strong>
      <span className="summary-foot">
        {secondary && <span>{secondary}</span>}
        <span className="summary-volume">{volume}</span>
      </span>
      <ArrowUpRight size={14} className="summary-arrow" />
    </button>
  );
}
