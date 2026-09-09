import { Component, useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Copy,
  ExternalLink,
  FileText,
  Info,
  KeyRound,
  LogOut,
  PlugZap,
  RefreshCw,
  ScanLine,
  Search,
  ShieldCheck,
  Users,
  Wallet,
  X,
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

type Page = 'overview' | 'transactions' | 'users';

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
    return 'Connection was cancelled in your wallet. Click Connect on the wallet you want to use, then approve the request to sign in.';
  }
  if (code === -32002 || /already processing|request already pending|pending request/i.test(msg)) {
    return 'Your wallet already has a request waiting. Open your wallet, approve or reject the pending request, then try connecting again.';
  }
  if (code === -32603 || code === -32601) {
    return 'Your wallet had trouble processing the sign-in request. Try clicking "Scan again" or restart your wallet extension and try once more.';
  }
  if (/failed to fetch|networkerror|network request failed|load failed|can't reach|reach the rown/i.test(msg)) {
    return "We're having trouble reaching the Rown server. Please check your internet connection and try again in a moment.";
  }
  if (/could not verify|not allowlisted|allowlist|not authorized|forbidden|401|403|unauthorized|approved admin/i.test(msg)) {
    return "This wallet isn't on the approved admin list yet. Please ask your team lead to add it, then try signing in again.";
  }
  if (/empty signature/i.test(msg)) {
    return 'Your wallet didn\'t return a signature. Please try again and make sure to approve the request when prompted.';
  }
  if (e instanceof Error && msg.length < 160 && !/\{|\[|stack|trace/i.test(msg)) {
    return msg;
  }
  return 'Something went wrong while connecting your wallet. Please try again — if it keeps happening, let the team know.';
}

function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  return Promise.resolve();
}

function money(value?: number) {
  return `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value || 0)}`;
}

function num(value?: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value || 0);
}

function userMetric(users: api.UserGroup[] | undefined, key: string, period: string) {
  const g =
    users?.find(x => x.key === key)?.periods?.find(x => x.period === period) ||
    users?.find(x => x.key === key)?.periods?.find(x => x.period === 'allTime');
  return g ? num(g.count?.current) : '—';
}

