import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // '.' resolves to the Vite root, avoiding a dependency on @types/node.
  const env = loadEnv(mode, '.', '');
  // When VITE_DEV_API_PROXY is set, the browser talks to the dev server on a
  // relative path and Vite forwards API paths to the backend. This keeps the app
  // working behind remote previews, where the browser can't see localhost.
  const proxyTarget = env.VITE_DEV_API_PROXY;
  const proxyPaths = (env.VITE_DEV_PROXY_PATHS || '/admin')
    .split(',')
    .map((path) => path.trim())
    .filter(Boolean);

  return {
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      allowedHosts: true,
      proxy: proxyTarget
        ? Object.fromEntries(proxyPaths.map((path) => [path, { target: proxyTarget, changeOrigin: true }]))
        : undefined,
    },
    preview: { host: true, port: 5173 },
  };
});
