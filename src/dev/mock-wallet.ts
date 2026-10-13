/**
 * Development-only stand-in for a browser wallet.
 *
 * Signing in to the console needs an EIP-1193 provider to answer the
 * `personal_sign` challenge, which makes the app hard to exercise locally
 * without a wallet extension installed. With `VITE_MOCK_WALLET=1` (dev builds
 * only) this installs an injected provider that returns one fixed address and
 * signs anything.
 *
 * It never overrides a real wallet, and `main.tsx` imports it behind
 * `import.meta.env.DEV`, so production bundles do not contain it. Pair it with
 * `mock/blog-api.mjs` to run the whole console offline.
 */

const DEFAULT_ADDRESS = '0x1111111111111111111111111111111111111111';

export function installMockWallet(): void {
  const target = window as unknown as { ethereum?: unknown };
  if (target.ethereum) return; // a real extension always wins

  const address = import.meta.env.VITE_MOCK_WALLET_ADDRESS || DEFAULT_ADDRESS;

  target.ethereum = {
    isMetaMask: true,
    isRownMockWallet: true,
    request: async ({ method }: { method: string; params?: unknown[] }) => {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return [address];
        case 'eth_chainId':
          return '0x1';
        case 'personal_sign':
          /* The backend only checks that a signature string came back. */
          return `0x${'ab'.repeat(65)}`;
        default:
          throw new Error(`The mock wallet cannot handle ${method}`);
      }
    },
  };

  window.dispatchEvent(new Event('ethereum#initialized'));
}
