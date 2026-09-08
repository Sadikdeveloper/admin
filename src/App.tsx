import { useEffect, useState, useCallback } from 'react';
import { Activity, ArrowUpRight, BarChart3, ChevronDown, CircleAlert, LogOut, RefreshCw, Search, ShieldCheck, Wallet, Users } from 'lucide-react';
import * as api from './api';

interface BrowserWallet {
  id: string;
  name: string;
  icon?: string;
  provider: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
}

function toHex(str: string): string {
  return '0x' + Array.from(new TextEncoder().encode(str)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function App() {
  const [admin, setAdmin] = useState<api.Admin | null>(null);
  const [overview, setOverview] = useState<api.Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [range, setRange] = useState('all');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<api.SearchResult | null>(null);
  const [wallets, setWallets] = useState<BrowserWallet[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<BrowserWallet | null>(null);

  const addWallet = useCallback((wallet: BrowserWallet) => {
    setWallets(current => {
      if (current.some(w => w.id === wallet.id)) return current;
      return [...current, wallet];
    });
  }, []);

  useEffect(() => {
    const handleAnnounce = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail?.provider || !detail.info?.uuid) return;
      addWallet({
        id: detail.info.uuid,
        name: detail.info.name,
        icon: detail.info.icon,
        provider: detail.provider,
      });
    };

    window.addEventListener('eip6963:announceProvider', handleAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    const fallbackTimer = window.setTimeout(() => {
      const ethereum = (window as any).ethereum;
      if (ethereum) {
        if (Array.isArray(ethereum.providers) && ethereum.providers.length > 0) {
          ethereum.providers.forEach((provider: any, index: number) => {
            addWallet({
              id: `injected-${index}`,
              name: provider.isMetaMask ? 'MetaMask' : `Browser wallet ${index + 1}`,
              provider,
            });
          });
        } else {
          addWallet({
            id: 'injected',
            name: ethereum.isMetaMask ? 'MetaMask' : 'Browser wallet',
            provider: ethereum,
          });
        }
      }
    }, 200);

    return () => {
      window.removeEventListener('eip6963:announceProvider', handleAnnounce);
      window.clearTimeout(fallbackTimer);
    };
  }, [addWallet]);

  useEffect(() => { if (api.session.access) api.getMe().then((r) => { setAdmin(r.data); loadOverview(); }).catch(() => api.session.clear()); }, []);

  async function loadOverview() {
    setLoading(true); setError('');
    try { setOverview(await api.getOverview()); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load analytics'); } finally { setLoading(false); }
  }

  async function connectWithWallet(wallet: BrowserWallet) {
    setError('');
    setLoading(true);
    setSelectedWallet(wallet);
    try {
      console.log('[admin] Requesting accounts from', wallet.name);
      const accounts = (await wallet.provider.request({ method: 'eth_requestAccounts' })) as string[];
      console.log('[admin] Accounts:', accounts);
      if (!accounts?.length) { setError('No accounts found. Unlock your wallet and select an account.'); setLoading(false); return; }

      const address = accounts[0];
      console.log('[admin] Fetching nonce for', address);
      const challenge = await api.getNonce(address);
      console.log('[admin] Signing challenge with personal_sign...');
      const signature = (await wallet.provider.request({ method: 'personal_sign', params: [toHex(challenge.data.message), address] })) as string;
      console.log('[admin] Signature obtained, calling verify...');
      try {
        const identity = await api.verify(challenge.data.message, signature);
        console.log('[admin] Signed in!', identity);
        setAdmin(identity.admin);
        await loadOverview();
      } catch (verifyErr) {
        const msg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
        if (msg.includes('401') || msg.includes('Could not verify')) {
          setError(`Wallet ${address.slice(0, 6)}…${address.slice(-4)} is not on the admin allowlist. Run "yarn seed:admin" from the backend directory.`);
        } else {
          setError(msg || 'Verification failed');
        }
      }
    } catch (e) {
      console.error('[admin] Connect failed:', e);
      const msg = e instanceof Error ? e.message : String(e);
      if ((e as any)?.code === 4001 || msg.includes('rejected') || msg.includes('user rejected')) {
        setError('Connection was rejected. Please approve the wallet prompt.');
      } else {
        setError(msg || 'Wallet sign-in failed');
      }
    } finally { setLoading(false); }
  }

  async function doSearch(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setLoading(true); setError('');
    try { setResult(await api.searchTransactions(query.trim())); } catch (e) { setError(e instanceof Error ? e.message : 'Transaction not found'); setResult(null); } finally { setLoading(false); }
  }

  if (!admin) {
    return (
      <main className="login-shell">
        <div className="login-panel">
          <div className="brand-mark">R</div>
          <p className="eyebrow">OPERATIONS / PRIVATE ACCESS</p>
          <h1>Rown admin console</h1>
          <p className="login-copy">A focused view of settlement activity, user growth, and transaction trails.</p>
          <div className="security-note"><ShieldCheck size={19} /><span>Wallet signature authentication. No gas, no transaction.</span></div>

          {wallets.length === 0 && !loading && (
            <div className="no-wallet">
              <CircleAlert size={18} />
              <p>No wallet detected. Install MetaMask or another EOA wallet extension.</p>
            </div>
          )}

          {wallets.map(wallet => (
            <button
              key={wallet.id}
              className="primary-button wallet-btn"
              onClick={() => connectWithWallet(wallet)}
              disabled={loading}
            >
              {loading && selectedWallet?.id === wallet.id
                ? <><RefreshCw className="spin" size={18} />Connecting...</>
                : <><Wallet size={18} />Connect {wallet.name}</>
              }
            </button>
          ))}

          {error && <p className="error"><CircleAlert size={16} />{error}</p>}
          <p className="login-foot">EOA wallets only · Approved operators only</p>
        </div>
      </main>
    );
  }

  const metric = overview?.transactions.totals.periods.find((p) => p.period === range) || overview?.transactions.totals.periods.find((p) => p.period === 'allTime');
  return (
    <div className="app-shell">
      <aside>
        <div className="side-brand"><div className="brand-mark small">R</div><div><strong>rown</strong><span>ADMIN CONSOLE</span></div></div>
        <nav><a className="active"><BarChart3 size={17} />Overview</a><a><Activity size={17} />Transactions</a><a><Users size={17} />Users</a></nav>
        <div className="side-bottom">
          <div className="operator"><div className="avatar">{admin.address.slice(2, 4).toUpperCase()}</div><div><strong>{admin.label || 'Administrator'}</strong><span>{admin.role.replace('_', ' ')}</span></div></div>
          <button className="logout" onClick={() => api.logout().then(() => { setAdmin(null); setWallets([]); })}><LogOut size={16} />Sign out</button>
        </div>
      </aside>
      <main className="content">
        <header><div><p className="eyebrow">OPERATIONS / OVERVIEW</p><h1>Good morning, operator.</h1><p className="subtle">Settlement intelligence for the Rown network.</p></div><div className="header-actions"><button className="icon-button" title="Refresh analytics" onClick={loadOverview}><RefreshCw className={loading ? 'spin' : ''} size={17} /></button><div className="status"><i />Live data</div></div></header>
        <section className="toolbar"><div className="range-tabs">{[['daily','Today'],['weekly','This week'],['monthly','This month'],['all','All time']].map(([key, label]) => <button className={range === key ? 'selected' : ''} onClick={() => setRange(key)} key={key}>{label}</button>)}</div><span className="updated">Updated {overview ? new Date(overview.meta.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '...'}</span></section>
        {error && <p className="error page-error"><CircleAlert size={16} />{error}</p>}
        <section className="kpi-grid">
          <Kpi label="Transaction value" value={metric ? money(metric.value.usd.current) : '—'} change={metric?.value.usd} icon={<BarChart3 />} />
          <Kpi label="Transaction volume" value={metric ? number(metric.volume.current) : '—'} change={metric?.volume} icon={<Activity />} />
          <Kpi label="Active users" value={userMetric(overview, 'activeUsers', range)} change={userGrowth(overview, 'activeUsers', range)} icon={<Users />} />
          <Kpi label="USD / NGN rate" value={overview?.meta.fx.usdToNgn ? `₦${number(overview.meta.fx.usdToNgn)}` : '—'} icon={<ArrowUpRight />} />
        </section>
        <div className="dashboard-grid">
          <section className="panel chart-panel">
            <div className="panel-heading"><div><p className="eyebrow">MONEY MOVEMENT</p><h2>Transactions by category</h2></div><span className="select-label">{overview?.meta.timezone}<ChevronDown size={14} /></span></div>
            <div className="bars">{(overview?.transactions.byCategory || []).filter((x) => x.key !== 'ALL').map((group) => { const p = group.periods.find((x) => x.period === range) || group.periods.find((x) => x.period === 'allTime'); const max = metric?.value.usd.current || 1; return <div className="bar-row" key={group.key}><span>{group.label}</span><div className="bar-track"><i style={{ width: `${Math.min(100, ((p?.value.usd.current || 0) / max) * 100)}%` }} /></div><strong>{money(p?.value.usd.current || 0)}</strong></div>; })}</div>
            <div className="chart-foot"><span>Value in USD</span><span><i className="legend-dot" />Settled only</span></div>
          </section>
          <section className="panel provider-panel">
            <div className="panel-heading"><div><p className="eyebrow">NETWORK HEALTH</p><h2>Provider activity</h2></div><span className="count">{overview?.providers.length || 0} providers</span></div>
            <div className="provider-list">{(overview?.providers || []).slice(0, 5).map((provider) => { const p = provider.periods.find((x) => x.period === range) || provider.periods.find((x) => x.period === 'allTime'); return <div className="provider-row" key={provider.code}><div className="provider-icon">{provider.name.slice(0, 1)}</div><div className="provider-name"><strong>{provider.name}</strong><span>{provider.providerKind.replace('_', ' ')}</span></div><strong>{money(p?.value.usd.current || 0)}</strong></div>; })}</div>
          </section>
        </div>
        <section className="panel search-panel">
          <div className="panel-heading"><div><p className="eyebrow">SUPPORT TOOL</p><h2>Find a transaction</h2></div><span className="muted">Reference, hash, provider ID</span></div>
          <form onSubmit={doSearch}><div className="search-input"><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. RWN-20260901-a1b2c3d4" /><button type="submit">Search</button></div></form>
          {result && <div className="search-results"><strong>{result.matches.length} matching record{result.matches.length === 1 ? '' : 's'}</strong>{result.matches.map((match, i) => <pre key={i}>{JSON.stringify(match, null, 2)}</pre>)}</div>}
        </section>
      </main>
    </div>
  );
}

function Kpi({ label, value, change, icon }: { label: string; value: string; change?: api.Growth; icon: React.ReactNode }) { return <div className="kpi"><div className="kpi-top"><span>{label}</span><div className="kpi-icon">{icon}</div></div><strong>{value}</strong>{change && <div className={`change ${change.direction}`}>{change.percentageChange === null ? (change.isNew ? 'New activity' : 'No comparison') : `${change.percentageChange >= 0 ? '+' : ''}${change.percentageChange.toFixed(1)}%`}<span> vs previous</span></div>}</div>; }
function money(value: number) { return `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value || 0)}`; }
function number(value: number) { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value || 0); }
function userMetric(o: api.Overview | null, key: string, period: string) { const g = o?.users.find((x) => x.key === key)?.periods.find((x) => x.period === period) || o?.users.find((x) => x.key === key)?.periods.find((x) => x.period === 'allTime'); return g ? number(g.count.current) : '—'; }
function userGrowth(o: api.Overview | null, key: string, period: string) { const g = o?.users.find((x) => x.key === key)?.periods.find((x) => x.period === period) || o?.users.find((x) => x.key === key)?.periods.find((x) => x.period === 'allTime'); return g?.count; }
export default App;
