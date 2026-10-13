import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App, { ErrorBoundary } from './App';
import { ToastProvider } from './components/Toast';
import './styles.css';
import './styles/blog.css';

/*
 * Development harness: with VITE_MOCK_WALLET=1 a fake injected wallet is
 * installed so the console can sign in against mock/blog-api.mjs without a
 * wallet extension. Guarded by import.meta.env.DEV, so it never ships.
 */
if (import.meta.env.DEV && import.meta.env.VITE_MOCK_WALLET === '1') {
  void import('./dev/mock-wallet')
    .then(({ installMockWallet }) => installMockWallet())
    .catch(() => {});
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);
