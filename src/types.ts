export interface WalletProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

export interface BrowserWallet {
  id: string;
  rdns?: string | null;
  name: string;
  icon?: string;
  source: 'eip6963' | 'injected';
  provider: WalletProvider;
}

export const PAGES = ['overview', 'transactions', 'deposits', 'topups', 'providers', 'users'] as const;
export type Page = (typeof PAGES)[number];
