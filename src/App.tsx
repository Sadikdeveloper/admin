import { Component, useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  Activity,
  ArrowDownLeft,
  BarChart3,
  CircleAlert,
  Copy,
  LogOut,
  PlugZap,
  RefreshCw,
  Users,
  Wallet,
} from 'lucide-react';
import * as api from './api';
import { DEFAULT_PERIOD, shortAddress } from './lib/format';
import { PAGES } from './types';
import type { BrowserWallet, Page } from './types';
import { Banner } from './components/ui';
import { SignInPage } from './pages/SignInPage';
import { OverviewPage } from './pages/OverviewPage';
import { MoneyAnalyticsPage } from './pages/MoneyAnalyticsPage';
import type { MoneyAnalytics } from './pages/MoneyAnalyticsPage';
import { ProvidersPage } from './pages/ProvidersPage';
import { UsersPage } from './pages/UsersPage';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function toHex(str: string): string {
  return '0x' + Array.from(new TextEncoder().encode(str)).map(b => b.toString(16).padStart(2, '0')).join('');
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
    return "Your wallet didn't return a signature. Please try again and make sure to approve the request when prompted.";
  }
  if (e instanceof Error && msg.length < 160 && !/\{|\[|stack|trace/i.test(msg)) {
    return msg;
  }
  return 'Something went wrong while connecting your wallet. Please try again — if it keeps happening, let the team know.';
}

function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
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

const NAV: { page: Page; label: string; icon: ReactNode }[] = [
  { page: 'overview', label: 'Overview', icon: <BarChart3 size={17} /> },
  { page: 'transactions', label: 'Transactions', icon: <Activity size={17} /> },
  { page: 'deposits', label: 'Deposits', icon: <ArrowDownLeft size={17} /> },
  { page: 'topups', label: 'Top-ups', icon: <Wallet size={17} /> },
  { page: 'providers', label: 'Providers', icon: <PlugZap size={17} /> },
  { page: 'users', label: 'Users', icon: <Users size={17} /> },
];

function pageFromHash(): Page {
  const hash = window.location.hash.replace('#/', '').replace('#', '') as Page;
  return PAGES.includes(hash) ? hash : 'overview';
}

/* ------------------------------------------------------------------ */
/* Error boundary                                                      */
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

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

export default function App() {
  const [admin, setAdmin] = useState<api.Admin | null>(null);
  const [restoring, setRestoring] = useState(() => Boolean(api.session.access));
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [wallets, setWallets] = useState<BrowserWallet[]>([]);
  const [busyWalletId, setBusyWalletId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const [activePage, setActivePage] = useState<Page>(() => pageFromHash());

  /* One range control per page keeps each view's context when switching tabs. */
  const [range, setRange] = useState<Record<Page, string>>({
    overview: DEFAULT_PERIOD,
    transactions: DEFAULT_PERIOD,
    deposits: DEFAULT_PERIOD,
    topups: DEFAULT_PERIOD,
    providers: DEFAULT_PERIOD,
    users: DEFAULT_PERIOD,
  });

  const [overview, setOverview] = useState<api.Overview | null>(null);
  const [txData, setTxData] = useState<api.TransactionAnalytics | null>(null);
  const [depositData, setDepositData] = useState<api.DepositAnalytics | null>(null);
  const [topupData, setTopupData] = useState<api.TopupAnalytics | null>(null);
  const [providerData, setProviderData] = useState<api.ProviderAnalytics | null>(null);
  const [userData, setUserData] = useState<api.UserAnalytics | null>(null);

  const [busy, setBusy] = useState<Record<Page, boolean>>({
    overview: false,
    transactions: false,
    deposits: false,
    topups: false,
    providers: false,
    users: false,
  });

  /* Search state, shared between the overview and transactions pages. */
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<api.SearchResult | null>(null);
  const [searching, setSearching] = useState(false);

  const [txQuery, setTxQuery] = useState('');
  const [txResult, setTxResult] = useState<api.SearchResult | null>(null);
  const [txSearching, setTxSearching] = useState(false);

  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setNoticeWithTimer = useCallback((msg: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(msg);
    noticeTimer.current = setTimeout(() => setNotice(''), 3200);
  }, []);

  const setPageRange = useCallback((page: Page, value: string) => {
    setRange(current => ({ ...current, [page]: value }));
  }, []);

  const setPageBusy = useCallback((page: Page, value: boolean) => {
    setBusy(current => ({ ...current, [page]: value }));
  }, []);

  /* ---- Wallet discovery ---- */

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
        typeof provider.name === 'string' && provider.name && provider.name !== 'EIP-1193'
          ? provider.name
          : isMetaMask
            ? 'MetaMask'
            : Array.isArray(eth.providers)
              ? `Browser wallet ${i + 1}`
              : 'Browser wallet';
      addWallet({ id: rdns ?? `injected-${i}`, rdns, name, provider, source: 'injected' });
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

  /* ---- Data loading ---- */

  const load = useCallback(
    async <T,>(page: Page, fetcher: () => Promise<T>, apply: (data: T) => void, what: string) => {
      setPageBusy(page, true);
      setError('');
      try {
        apply(await fetcher());
      } catch (e) {
        setError(e instanceof Error ? e.message : `We couldn't load ${what}. Please try again in a moment.`);
      } finally {
        setPageBusy(page, false);
      }
    },
    [setPageBusy],
  );

  const loadOverview = useCallback(
    () => load('overview', () => api.getOverview(), setOverview, 'the latest analytics'),
    [load],
  );
  const loadTransactions = useCallback(
    () => load('transactions', () => api.getTransactions(), setTxData, 'transaction analytics'),
    [load],
  );
  const loadDeposits = useCallback(
    () => load('deposits', () => api.getDeposits(), setDepositData, 'deposit analytics'),
    [load],
  );
  const loadTopups = useCallback(
    () => load('topups', () => api.getTopups(), setTopupData, 'top-up analytics'),
    [load],
  );
  const loadProviders = useCallback(
    () => load('providers', () => api.getProviders(), setProviderData, 'provider analytics'),
    [load],
  );
  const loadUsers = useCallback(() => load('users', () => api.getUsers(), setUserData, 'user analytics'), [load]);

  /** Fetches a page's data the first time it is opened. */
  const ensureLoaded = useCallback(
    (page: Page) => {
      if (page === 'overview' && !overview) void loadOverview();
      if (page === 'transactions' && !txData) void loadTransactions();
      if (page === 'deposits' && !depositData) void loadDeposits();
      if (page === 'topups' && !topupData) void loadTopups();
      if (page === 'providers' && !providerData) void loadProviders();
      if (page === 'users' && !userData) void loadUsers();
    },
    [
      overview, txData, depositData, topupData, providerData, userData,
      loadOverview, loadTransactions, loadDeposits, loadTopups, loadProviders, loadUsers,
    ],
  );

  /* ---- Session restore ---- */

  useEffect(() => {
    if (!api.session.access) return;
    let alive = true;
    setRestoring(true);
    api
      .getMe()
      .then(r => {
        if (!alive) return;
        if (!r?.data?.address) throw new Error('invalid profile');
        setAdmin(r.data);
        setRestoring(false);
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
  }, []);

  /* Load whatever page is active once we have a session. */
  useEffect(() => {
    if (!admin) return;
    ensureLoaded(activePage);
  }, [admin, activePage, ensureLoaded]);

  /* Keep the URL hash in sync so pages are linkable and the back button works. */
  useEffect(() => {
    if (!admin) return;
    const onHashChange = () => setActivePage(pageFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [admin]);

  function navigateTo(page: Page) {
    setActivePage(page);
    setError('');
    setNotice('');
    if (window.location.hash !== `#/${page}`) window.location.hash = `#/${page}`;
  }

  /* ---- Search ---- */

  async function runSearch(
    value: string,
    setBusyFlag: (v: boolean) => void,
    apply: (r: api.SearchResult | null) => void,
  ) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setBusyFlag(true);
    setError('');
    try {
      // A full Rown reference has a dedicated endpoint that returns the
      // complete record, so prefer it over the fuzzy search.
      const isReference = /^RWN-\d{8}-[a-z0-9]+$/i.test(trimmed);
      apply(isReference ? await api.getTransactionByReference(trimmed) : await api.searchTransactions(trimmed));
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't complete your search. Please try again in a moment.");
      apply(null);
    } finally {
      setBusyFlag(false);
    }
  }

  function doSearch(event: FormEvent) {
    event.preventDefault();
    void runSearch(query, setSearching, setResult);
  }

  function doTxSearch(event: FormEvent) {
    event.preventDefault();
    void runSearch(txQuery, setTxSearching, setTxResult);
  }

  /* ---- Auth ---- */

  async function connectWithWallet(wallet: BrowserWallet) {
    setError('');
    setBusyWalletId(wallet.id);
    try {
      const accounts = (await wallet.provider.request({ method: 'eth_requestAccounts' })) as string[];
      if (!accounts?.length) {
        setError(
          `No accounts were found in ${wallet.name}. Please unlock your wallet and make sure an account is selected, then try connecting again.`,
        );
        return;
      }

      const address = accounts[0];
      const challenge = await api.getNonce(address);
      const message = challenge?.data?.message;
      if (!message) throw new Error('The server did not send a sign-in message. Please try connecting again.');

      const signature = (await wallet.provider.request({
        method: 'personal_sign',
        params: [toHex(message), address],
      })) as string;
      if (!signature) {
        throw new Error("Your wallet didn't return a signature. Please try again and approve the request when it appears.");
      }

      const identity = await api.verify(message, signature);
      if (!identity?.admin?.address) {
        throw new Error('Sign-in succeeded but we could not load your operator profile. Please try connecting again.');
      }
      setAdmin(identity.admin);
      setNotice('');
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
      setTxData(null);
      setDepositData(null);
      setTopupData(null);
      setProviderData(null);
      setUserData(null);
      setResult(null);
      setTxResult(null);
      setQuery('');
      setTxQuery('');
      setError('');
      setNotice('');
      setActivePage('overview');
    }
  }

  async function handleCopyAddress(address: string) {
    await copyToClipboard(address);
    setNoticeWithTimer('Address copied to clipboard');
  }

  /* ---- Render ---- */

  if (!admin) {
    return (
      <SignInPage
        error={error}
        setError={setError}
        notice={notice}
        setNotice={setNotice}
        restoring={restoring}
        wallets={wallets}
        busyWalletId={busyWalletId}
        scanning={scanning}
        rescanWallets={rescanWallets}
        connectWithWallet={connectWithWallet}
      />
    );
  }

  const moneyPages: Record<'transactions' | 'deposits' | 'topups', { data: MoneyAnalytics | null; load: () => void }> = {
    transactions: { data: txData, load: loadTransactions },
    deposits: { data: depositData, load: loadDeposits },
    topups: { data: topupData, load: loadTopups },
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
          {NAV.map(item => (
            <button
              key={item.page}
              type="button"
              className={activePage === item.page ? 'active' : ''}
              aria-current={activePage === item.page ? 'page' : undefined}
              onClick={() => navigateTo(item.page)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
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
          <button className="signout-btn" onClick={signOut} aria-label="Sign out">
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>

      <main className="content">
        {notice && <Banner tone="info" message={notice} onDismiss={() => setNotice('')} />}
        {error && <Banner tone="error" message={error} onDismiss={() => setError('')} />}

        {activePage === 'overview' && (
          <OverviewPage
            overview={overview}
            loading={busy.overview}
            range={range.overview}
            setRange={r => setPageRange('overview', r)}
            onRefresh={loadOverview}
            onNavigate={navigateTo}
            search={{
              query,
              setQuery,
              onSubmit: doSearch,
              onClear: () => {
                setQuery('');
                setResult(null);
              },
              loading: searching,
              result,
            }}
          />
        )}

        {activePage === 'transactions' && (
          <MoneyAnalyticsPage
            data={moneyPages.transactions.data}
            loading={busy.transactions}
            range={range.transactions}
            setRange={r => setPageRange('transactions', r)}
            onRefresh={moneyPages.transactions.load}
            eyebrow="OPERATIONS / TRANSACTIONS"
            title="Transaction analytics"
            subtitle="Value, volume and category breakdown across the Rown network."
            valueLabel="Total value (USD)"
            volumeLabel="Transaction volume"
            search={{
              query: txQuery,
              setQuery: setTxQuery,
              onSubmit: doTxSearch,
              onClear: () => {
                setTxQuery('');
                setTxResult(null);
              },
              loading: txSearching,
              result: txResult,
            }}
          />
        )}

        {activePage === 'deposits' && (
          <MoneyAnalyticsPage
            data={moneyPages.deposits.data}
            loading={busy.deposits}
            range={range.deposits}
            setRange={r => setPageRange('deposits', r)}
            onRefresh={moneyPages.deposits.load}
            eyebrow="OPERATIONS / DEPOSITS"
            title="Deposit analytics"
            subtitle="Money entering the network, by channel and provider."
            valueLabel="Deposit value (USD)"
            volumeLabel="Deposit count"
          />
        )}

        {activePage === 'topups' && (
          <MoneyAnalyticsPage
            data={moneyPages.topups.data}
            loading={busy.topups}
            range={range.topups}
            setRange={r => setPageRange('topups', r)}
            onRefresh={moneyPages.topups.load}
            eyebrow="OPERATIONS / TOP-UPS"
            title="Top-up analytics"
            subtitle="Airtime, data and bill top-ups purchased through Rown."
            valueLabel="Top-up value (USD)"
            volumeLabel="Top-up count"
          />
        )}

        {activePage === 'providers' && (
          <ProvidersPage
            data={providerData}
            loading={busy.providers}
            range={range.providers}
            setRange={r => setPageRange('providers', r)}
            onRefresh={loadProviders}
          />
        )}

        {activePage === 'users' && (
          <UsersPage
            data={userData}
            loading={busy.users}
            range={range.users}
            setRange={r => setPageRange('users', r)}
            onRefresh={loadUsers}
          />
        )}
      </main>
    </div>
  );
}
