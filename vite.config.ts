import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

function safeHmrClientTransportPlugin(): Plugin {
  let hmrDisabled = false;

  return {
    name: 'safe-hmr-client-transport',
    apply: 'serve',
    enforce: 'post',
    configResolved(config) {
      hmrDisabled =
        config.server.hmr === false ||
        config.server.ws === false ||
        process.env.DISABLE_HMR === 'true';
    },
    transform(code, id) {
      if (!id.includes('vite/dist/client/client.mjs')) {
        return null;
      }

      if (hmrDisabled) {
        let patched = code.replace('console.debug("[vite] connecting...");', '');

        const wsStart = patched.indexOf('const createWebSocketModuleRunnerTransport =');
        const wsEnd = patched.indexOf('function createHMRHandler(');
        if (wsStart !== -1 && wsEnd !== -1 && wsEnd > wsStart) {
          patched =
            patched.slice(0, wsStart) +
            'const createWebSocketModuleRunnerTransport = () => ({ async connect() {}, disconnect() {}, send() {} });\n\n' +
            patched.slice(wsEnd);
        }

        const transportStart = patched.indexOf('const transport = normalizeModuleRunnerTransport(');
        const transportEnd = patched.indexOf('let willUnload = false;');
        if (transportStart !== -1 && transportEnd !== -1 && transportEnd > transportStart) {
          patched =
            patched.slice(0, transportStart) +
            'const transport = normalizeModuleRunnerTransport(createWebSocketModuleRunnerTransport());\n' +
            patched.slice(transportEnd);
        }

        return {code: patched, map: null};
      }

      const guarded = code.replace(
        'transport.connect(createHMRHandler(handleMessage));',
        'transport.connect(createHMRHandler(handleMessage)).catch(() => {});',
      );
      return {code: guarded, map: null};
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      safeHmrClientTransportPlugin(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'icon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
        ],
        manifest: {
          id: '/',
          name: '바이브 행사',
          short_name: '바이브 행사',
          description: 'VS Code 스타일 고밀도 행사 준비 공정 캘린더 워크스페이스',
          theme_color: '#0c0e14',
          background_color: '#0c0e14',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          lang: 'ko',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          navigateFallbackDenylist: [/^\/api\//, /^\/@vite\//, /^\/@react-refresh/, /^\/src\//],
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'jsdelivr-fonts-cache',
                expiration: {
                  maxEntries: 30,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
