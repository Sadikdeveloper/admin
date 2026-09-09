import { Activity, ShieldCheck, Users, Wallet } from 'lucide-react';
import type * as api from '../api';
import { PERIODS, pickPeriod, userCount } from '../lib/format';
import {
  BarList,
  ChangePill,
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
  num,
  percent,
} from '../components/ui';

export function UsersPage({
  data,
  loading,
  range,
  setRange,
  onRefresh,
}: {
  data: api.UserAnalytics | null;
  loading: boolean;
  range: string;
  setRange: (r: string) => void;
  onRefresh: () => void;
}) {
  const groups = data?.groups || [];
  const stock = data?.stock;

  const rows = groups.map(group => {
    const period = pickPeriod(group.periods, range);
    return {
      key: group.key,
      label: group.label,
      value: period?.count?.current || 0,
      change: period?.count,
    };
  });

  const kycRate =
    stock && stock.totalUsers > 0 ? (stock.kycVerifiedNow / stock.totalUsers) * 100 : null;
  const walletRate =
    stock && stock.totalUsers > 0 ? (stock.walletUsers / stock.totalUsers) * 100 : null;

  return (
    <>
      <PageHeader
        eyebrow="OPERATIONS / USERS"
        title="User analytics"
        subtitle="Signups, onboarding, KYC and active user metrics."
        loading={loading}
        hasData={Boolean(data)}
        onRefresh={onRefresh}
        refreshLabel="Refresh user analytics"
      />

      <RangeTabs range={range} setRange={setRange} meta={data?.meta} loading={loading} />
      <MetaStrip meta={data?.meta} />

      <KpiGrid loading={loading}>
        <Kpi
          label="Signups"
          value={num(userCount(groups, 'signups', range)?.current)}
          change={userCount(groups, 'signups', range)}
          icon={<Users />}
        />
        <Kpi
          label="Wallets created"
          value={num(userCount(groups, 'walletsCreated', range)?.current)}
          change={userCount(groups, 'walletsCreated', range)}
          icon={<Wallet />}
        />
        <Kpi
          label="KYC verified"
          value={num(userCount(groups, 'kycVerified', range)?.current)}
          change={userCount(groups, 'kycVerified', range)}
          icon={<ShieldCheck />}
        />
        <Kpi
          label="Transacting users"
          value={num(userCount(groups, 'activeUsers', range)?.current)}
          change={userCount(groups, 'activeUsers', range)}
          icon={<Activity />}
        />
      </KpiGrid>

      <div className="dashboard-grid">
        <Panel
          className="chart-panel"
          eyebrow="USER FLOWS"
          title="Growth by period"
          aside={<TimezoneTag meta={data?.meta} />}
          footer={<span>Period flows — events that occurred inside the selected window</span>}
        >
          {loading || rows.length > 0 ? (
            <BarList loading={loading} rows={rows} formatValue={num} />
          ) : (
            <EmptyState icon={<Users size={24} />} message="No user activity in this window yet." />
          )}
        </Panel>

        <Panel
          className="provider-panel"
          eyebrow="CUMULATIVE STOCK"
          title="Total headcounts"
          aside={stock?.asOf ? <span className="count">as of {new Date(stock.asOf).toLocaleDateString()}</span> : undefined}
        >
          {loading ? (
            <ProviderListSkeleton rows={5} />
          ) : stock ? (
            <div className="provider-list">
              <StatRow label="Total users" value={num(stock.totalUsers)} />
              <StatRow
                label="Wallet users"
                hint={walletRate != null ? `${percent(walletRate, 0)} of all users` : undefined}
                value={num(stock.walletUsers)}
              />
              <StatRow
                label="KYC verified (current)"
                hint={kycRate != null ? `${percent(kycRate, 0)} of all users` : undefined}
                value={num(stock.kycVerifiedNow)}
              />
              <StatRow label="KYC verified (ever)" value={num(stock.kycEverVerified)} />
              <StatRow label="With active guardian" value={num(stock.usersWithActiveGuardian)} />
              <StatRow label="Without active guardian" value={num(stock.usersWithoutActiveGuardian)} />
              <StatRow label="Active guardian records" value={num(stock.activeGuardianRecords)} />
              <StatRow
                label="Guardian coverage"
                hint="Share of wallet users with a guardian"
                value={stock.walletUsersWithGuardianShare != null ? percent(stock.walletUsersWithGuardianShare, 1) : '—'}
              />
            </div>
          ) : (
            <EmptyState icon={<Users size={24} />} message="No stock data available yet." />
          )}
        </Panel>
      </div>

      {groups.length > 0 && (
        <Panel className="search-panel" eyebrow="DETAILS" title="All user metrics">
          <div className="user-metrics-table">
            <div className="metrics-table-head">
              <span className="metric-col-label">Metric</span>
              {PERIODS.map(p => (
                <span key={p.key} className="metric-col-value">
                  {p.label}
                </span>
              ))}
            </div>
            {groups.map(group => (
              <div className="metrics-table-row" key={group.key}>
                <span className="metric-col-label">
                  <strong>{group.label}</strong>
                  {group.definition && <span className="metric-def">{group.definition}</span>}
                </span>
                {PERIODS.map(p => {
                  const count = group.periods?.find(x => x.period === p.key)?.count;
                  return (
                    <span key={p.key} className="metric-col-value" data-label={p.label}>
                      <strong>{count ? num(count.current) : '—'}</strong>
                      <ChangePill change={count} compact />
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}
