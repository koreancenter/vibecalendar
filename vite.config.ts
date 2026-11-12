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
          'sw-background-engine.js',
        ],
        manifest: {
          id: '/',
          name: '바이브 캘린더 Vibe Calendar',
          short_name: 'Vibe Calendar',
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
          importScripts: ['/sw-background-engine.js'],
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          globIgnores: [
            '**/sw-background-engine.js',
            '**/vendor-webllm*.js',
            '**/jspdf*.js',
          ],
          navigateFallbackDenylist: [
            /^\/api\//,
            /^\/@vite\//,
            /^\/@react-refresh/,
            /^\/src\//,
            /^\/sw-background-engine\.js$/,
          ],
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
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
          type: 'classic',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('@mlc-ai/web-llm')) {
                return 'vendor-webllm';
              }
              if (id.includes('react') || id.includes('react-dom')) {
                return 'vendor-react';
              }
              if (id.includes('yjs') || id.includes('y-protocols') || id.includes('lib0')) {
                return 'vendor-yjs';
              }
              if (id.includes('lucide-react')) {
                return 'vendor-icons';
              }
              if (id.includes('fast-xml-parser')) {
                return 'vendor-xml';
              }
            }
          },
        },
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