function userGrowth(users: api.UserGroup[] | undefined, key: string, period: string) {
  const g =
    users?.find(x => x.key === key)?.periods?.find(x => x.period === period) ||
    users?.find(x => x.key === key)?.periods?.find(x => x.period === 'allTime');
  return g?.count;
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[admin] Render crashed:', error);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="crash-shell">
          <div className="crash-card">
            <CircleAlert size={22} />
            <h1>The console hit a snag</h1>
            <p>Something unexpected happened after sign-in. Reload to try again, or sign out and connect your wallet once more.</p>
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              <RefreshCw size={15} />
              Reload console
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginTop: 10 }}
              onClick={() => {
                api.session.clear();
                window.location.reload();
              }}
            >
              <LogOut size={15} />
              Sign out
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [admin, setAdmin] = useState<api.Admin | null>(null);
  const [restoring, setRestoring] = useState(() => Boolean(api.session.access));
  const [overview, setOverview] = useState<api.Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [range, setRange] = useState('all');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<api.SearchResult | null>(null);
  const [copied, setCopied] = useState(false);

  const [wallets, setWallets] = useState<BrowserWallet[]>([]);
  const [busyWalletId, setBusyWalletId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const [activePage, setActivePage] = useState<Page>('overview');

  /* Transactions page state */
  const [txData, setTxData] = useState<api.TransactionAnalytics | null>(null);
  const [txLoading, setTxLoading] = useState(false);
  const [txSearchQuery, setTxSearchQuery] = useState('');
  const [txResult, setTxResult] = useState<api.SearchResult | null>(null);
  const [txRange, setTxRange] = useState('all');

  /* Users page state */
  const [userData, setUserData] = useState<api.UserAnalytics | null>(null);
  const [userLoading, setUserLoading] = useState(false);
  const [userRange, setUserRange] = useState('all');

  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setNoticeWithTimer = useCallback((msg: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(msg);
    noticeTimer.current = setTimeout(() => setNotice(''), 3200);
  }, []);

  const addWallet = useCallback((wallet: BrowserWallet) => {
    setWallets(current => {
      const key = wallet.rdns ?? wallet.id;
      const idx = current.findIndex(w => (w.rdns ?? w.id) === key);
      if (idx === -1) return [...current, wallet];
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
    window.addEventListener('ethereum#initialized', scanInjected as EventListener);
    requestProviders();
    scanInjected();

    return () => {
      window.removeEventListener('eip6963:announceProvider', handleAnnounce);
      window.removeEventListener('ethereum#initialized', scanInjected as EventListener);
    };
  }, [requestProviders, scanInjected, addWallet]);

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
        if (!r?.data?.address) {
          throw new Error('invalid profile');
        }
        setAdmin(r.data);
        setRestoring(false);
        void loadOverview();
      })
      .catch(() => {
        if (!alive) return;
        setRestoring(false);
        api.session.clear();
        setError("Your previous session couldn't be restored. Please sign in again with your wallet below.");
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
      setError(e instanceof Error ? e.message : "We couldn't load the latest analytics. Please try again in a moment.");
    } finally {
      setLoading(false);
    }
  }

  async function loadTransactions() {
    setTxLoading(true);
    setError('');
    try {
      setTxData(await api.getTransactions());
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't load transaction analytics. Please try again in a moment.");
    } finally {
      setTxLoading(false);
    }
  }

  async function loadUsers() {
    setUserLoading(true);
    setError('');
    try {
      setUserData(await api.getUsers());
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't load user analytics. Please try again in a moment.");
    } finally {
      setUserLoading(false);
    }
  }

  function navigateTo(page: Page) {
    setActivePage(page);
    setError('');
    setNotice('');
    if (page === 'overview' && !overview) loadOverview();
    if (page === 'transactions' && !txData) loadTransactions();
    if (page === 'users' && !userData) loadUsers();
  }

  async function doSearch(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    try {
      setResult(await api.searchTransactions(query.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't complete your search. Please try again in a moment.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  async function doTxSearch(event: FormEvent) {
    event.preventDefault();
    if (!txSearchQuery.trim()) return;
    setTxLoading(true);
    setError('');
    try {
      setTxResult(await api.searchTransactions(txSearchQuery.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't complete your search. Please try again in a moment.");
      setTxResult(null);
    } finally {
      setTxLoading(false);
    }
  }

  function clearSearch() {
    setQuery('');
    setResult(null);
    setError('');
  }

  function clearTxSearch() {
    setTxSearchQuery('');
    setTxResult(null);
    setError('');
  }

  /* ---- Wallet connect / sign-in ---- */

  async function connectWithWallet(wallet: BrowserWallet) {
    setError('');
    setBusyWalletId(wallet.id);
    try {
      const accounts = (await wallet.provider.request({ method: 'eth_requestAccounts' })) as string[];
      if (!accounts?.length) {
        setError(`No accounts were found in ${wallet.name}. Please unlock your wallet and make sure an account is selected, then try connecting again.`);
        return;
      }

      const address = accounts[0];
      const challenge = await api.getNonce(address);
      const message = challenge?.data?.message;
      if (!message) {
        throw new Error('The server did not send a sign-in message. Please try connecting again.');
      }
      const signature = (await wallet.provider.request({
        method: 'personal_sign',
        params: [toHex(message), address],
      })) as string;

      if (!signature) throw new Error('Your wallet didn\'t return a signature. Please try again and approve the request when it appears.');

      const identity = await api.verify(message, signature);
      if (!identity?.admin?.address) {
        throw new Error('Sign-in succeeded but we could not load your operator profile. Please try connecting again.');
      }
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
      setTxData(null);
      setTxResult(null);
      setUserData(null);
      setError('');
      setNotice('');
      setQuery('');
      setTxSearchQuery('');
      setRange('all');
      setTxRange('all');
      setUserRange('all');
      setActivePage('overview');
    }
  }

  async function handleCopyAddress(address: string) {
    await copyToClipboard(address);
    setCopied(true);
    setNoticeWithTimer('Address copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
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
                <button className="banner-close" onClick={() => setError('')} aria-label="Dismiss error">
                  <X size={14} />
                </button>
              </div>
            )}
            {notice && (
              <div className="banner banner-info" role="status">
                <Info size={16} className="banner-ico" />
                <span>{notice}</span>
                <button className="banner-close" onClick={() => setNotice('')} aria-label="Dismiss notice">
                  <X size={14} />
                </button>
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

  const isLoadingOverview = loading && !overview;

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
          <a
            className={activePage === 'overview' ? 'active' : ''}
            aria-current={activePage === 'overview' ? 'page' : undefined}
            onClick={() => navigateTo('overview')}
          >
            <BarChart3 size={17} />Overview
          </a>
          <a
            className={activePage === 'transactions' ? 'active' : ''}
            aria-current={activePage === 'transactions' ? 'page' : undefined}
            onClick={() => navigateTo('transactions')}
          >
            <Activity size={17} />Transactions
          </a>
          <a
            className={activePage === 'users' ? 'active' : ''}
            aria-current={activePage === 'users' ? 'page' : undefined}
            onClick={() => navigateTo('users')}
          >
            <Users size={17} />Users
          </a>
        </nav>
        <div className="side-bottom">
          <div className="operator">
            <div className="avatar">{(admin.address || '??').slice(2, 4).toUpperCase()}</div>
            <div>
              <strong>{admin.label || 'Administrator'}</strong>
              <span>{(admin.role || 'operator').replaceAll('_', ' ')}</span>
            </div>
          </div>
          <button
            className="operator-address copyable"
            title={`Click to copy: ${admin.address}`}
            onClick={() => handleCopyAddress(admin.address)}
          >
            {shortAddress(admin.address)}
            <Copy size={11} className="copy-icon" />
          </button>
          <button className="signout-btn" onClick={signOut} aria-label="Sign out"><LogOut size={15} />Sign out</button>
        </div>
      </aside>

      <main className="content">
        {notice && (
          <div className="banner banner-info page-banner" role="status">
            <Info size={16} className="banner-ico" />
            <span>{notice}</span>
            <button className="banner-close" onClick={() => setNotice('')} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        )}
        {error && (
          <div className="banner banner-error page-banner" role="alert">
            <CircleAlert size={16} className="banner-ico" />
            <span>{error}</span>
            <button className="banner-close" onClick={() => setError('')} aria-label="Dismiss error">
              <X size={14} />
            </button>
          </div>
        )}

        {activePage === 'overview' && (
          <OverviewPage
            overview={overview}
            loading={isLoadingOverview}
            range={range}
            setRange={setRange}
            query={query}
            setQuery={setQuery}
            result={result}
            doSearch={doSearch}
            clearSearch={clearSearch}
            searchLoading={loading && !!query}
            loadOverview={loadOverview}
          />
        )}

        {activePage === 'transactions' && (
          <TransactionsPage
            data={txData}
            loading={txLoading}
            range={txRange}
            setRange={setTxRange}
            searchQuery={txSearchQuery}
            setSearchQuery={setTxSearchQuery}
            txResult={txResult}
            doSearch={doTxSearch}
            clearSearch={clearTxSearch}
            searchLoading={txLoading && !!txSearchQuery}
            loadTransactions={loadTransactions}
          />
        )}

        {activePage === 'users' && (
          <UsersPage
            data={userData}
            loading={userLoading}
            range={userRange}
            setRange={setUserRange}
            loadUsers={loadUsers}
          />
        )}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Overview page                                                       */
/* ------------------------------------------------------------------ */

function OverviewPage({
  overview,
  loading,
  range,
  setRange,
  query,
  setQuery,
  result,
  doSearch,
  clearSearch,
  searchLoading,
  loadOverview,
}: {
  overview: api.Overview | null;
  loading: boolean;
  range: string;
  setRange: (r: string) => void;
  query: string;
  setQuery: (q: string) => void;
  result: api.SearchResult | null;
  doSearch: (e: FormEvent) => void;
  clearSearch: () => void;
  searchLoading: boolean;
  loadOverview: () => void;
}) {
  const metric =
    overview?.transactions?.totals?.periods?.find(p => p.period === range) ||
    overview?.transactions?.totals?.periods?.find(p => p.period === 'allTime');

  const categories = (overview?.transactions?.byCategory || []).filter(x => x.key !== 'ALL');
  const barMax = Math.max(
    1,
    ...categories.map(group => {
      const p =
        group.periods?.find(x => x.period === range) ||
        group.periods?.find(x => x.period === 'allTime');
      return p?.value?.usd?.current || 0;
    }),
  );

  const userGroups = overview?.users?.groups;

  return (
    <>
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
          <span className={`status ${!overview && !loading ? 'status-stale' : ''}`}>
            <i />{overview ? 'Live data' : loading ? 'Connecting…' : 'No data'}
          </span>
        </div>
      </header>

      <section className="toolbar">
        <div className="range-tabs" role="tablist" aria-label="Time range">
          {([['daily', 'Today'], ['weekly', 'This week'], ['monthly', 'This month'], ['all', 'All time']] as const).map(([key, label]) => (
            <button key={key} className={range === key ? 'selected' : ''} onClick={() => setRange(key)}>
              {label}
            </button>
          ))}
        </div>
        <span className="updated">
          {overview?.meta?.generatedAt
            ? `Updated ${new Date(overview.meta.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : loading ? 'Loading…' : '—'}
        </span>
      </section>

      <section className="kpi-grid">
        {loading ? (
          <>
            <div className="kpi skeleton"><div className="skel-line skel-sm" /><div className="skel-line skel-lg" /><div className="skel-line skel-xs" /></div>
            <div className="kpi skeleton"><div className="skel-line skel-sm" /><div className="skel-line skel-lg" /><div className="skel-line skel-xs" /></div>
            <div className="kpi skeleton"><div className="skel-line skel-sm" /><div className="skel-line skel-lg" /><div className="skel-line skel-xs" /></div>
            <div className="kpi skeleton"><div className="skel-line skel-sm" /><div className="skel-line skel-lg" /><div className="skel-line skel-xs" /></div>
          </>
        ) : (
          <>
            <Kpi label="Transaction value" value={metric ? money(metric.value?.usd?.current) : '—'} change={metric?.value?.usd} icon={<BarChart3 />} />
            <Kpi label="Transaction volume" value={metric ? num(metric.volume?.current) : '—'} change={metric?.volume} icon={<Activity />} />
            <Kpi label="Active users" value={userMetric(userGroups, 'activeUsers', range)} change={userGrowth(userGroups, 'activeUsers', range)} icon={<Users />} />
            <Kpi label="USD / NGN rate" value={overview?.meta?.fx?.usdToNgn ? `₦${num(overview.meta.fx.usdToNgn)}` : '—'} icon={<ArrowUpRight />} />
          </>
        )}
      </section>

      <div className="dashboard-grid">
        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">MONEY MOVEMENT</p>
              <h2>Transactions by category</h2>
            </div>
            <span className="select-label">
              {overview?.meta?.timezone || '—'}
              <ChevronDown size={14} />
            </span>
          </div>
          {loading ? (
            <div className="bars">
              {[1, 2, 3, 4].map(i => (
                <div className="bar-row skeleton" key={i}>
                  <span className="skel-line" style={{ width: '60%' }} />
                  <div className="bar-track"><i style={{ width: `${20 + i * 15}%` }} className="skel-bar" /></div>
                  <strong className="skel-line" style={{ width: '50%' }} />
                </div>
              ))}
            </div>
          ) : categories.length > 0 ? (
            <div className="bars">
              {categories.map(group => {
                const p =
                  group.periods?.find(x => x.period === range) ||
                  group.periods?.find(x => x.period === 'allTime');
                return (
                  <div className="bar-row" key={group.key}>
                    <span>{group.label}</span>
                    <div className="bar-track">
                      <i style={{ width: `${Math.min(100, ((p?.value?.usd?.current || 0) / barMax) * 100)}%` }} />
                    </div>
                    <strong>{money(p?.value?.usd?.current || 0)}</strong>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="panel-empty">
              <BarChart3 size={24} />
              <p>No transaction categories to display yet.</p>
            </div>
          )}
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
            <span className="count">{overview?.providers?.length || 0} providers</span>
          </div>
          {loading ? (
            <div className="provider-list">
              {[1, 2, 3].map(i => (
                <div className="provider-row skeleton" key={i}>
                  <div className="provider-icon skel-circle" />
                  <div className="provider-name"><div className="skel-line" style={{ width: '70%' }} /><div className="skel-line skel-xs" style={{ width: '40%', marginTop: 4 }} /></div>
                  <strong className="skel-line" style={{ width: '50px' }} />
                </div>
              ))}
            </div>
          ) : (overview?.providers || []).length > 0 ? (
            <div className="provider-list">
              {(overview?.providers || []).slice(0, 5).map(provider => {
                const p =
                  provider.periods?.find(x => x.period === range) ||
                  provider.periods?.find(x => x.period === 'allTime');
                return (
                  <div className="provider-row" key={provider.code}>
                    <div className="provider-icon">{(provider.name || '?').slice(0, 1)}</div>
                    <div className="provider-name">
                      <strong>{provider.name}</strong>
                      <span>{(provider.providerKind || 'provider').replaceAll('_', ' ')}</span>
                    </div>
                    <strong>{money(p?.value?.usd?.current || 0)}</strong>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="panel-empty">
              <Users size={24} />
              <p>No provider data available yet.</p>
            </div>
          )}
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
            {query && (
              <button type="button" className="search-clear" onClick={clearSearch} aria-label="Clear search">
                <X size={14} />
              </button>
            )}
            <button type="submit" disabled={searchLoading}>
              {searchLoading ? 'Searching…' : 'Search'}
            </button>
          </div>
        </form>
        {result &&
          (result.matches.length > 0 ? (
            <div className="search-results">
              <div className="search-results-head">
                <strong>{result.matches.length} matching record{result.matches.length === 1 ? '' : 's'}</strong>
                <span>for "{result.query}"</span>
                <button type="button" className="search-results-clear" onClick={clearSearch}>Clear</button>
              </div>
              {result.matches.map((match, i) => (
                <TransactionMatchCard key={i} match={match} index={i} />
              ))}
            </div>
          ) : (
            <div className="search-empty">
              <Search size={20} />
              <p>No transactions matched "{result.query}". Check the reference or try a full transaction hash.</p>
            </div>
          ))}
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Transactions page                                                   */
/* ------------------------------------------------------------------ */

function TransactionsPage({
  data,
  loading,
  range,
  setRange,
  searchQuery,
  setSearchQuery,
  txResult,
  doSearch,
  clearSearch,
  searchLoading,
  loadTransactions,
}: {
  data: api.TransactionAnalytics | null;
  loading: boolean;
  range: string;
  setRange: (r: string) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  txResult: api.SearchResult | null;
  doSearch: (e: FormEvent) => void;
  clearSearch: () => void;
  searchLoading: boolean;
  loadTransactions: () => void;
}) {
  const metric =
    data?.totals?.periods?.find(p => p.period === range) ||
    data?.totals?.periods?.find(p => p.period === 'allTime');

  const categories = (data?.byCategory || []).filter(x => x.key !== 'ALL');
  const barMax = Math.max(
    1,
    ...categories.map(group => {
      const p =
        group.periods?.find(x => x.period === range) ||
        group.periods?.find(x => x.period === 'allTime');
      return p?.value?.usd?.current || 0;
    }),
  );

  const providers = data?.byProvider || [];

  return (
    <>
      <header className="content-head">
        <div>
          <p className="eyebrow">OPERATIONS / TRANSACTIONS</p>
          <h1>Transaction analytics</h1>
          <p className="subtle">Value, volume and category breakdown across the Rown network.</p>
        </div>
        <div className="header-actions">
          <button className="icon-button" title="Refresh transaction analytics" onClick={loadTransactions}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
          <span className={`status ${!data && !loading ? 'status-stale' : ''}`}>
            <i />{data ? 'Live data' : loading ? 'Connecting…' : 'No data'}
          </span>
        </div>
      </header>

      <section className="toolbar">
        <div className="range-tabs" role="tablist" aria-label="Time range">
          {([['daily', 'Today'], ['weekly', 'This week'], ['monthly', 'This month'], ['all', 'All time']] as const).map(([key, label]) => (
            <button key={key} className={range === key ? 'selected' : ''} onClick={() => setRange(key)}>
              {label}
            </button>
          ))}
        </div>
        <span className="updated">
          {data?.meta?.generatedAt
            ? `Updated ${new Date(data.meta.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : loading ? 'Loading…' : '—'}
        </span>
      </section>

      <section className="kpi-grid">
        {loading ? (
          <>
            <div className="kpi skeleton"><div className="skel-line skel-sm" /><div className="skel-line skel-lg" /><div className="skel-line skel-xs" /></div>
            <div className="kpi skeleton"><div className="skel-line skel-sm" /><div className="skel-line skel-lg" /><div className="skel-line skel-xs" /></div>
            <div className="kpi skeleton"><div className="skel-line skel-sm" /><div className="skel-line skel-lg" /><div className="skel-line skel-xs" /></div>
            <div className="kpi skeleton"><div className="skel-line skel-sm" /><div className="skel-line skel-lg" /><div className="skel-line skel-xs" /></div>
          </>
        ) : (
          <>
            <Kpi label="Total value (USD)" value={metric ? money(metric.value?.usd?.current) : '—'} change={metric?.value?.usd} icon={<BarChart3 />} />
            <Kpi label="Net value (USD)" value={metric ? money(metric.value?.net?.usd?.current) : '—'} change={metric?.value?.net?.usd} icon={<ArrowUpRight />} />
            <Kpi label="Transaction volume" value={metric ? num(metric.volume?.current) : '—'} change={metric?.volume} icon={<Activity />} />
            <Kpi label="Fees collected" value={metric ? money(metric.value?.fees?.usd?.current) : '—'} change={metric?.value?.fees?.usd} icon={<FileText />} />
          </>
        )}
      </section>

      <div className="dashboard-grid">
        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">CATEGORY BREAKDOWN</p>
              <h2>Value by category</h2>
            </div>
            <span className="select-label">
              {data?.meta?.timezone || '—'}
              <ChevronDown size={14} />
            </span>
          </div>
          {loading ? (
            <div className="bars">
              {[1, 2, 3, 4].map(i => (
                <div className="bar-row skeleton" key={i}>
                  <span className="skel-line" style={{ width: '60%' }} />
                  <div className="bar-track"><i style={{ width: `${20 + i * 15}%` }} className="skel-bar" /></div>
                  <strong className="skel-line" style={{ width: '50%' }} />
                </div>
              ))}
            </div>
          ) : categories.length > 0 ? (
            <div className="bars">
              {categories.map(group => {
                const p =
                  group.periods?.find(x => x.period === range) ||
                  group.periods?.find(x => x.period === 'allTime');
                return (
                  <div className="bar-row" key={group.key}>
                    <span>{group.label}</span>
                    <div className="bar-track">
                      <i style={{ width: `${Math.min(100, ((p?.value?.usd?.current || 0) / barMax) * 100)}%` }} />
                    </div>
                    <strong>{money(p?.value?.usd?.current || 0)}</strong>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="panel-empty">
              <BarChart3 size={24} />
              <p>No transaction categories to display yet.</p>
            </div>
          )}
          <div className="chart-foot">
            <span>Value in USD (gross)</span>
            <span><i className="legend-dot" />Settled only</span>
          </div>
        </section>

        <section className="panel provider-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">PROVIDERS</p>
              <h2>Per-provider volume</h2>
            </div>
            <span className="count">{providers.length} providers</span>
          </div>
          {loading ? (
            <div className="provider-list">
              {[1, 2, 3].map(i => (
                <div className="provider-row skeleton" key={i}>
                  <div className="provider-icon skel-circle" />
                  <div className="provider-name"><div className="skel-line" style={{ width: '70%' }} /><div className="skel-line skel-xs" style={{ width: '40%', marginTop: 4 }} /></div>
                  <strong className="skel-line" style={{ width: '50px' }} />
                </div>
              ))}
            </div>
          ) : providers.length > 0 ? (
            <div className="provider-list">
              {providers.slice(0, 8).map(provider => {
                const p =
                  provider.periods?.find(x => x.period === range) ||
                  provider.periods?.find(x => x.period === 'allTime');
                return (
                  <div className="provider-row" key={provider.code}>
                    <div className="provider-icon">{(provider.name || '?').slice(0, 1)}</div>
                    <div className="provider-name">
                      <strong>{provider.name}</strong>
                      <span>{(provider.providerKind || 'provider').replaceAll('_', ' ')}</span>
                    </div>
                    <strong>{money(p?.value?.usd?.current || 0)}</strong>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="panel-empty">
              <Activity size={24} />
              <p>No provider data available yet.</p>
            </div>
          )}
        </section>
      </div>

      <section className="panel search-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">LOOKUP</p>
            <h2>Find a transaction</h2>
          </div>
          <span className="muted">Reference, hash or provider ID</span>
        </div>
        <form onSubmit={doSearch}>
          <div className="search-input">
            <Search size={18} />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="e.g. RWN-20260901-a1b2c3d4"
              aria-label="Search transactions"
            />
            {searchQuery && (
              <button type="button" className="search-clear" onClick={clearSearch} aria-label="Clear search">
                <X size={14} />
              </button>
            )}
            <button type="submit" disabled={searchLoading}>
              {searchLoading ? 'Searching…' : 'Search'}
            </button>
          </div>
        </form>
        {txResult &&
          (txResult.matches.length > 0 ? (
            <div className="search-results">
              <div className="search-results-head">
                <strong>{txResult.matches.length} matching record{txResult.matches.length === 1 ? '' : 's'}</strong>
                <span>for "{txResult.query}"</span>
                <button type="button" className="search-results-clear" onClick={clearSearch}>Clear</button>
              </div>
              {txResult.matches.map((match, i) => (
                <TransactionMatchCard key={i} match={match} index={i} />
              ))}
            </div>
          ) : (
            <div className="search-empty">
              <Search size={20} />
              <p>No transactions matched "{txResult.query}". Check the reference or try a full transaction hash.</p>
            </div>
          ))}
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Users page                                                          */
/* ------------------------------------------------------------------ */

function UsersPage({
  data,
  loading,
  range,
  setRange,
  loadUsers,
}: {
  data: api.UserAnalytics | null;
  loading: boolean;
  range: string;
  setRange: (r: string) => void;
  loadUsers: () => void;
}) {
  const groups = data?.groups || [];
  const stock = data?.stock;

  return (
    <>
      <header className="content-head">
        <div>
          <p className="eyebrow">OPERATIONS / USERS</p>
          <h1>User analytics</h1>
          <p className="subtle">Signups, onboarding, KYC and active user metrics.</p>
        </div>
        <div className="header-actions">
          <button className="icon-button" title="Refresh user analytics" onClick={loadUsers}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
          <span className={`status ${!data && !loading ? 'status-stale' : ''}`}>
            <i />{data ? 'Live data' : loading ? 'Connecting…' : 'No data'}
          </span>
        </div>
      </header>

      <section className="toolbar">
        <div className="range-tabs" role="tablist" aria-label="Time range">
          {([['daily', 'Today'], ['weekly', 'This week'], ['monthly', 'This month'], ['all', 'All time']] as const).map(([key, label]) => (
            <button key={key} className={range === key ? 'selected' : ''} onClick={() => setRange(key)}>
              {label}
            </button>
          ))}
        </div>
        <span className="updated">
          {data?.meta?.generatedAt
            ? `Updated ${new Date(data.meta.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : loading ? 'Loading…' : '—'}
        </span>
      </section>

      <section className="kpi-grid">
        {loading ? (
          <>
            <div className="kpi skeleton"><div className="skel-line skel-sm" /><div className="skel-line skel-lg" /><div className="skel-line skel-xs" /></div>
            <div className="kpi skeleton"><div className="skel-line skel-sm" /><div className="skel-line skel-lg" /><div className="skel-line skel-xs" /></div>
            <div className="kpi skeleton"><div className="skel-line skel-sm" /><div className="skel-line skel-lg" /><div className="skel-line skel-xs" /></div>
            <div className="kpi skeleton"><div className="skel-line skel-sm" /><div className="skel-line skel-lg" /><div className="skel-line skel-xs" /></div>
          </>
        ) : (
          <>
            <Kpi
              label="Signups"
              value={userMetric(groups, 'signups', range)}
              change={userGrowth(groups, 'signups', range)}
              icon={<Users />}
            />
            <Kpi
              label="Wallets created"
              value={userMetric(groups, 'walletsCreated', range)}
              change={userGrowth(groups, 'walletsCreated', range)}
              icon={<Wallet />}
            />
            <Kpi
              label="KYC verified"
              value={userMetric(groups, 'kycVerified', range)}
              change={userGrowth(groups, 'kycVerified', range)}
              icon={<ShieldCheck />}
            />
            <Kpi
              label="Transacting users"
              value={userMetric(groups, 'activeUsers', range)}
              change={userGrowth(groups, 'activeUsers', range)}
              icon={<Activity />}
            />
          </>
        )}
      </section>

      <div className="dashboard-grid">
        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">USER FLOWS</p>
              <h2>Growth by period</h2>
            </div>
            <span className="select-label">
              {data?.meta?.timezone || '—'}
              <ChevronDown size={14} />
            </span>
          </div>
          {loading ? (
            <div className="bars">
              {[1, 2, 3, 4].map(i => (
                <div className="bar-row skeleton" key={i}>
                  <span className="skel-line" style={{ width: '60%' }} />
                  <div className="bar-track"><i style={{ width: `${20 + i * 15}%` }} className="skel-bar" /></div>
                  <strong className="skel-line" style={{ width: '50%' }} />
                </div>
              ))}
            </div>
          ) : groups.length > 0 ? (
            <div className="bars">
              {groups.map(group => {
                const p =
                  group.periods?.find(x => x.period === range) ||
                  group.periods?.find(x => x.period === 'allTime');
                const current = p?.count?.current || 0;
                const maxCount = Math.max(1, ...groups.map(g => {
                  const gp = g.periods?.find(x => x.period === range) || g.periods?.find(x => x.period === 'allTime');
                  return gp?.count?.current || 0;
                }));
                return (
                  <div className="bar-row" key={group.key}>
                    <span>{group.label}</span>
                    <div className="bar-track">
                      <i style={{ width: `${Math.min(100, (current / maxCount) * 100)}%` }} />
                    </div>
                    <strong>{num(current)}</strong>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="panel-empty">
              <Users size={24} />
              <p>No user data available yet.</p>
            </div>
          )}
          <div className="chart-foot">
            <span>Period flows (events within window)</span>
          </div>
        </section>

        <section className="panel provider-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">CUMULATIVE STOCK</p>
              <h2>Total headcounts</h2>
            </div>
          </div>
          {loading ? (
            <div className="provider-list">
              {[1, 2, 3, 4].map(i => (
                <div className="provider-row skeleton" key={i}>
                  <div className="provider-icon skel-circle" />
                  <div className="provider-name"><div className="skel-line" style={{ width: '70%' }} /><div className="skel-line skel-xs" style={{ width: '40%', marginTop: 4 }} /></div>
                  <strong className="skel-line" style={{ width: '50px' }} />
                </div>
              ))}
            </div>
          ) : stock ? (
            <div className="provider-list">
              <StockRow label="Total users" value={stock.totalUsers} />
              <StockRow label="Wallet users" value={stock.walletUsers} />
              <StockRow label="KYC verified (current)" value={stock.kycVerifiedNow} />
              <StockRow label="KYC verified (ever)" value={stock.kycEverVerified} />
              <StockRow label="With active guardian" value={stock.usersWithActiveGuardian} />
              <StockRow label="Without active guardian" value={stock.usersWithoutActiveGuardian} />
              <StockRow
                label="Guardian coverage"
                value={stock.walletUsersWithGuardianShare != null ? `${stock.walletUsersWithGuardianShare}%` : '—'}
                isText
              />
            </div>
          ) : (
            <div className="panel-empty">
              <Users size={24} />
              <p>No stock data available yet.</p>
            </div>
          )}
        </section>
      </div>

      {groups.length > 0 && (
        <section className="panel search-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">DETAILS</p>
              <h2>All user metrics</h2>
            </div>
          </div>
          <div className="user-metrics-table">
            <div className="metrics-table-head">
              <span className="metric-col-label">Metric</span>
              {(['daily', 'weekly', 'monthly', 'all'] as const).map(p => (
                <span key={p} className="metric-col-value">
                  {p === 'daily' ? 'Today' : p === 'weekly' ? 'This week' : p === 'monthly' ? 'This month' : 'All time'}
                </span>
              ))}
            </div>
            {groups.map(group => (
              <div className="metrics-table-row" key={group.key}>
                <span className="metric-col-label">
                  <strong>{group.label}</strong>
                  {group.definition && <span className="metric-def">{group.definition}</span>}
                </span>
                {(['daily', 'weekly', 'monthly', 'all'] as const).map(p => {
                  const period = group.periods?.find(x => x.period === p);
                  const count = period?.count;
                  return (
                    <span key={p} className="metric-col-value">
                      <strong>{count ? num(count.current) : '—'}</strong>
                      {count && count.percentageChange != null && (
                        <span className={`change ${count.direction}`}>
                          {count.percentageChange >= 0 ? '+' : ''}{Number(count.percentageChange).toFixed(1)}%
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function StockRow({ label, value, isText }: { label: string; value: number | string; isText?: boolean }) {
  return (
    <div className="provider-row">
      <div className="provider-name">
        <strong>{label}</strong>
      </div>
      <strong>{isText ? value : num(value)}</strong>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared presentational components                                    */
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
        <div className={`change ${change.direction || 'flat'}`}>
          {change.percentageChange == null
            ? change.isNew ? 'New activity' : 'No comparison'
            : `${change.percentageChange >= 0 ? '+' : ''}${Number(change.percentageChange).toFixed(1)}%`}
          <span> vs previous</span>
        </div>
      )}
    </div>
  );
}

function TransactionMatchCard({ match, index }: { match: api.TransactionMatch; index: number }) {
  return (
    <div className="match-card">
      <div className="match-card-head">
        <span className="match-index">#{index + 1}</span>
        <span className="match-source">{match.source}</span>
        {match.reference && <span className="match-id">{match.reference}</span>}
        <span className={`match-status status-${match.status?.toLowerCase()}`}>{match.status}</span>
      </div>
      <div className="match-fields">
        {match.customer && (
          <div className="match-section">
            <dt>Customer</dt>
            <dd>
              {match.customer.fullName || '—'}
              {match.customer.phone && <span className="match-sub">{match.customer.phone}</span>}
              {match.customer.email && <span className="match-sub">{match.customer.email}</span>}
            </dd>
          </div>
        )}
        <div className="match-field">
          <dt>Category</dt>
          <dd>{match.category?.replaceAll('_', ' ')}</dd>
        </div>
        <div className="match-field">
          <dt>Matched on</dt>
          <dd>{match.matchedOn}</dd>
        </div>
        {match.createdAt && (
          <div className="match-field">
            <dt>Created</dt>
            <dd>{new Date(match.createdAt).toLocaleString()}</dd>
          </div>
        )}
        {match.settledAt && (
          <div className="match-field">
            <dt>Settled</dt>
            <dd>{new Date(match.settledAt).toLocaleString()}</dd>
          </div>
        )}
      </div>
    </div>
  );
}
