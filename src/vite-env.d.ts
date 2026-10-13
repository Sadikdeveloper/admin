/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin. An empty string means "same origin" (let the proxy handle it). */
  readonly VITE_API_BASE_URL?: string;
  /** Where readers see the blog; used for "view live" and "copy link" actions. */
  readonly VITE_PUBLIC_SITE_URL?: string;
  /** Dev-server only: the backend address Vite proxies API paths to. */
  readonly VITE_DEV_API_PROXY?: string;
  /** Dev-server only: comma-separated paths to proxy (default "/admin"). */
  readonly VITE_DEV_PROXY_PATHS?: string;
  /** Dev only: install a fake injected wallet so sign-in works headlessly. */
  readonly VITE_MOCK_WALLET?: string;
  /** Dev only: address the mock wallet reports. */
  readonly VITE_MOCK_WALLET_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
