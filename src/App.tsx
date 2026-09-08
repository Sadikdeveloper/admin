import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  KeyRound,
  LogOut,
  PlugZap,
  RefreshCw,
  ScanLine,
  Search,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react';
import * as api from './api';

/* ------------------------------------------------------------------ */
/* Types & helpers                                                     */
/* ------------------------------------------------------------------ */

interface WalletProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

interface BrowserWallet {
  id: string;
  rdns?: string | null;
  name: string;
  icon?: string;
  source: 'eip6963' | 'injected';
  provider: WalletProvider;
}

function toHex(str: string): string {
  return '0x' + Array.from(new TextEncoder().encode(str)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function describeConnectError(e: unknown): string {
  const code = (e as { code?: number })?.code;
  const msg = e instanceof Error ? e.message : String(e);

  if (code === 4001 || /user rejected|user denied|rejected by user/i.test(msg)) {
    return 'Connection was rejected in your wallet. Click Connect again and approve the request to sign in.';
  }
  if (code === -32002 || /already processing|request already pending|pending request/i.test(msg)) {
    return 'Your wallet already has a pending request. Open the wallet popup, approve or reject it, then click Connect again.';
  }
  if (code === -32603 || code === -32601) {
    return `Your wallet could not handle the sign-in request (${code}). Try the "Scan again" button or restart your wallet extension.`;
  }
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(msg)) {
    return `Can't reach the Rown API at ${api.apiBase}. Make sure the backend server is running and allows this origin (CORS), then try again.`;
  }
  if (/could not verify|not allowlisted|allowlist|not authorized|forbidden|401|403|unauthorized/i.test(msg)) {
    return `This wallet is not on the admin allowlist yet. Add it from the backend (e.g. yarn seed:admin), then sign in again.`;
  }
  return msg || 'Wallet sign-in failed. Please try again.';
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

export default function App() {
  const [admin, setAdmin] = useState<api.Admin | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [overview, setOverview] = useState<api.Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [range, setRange] = useState('all');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<api.SearchResult | null>(null);

  const [wallets, setWallets] = useState<BrowserWallet[]>([]);
  const [busyWalletId, setBusyWalletId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const addWallet = useCallback((wallet: BrowserWallet) => {
    setWallets(current => {
      const key = wallet.rdns ?? wallet.id;
      const idx = current.findIndex(w => (w.rdns ?? w.id) === key);
      if (idx === -1) return [...current, wallet];
      // Prefer the richer EIP-6963 announcement (has a real icon) when a legacy
      // injected fallback found the same wallet first.
      if (wallet.icon && !current[idx].icon) {
        const next = [...current];
        next[idx] = wallet;
        return next;
      }
      return current;
    });
  }, []);

  /* ---- Wallet discovery ---- */

  const requestProviders = useCallback(() => {
    window.dispatchEvent(new Event('eip6963:requestProvider'));
  }, []);

  // Legacy fallback: read window.ethereum / window.ethereum.providers.
  // Must run *after* MetaMask has injected itself, so it is re-run on an
  // interval and whenever MetaMask fires `ethereum#initialized`.
  const scanInjected = useCallback(() => {
    const eth = (window as unknown as { ethereum?: any }).ethereum;
    if (!eth || typeof eth.request !== 'function') return;
    const list = Array.isArray(eth.providers) && eth.providers.length > 0 ? eth.providers : [eth];
    list.forEach((provider: any, i: number) => {
      if (!provider || typeof provider.request !== 'function') return;
      const isMetaMask = !!provider.isMetaMask;
      const rdns = (typeof provider.rdns === 'string' && provider.rdns) || (isMetaMask ? 'io.metamask' : null);
      const name =
        (typeof provider.name === 'string' && provider.name && provider.name !== 'EIP-1193')
          ? provider.name
          : isMetaMask
            ? 'MetaMask'
            : Array.isArray(eth.providers)
              ? `Browser wallet ${i + 1}`
              : 'Browser wallet';
      addWallet({
        id: rdns ?? `injected-${i}`,
        rdns,
        name,
        provider,
        source: 'injected',
      });
    });
  }, [addWallet]);

  useEffect(() => {
    const handleAnnounce = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const info = detail?.info;
      const provider = detail?.provider;
      if (!info?.uuid || !info?.name || !provider?.request) return;
      addWallet({
        id: String(info.uuid),
        rdns: typeof info.rdns === 'string' ? info.rdns : null,
        name: String(info.name),
        icon: typeof info.icon === 'string' ? info.icon : undefined,
        provider,
        source: 'eip6963',
      });
    };

    window.addEventListener('eip6963:announceProvider', handleAnnounce);
    // MetaMask (legacy) fires this right after it sets window.ethereum — the
    // classic cause of "wallet not detected" when the page loads faster than
    // the extension does.
    window.addEventListener('ethereum#initialized', scanInjected as EventListener);
    requestProviders();
    scanInjected();

    return () => {
      window.removeEventListener('eip6963:announceProvider', handleAnnounce);
      window.removeEventListener('ethereum#initialized', scanInjected as EventListener);
    };
  }, [requestProviders, scanInjected, addWallet]);

  // While signed out, keep asking for announcements so a wallet that injects
  // late (cold start, slow machine, wallet just unlocked) still shows up.
  useEffect(() => {
    if (admin) return;
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        requestProviders();
        scanInjected();
      }
    }, 1500);
    const onFocus = () => {
      requestProviders();
      scanInjected();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener('focus', onFocus);
    };
  }, [admin, requestProviders, scanInjected]);

  const rescanWallets = useCallback(() => {
    setError('');
    setScanning(true);
    requestProviders();
    scanInjected();
    window.setTimeout(() => setScanning(false), 700);
  }, [requestProviders, scanInjected]);

  /* ---- Session restore ---- */

  useEffect(() => {
    if (!api.session.access) return;
    let alive = true;
    setRestoring(true);
    api
      .getMe()
      .then(r => {
        if (!alive) return;
        setAdmin(r.data);
        setRestoring(false);
        void loadOverview();
      })
      .catch(() => {
        if (!alive) return;
        setRestoring(false);
        api.session.clear();
        setError('Your saved session could not reach the Rown API. If the backend is running, sign in again below.');
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- Data loading ---- */

  async function loadOverview() {
    setLoading(true);
    setError('');
    try {
      setOverview(await api.getOverview());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load analytics — is the backend running?');
    } finally {
      setLoading(false);
    }
  }

  async function doSearch(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    try {
      setResult(await api.searchTransactions(query.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed — is the backend running?');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  /* ---- Wallet connect / sign-in ---- */

  async function connectWithWallet(wallet: BrowserWallet) {
    setError('');
    setBusyWalletId(wallet.id);
    try {
      const accounts = (await wallet.provider.request({ method: 'eth_requestAccounts' })) as string[];
      if (!accounts?.length) {
        setError(`No accounts found in ${wallet.name}. Unlock your wallet and make sure an account is selected.`);
        return;
      }

      const address = accounts[0];
      const challenge = await api.getNonce(address);
      const signature = (await wallet.provider.request({
        method: 'personal_sign',
        params: [toHex(challenge.data.message), address],
      })) as string;

      if (!signature) throw new Error('The wallet returned an empty signature.');

      const identity = await api.verify(challenge.data.message, signature);
      setAdmin(identity.admin);
      setNotice('');
      await loadOverview();
    } catch (e) {
      console.error('[admin] Connect failed:', e);
      setError(describeConnectError(e));
    } finally {
      setBusyWalletId(null);
    }
  }

  async function signOut() {
    try {
      await api.logout();
    } finally {
      setAdmin(null);
      setOverview(null);
      setResult(null);
      setError('');
      setNotice('');
      setQuery('');
      setRange('all');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Sign-in screen                                                      */
  /* ------------------------------------------------------------------ */

  if (!admin) {
    return (
      <main className="auth-shell">
        <section className="auth-hero">
          <div className="hero-brand">
            <div className="brand-mark">R</div>
            <span className="hero-brand-name">ROWN&nbsp;NETWORK</span>
          </div>
          <div className="hero-inner">
            <p className="hero-eyebrow">OPERATIONS · PRIVATE ACCESS</p>
            <h1>Settlement intelligence, behind the vault.</h1>
            <p className="hero-copy">
              The Rown admin console is a restricted operations dashboard covering settlement activity, user growth and
              transaction trails across the network.
            </p>
            <ul className="hero-points">
              <li><ShieldCheck size={16} /> Signed in with a wallet signature — no seed phrase, no password</li>
              <li><KeyRound size={16} /> Access limited to approved operator wallets</li>
              <li><PlugZap size={16} /> No transactions, no gas fees — signature only</li>
            </ul>
          </div>
        </section>

        <section className="auth-card-wrap">
          <div className="auth-card">
            <p className="eyebrow">OPERATOR SIGN-IN</p>
            <h2>Connect your wallet</h2>
            <p className="auth-sub">Pick your wallet below and approve the signature request to continue into the console.</p>

            {error && (
              <div className="banner banner-error" role="alert">
                <CircleAlert size={16} className="banner-ico" />
                <span>{error}</span>
              </div>
            )}
            {notice && (
              <div className="banner banner-info" role="status">
                <CheckCircle2 size={16} className="banner-ico" />
                <span>{notice}</span>
              </div>
            )}

            {restoring ? (
              <div className="wallet-loading">
                <RefreshCw size={18} className="spin" />
                <span>Checking saved session…</span>
              </div>
            ) : wallets.length > 0 ? (
              <div className="wallet-panel">
                <div className="wallet-toolbar">
                  <div>
                    <p className="eyebrow">AVAILABLE WALLETS</p>
                    <h3>Choose a wallet</h3>
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    title="Scan for wallet extensions again"
                    onClick={rescanWallets}
                    disabled={scanning}
                  >
                    <RefreshCw size={15} className={scanning ? 'spin' : ''} />
                  </button>
                </div>
                <ul className="wallet-list">
                  {wallets.map(wallet => {
                    const busy = busyWalletId === wallet.id;
                    return (
                      <li key={wallet.id} className="wallet-row">
                        <span className="wallet-avatar" aria-hidden="true">
                          {wallet.icon ? (
                            <img src={wallet.icon} alt="" />
                          ) : (
                            <Wallet size={16} />
                          )}
                        </span>
                        <span className="wallet-meta">
                          <strong>{wallet.name}</strong>
                          <span>Browser extension</span>
                        </span>
                        <button
                          type="button"
                          className="connect-btn"
                          onClick={() => connectWithWallet(wallet)}
                          disabled={busyWalletId !== null && !busy}
                        >
                          {busy ? (
                            <>
                              <RefreshCw size={14} className="spin" />
                              Connecting
                            </>
                          ) : (
                            'Connect'
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <p className="wallet-foot">
                  <CheckCircle2 size={13} />
                  Auto-detection is active — installing or unlocking a wallet updates this list automatically.
                </p>
              </div>
            ) : (
              <div className="wallet-empty">
                <div className="empty-icon"><Wallet size={22} /></div>
                <h3>No wallet detected</h3>
                <p>
                  We couldn't find a browser wallet. Install MetaMask — or unlock it if it's already installed — then
                  scan again.
                </p>
                <div className="empty-actions">
                  <button type="button" className="btn btn-primary" onClick={rescanWallets} disabled={scanning}>
                    {scanning ? (
                      <>
                        <RefreshCw size={15} className="spin" />
                        Scanning…
                      </>
                    ) : (
                      <>
                        <ScanLine size={15} />
                        Scan again
                      </>
                    )}
                  </button>
                  <a
                    className="btn btn-ghost"
                    href="https://metamask.io/download/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Get MetaMask
                    <ExternalLink size={13} />
                  </a>
                </div>
                <p className="empty-tip">
                  Tip: after installing or unlocking MetaMask, click its browser icon once — this page detects wallets
                  every few seconds, no reload needed.
                </p>
              </div>
            )}

            <p className="auth-meta">EOA wallets only · Approved operators only</p>
          </div>
          <p className="auth-foot">
            Rown admin console · <span>v0.1</span>
          </p>
        </section>
      </main>
    );
  }

  /* ------------------------------------------------------------------ */
  /* Dashboard                                                           */
  /* ------------------------------------------------------------------ */

  const metric =
    overview?.transactions.totals.periods.find(p => p.period === range) ||
    overview?.transactions.totals.periods.find(p => p.period === 'allTime');

  const flashSoon = (label: string) => {
    setNotice(`${label} isn't included in this version of the console yet — Overview only.`);
    window.setTimeout(() => setNotice(''), 3200);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="side-brand">
          <div className="brand-mark small">R</div>
          <div>
            <strong>rown</strong>
            <span>ADMIN CONSOLE</span>
          </div>
        </div>
        <nav className="side-nav" aria-label="Console sections">
          <a className="active" aria-current="page"><BarChart3 size={17} />Overview</a>
          <a onClick={() => flashSoon('Transactions')}><Activity size={17} />Transactions</a>
          <a onClick={() => flashSoon('Users')}><Users size={17} />Users</a>
        </nav>
        <div className="side-bottom">
          <div className="operator">
            <div className="avatar">{admin.address.slice(2, 4).toUpperCase()}</div>
            <div>
              <strong>{admin.label || 'Administrator'}</strong>
              <span>{admin.role.replace('_', ' ')}</span>
            </div>
          </div>
          <div className="operator-address" title={admin.address}>{shortAddress(admin.address)}</div>
          <button className="signout-btn" onClick={signOut}><LogOut size={15} />Sign out</button>
        </div>
      </aside>

      <main className="content">
        <header className="content-head">
          <div>
            <p className="eyebrow">OPERATIONS / OVERVIEW</p>
            <h1>{greeting()}, operator.</h1>
            <p className="subtle">Settlement intelligence for the Rown network.</p>
          </div>
          <div className="header-actions">
            <button className="icon-button" title="Refresh analytics" onClick={loadOverview}>
              <RefreshCw size={16} className={loading ? 'spin' : ''} />
            </button>
            <span className="status"><i />Live data</span>
          </div>
        </header>

        {notice && (
          <div className="banner banner-info page-banner" role="status">
            <CheckCircle2 size={16} className="banner-ico" />
            <span>{notice}</span>
          </div>
        )}
        {error && (
          <div className="banner banner-error page-banner" role="alert">
            <CircleAlert size={16} className="banner-ico" />
            <span>{error}</span>
          </div>
        )}

        <section className="toolbar">
          <div className="range-tabs" role="tablist" aria-label="Time range">
            {([['daily', 'Today'], ['weekly', 'This week'], ['monthly', 'This month'], ['all', 'All time']] as const).map(([key, label]) => (
              <button key={key} className={range === key ? 'selected' : ''} onClick={() => setRange(key)}>
                {label}
              </button>
            ))}
          </div>
          <span className="updated">
            Updated {overview ? new Date(overview.meta.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '…'}
          </span>
        </section>

        <section className="kpi-grid">
          <Kpi label="Transaction value" value={metric ? money(metric.value.usd.current) : '—'} change={metric?.value.usd} icon={<BarChart3 />} />
          <Kpi label="Transaction volume" value={metric ? number(metric.volume.current) : '—'} change={metric?.volume} icon={<Activity />} />
          <Kpi label="Active users" value={userMetric(overview, 'activeUsers', range)} change={userGrowth(overview, 'activeUsers', range)} icon={<Users />} />
          <Kpi label="USD / NGN rate" value={overview?.meta.fx.usdToNgn ? `₦${number(overview.meta.fx.usdToNgn)}` : '—'} icon={<ArrowUpRight />} />
        </section>

        <div className="dashboard-grid">
          <section className="panel chart-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">MONEY MOVEMENT</p>
                <h2>Transactions by category</h2>
              </div>
              <span className="select-label">
                {overview?.meta.timezone}
                <ChevronDown size={14} />
              </span>
            </div>
            <div className="bars">
              {(overview?.transactions.byCategory || [])
                .filter(x => x.key !== 'ALL')
                .map(group => {
                  const p =
                    group.periods.find(x => x.period === range) ||
                    group.periods.find(x => x.period === 'allTime');
                  const max = metric?.value.usd.current || 1;
                  return (
                    <div className="bar-row" key={group.key}>
                      <span>{group.label}</span>
                      <div className="bar-track">
                        <i style={{ width: `${Math.min(100, ((p?.value.usd.current || 0) / max) * 100)}%` }} />
                      </div>
                      <strong>{money(p?.value.usd.current || 0)}</strong>
                    </div>
                  );
                })}
            </div>
            <div className="chart-foot">
              <span>Value in USD</span>
              <span><i className="legend-dot" />Settled only</span>
            </div>
          </section>

          <section className="panel provider-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">NETWORK HEALTH</p>
                <h2>Provider activity</h2>
              </div>
              <span className="count">{overview?.providers.length || 0} providers</span>
            </div>
            <div className="provider-list">
              {(overview?.providers || []).slice(0, 5).map(provider => {
                const p =
                  provider.periods.find(x => x.period === range) ||
                  provider.periods.find(x => x.period === 'allTime');
                return (
                  <div className="provider-row" key={provider.code}>
                    <div className="provider-icon">{provider.name.slice(0, 1)}</div>
                    <div className="provider-name">
                      <strong>{provider.name}</strong>
                      <span>{provider.providerKind.replace('_', ' ')}</span>
                    </div>
                    <strong>{money(p?.value.usd.current || 0)}</strong>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <section className="panel search-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">SUPPORT TOOL</p>
              <h2>Find a transaction</h2>
            </div>
            <span className="muted">Reference, hash or provider ID</span>
          </div>
          <form onSubmit={doSearch}>
            <div className="search-input">
              <Search size={18} />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="e.g. RWN-20260901-a1b2c3d4"
                aria-label="Search transactions"
              />
              <button type="submit" disabled={loading}>
                {loading ? 'Searching…' : 'Search'}
              </button>
            </div>
          </form>
          {result &&
            (result.matches.length > 0 ? (
              <div className="search-results">
                <div className="search-results-head">
                  <strong>{result.matches.length} matching record{result.matches.length === 1 ? '' : 's'}</strong>
                  <span>for “{result.query}”</span>
                </div>
                {result.matches.map((match, i) => (
                  <pre key={i} className="match-card">{JSON.stringify(match, null, 2)}</pre>
                ))}
              </div>
            ) : (
              <div className="search-empty">
                No transactions matched “{result.query}”. Check the reference or try a full transaction hash.
              </div>
            ))}
        </section>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small presentational components                                      */
/* ------------------------------------------------------------------ */

function Kpi({ label, value, change, icon }: { label: string; value: string; change?: api.Growth; icon: ReactNode }) {
  return (
    <div className="kpi">
      <div className="kpi-top">
        <span>{label}</span>
        <div className="kpi-icon">{icon}</div>
      </div>
      <strong>{value}</strong>
      {change && (
        <div className={`change ${change.direction}`}>
          {change.percentageChange === null
            ? change.isNew ? 'New activity' : 'No comparison'
            : `${change.percentageChange >= 0 ? '+' : ''}${change.percentageChange.toFixed(1)}%`}
          <span> vs previous</span>
        </div>
      )}
    </div>
  );
}

function money(value: number) {
  return `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value || 0)}`;
}

function number(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value || 0);
}

function userMetric(o: api.Overview | null, key: string, period: string) {
  const g =
    o?.users.find(x => x.key === key)?.periods.find(x => x.period === period) ||
    o?.users.find(x => x.key === key)?.periods.find(x => x.period === 'allTime');
  return g ? number(g.count.current) : '—';
}

function userGrowth(o: api.Overview | null, key: string, period: string) {
  const g =
    o?.users.find(x => x.key === key)?.periods.find(x => x.period === period) ||
    o?.users.find(x => x.key === key)?.periods.find(x => x.period === 'allTime');
  return g?.count;
}
