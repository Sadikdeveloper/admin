import type { BrowserWallet } from '../types';
import {
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  Info,
  KeyRound,
  PlugZap,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Smartphone,
  Wallet,
  X,
} from 'lucide-react';

function mobileWalletLinks() {
  const pageUrl = window.location.href;
  // MetaMask expects the dapp URL without its protocol, while Coinbase and
  // Trust accept the complete encoded URL.
  const dappPath = `${window.location.host}${window.location.pathname}${window.location.search}${window.location.hash}`;
  return [
    { name: 'MetaMask', href: `https://metamask.app.link/dapp/${dappPath}` },
    { name: 'Coinbase Wallet', href: `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(pageUrl)}` },
    { name: 'Trust Wallet', href: `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(pageUrl)}` },
  ];
}

export function SignInPage({
  error,
  setError,
  notice,
  setNotice,
  restoring,
  wallets,
  busyWalletId,
  scanning,
  isMobileDevice,
  rescanWallets,
  connectWithWallet,
}: {
  error: string;
  setError: (v: string) => void;
  notice: string;
  setNotice: (v: string) => void;
  restoring: boolean;
  wallets: BrowserWallet[];
  busyWalletId: string | null;
  scanning: boolean;
  isMobileDevice: boolean;
  rescanWallets: () => void;
  connectWithWallet: (w: BrowserWallet) => void;
}) {
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
                          <span>{isMobileDevice ? 'Mobile wallet' : 'Browser extension'}</span>
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
            ) : isMobileDevice ? (
              <div className="wallet-empty mobile-wallet-empty">
                <div className="empty-icon"><Smartphone size={22} /></div>
                <h3>Open in your wallet</h3>
                <p>
                  Mobile browsers cannot see which wallet apps are installed. Open this secure sign-in page inside your
                  wallet's browser, then connect and approve the signature.
                </p>
                <div className="mobile-wallet-links" aria-label="Open this page in a mobile wallet">
                  {mobileWalletLinks().map(wallet => (
                    <a className="mobile-wallet-link" href={wallet.href} key={wallet.name}>
                      <span className="wallet-avatar"><Wallet size={16} /></span>
                      <span>{wallet.name}</span>
                      <ExternalLink size={15} />
                    </a>
                  ))}
                </div>
                <button type="button" className="rescan-link" onClick={rescanWallets} disabled={scanning}>
                  <RefreshCw size={14} className={scanning ? 'spin' : ''} />
                  {scanning ? 'Checking for a wallet…' : 'I am already in my wallet — check again'}
                </button>
                <p className="empty-tip">
                  Already opened here from a wallet app? Unlock the wallet first, then check again.
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
