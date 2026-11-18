import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      manifest: {
        name: 'AI 전환 지원요청',
        short_name: 'AI지원요청',
        description: 'AI 전환 지원요청서 접수·처리·확인 관리',
        start_url: '/',
        display: 'standalone',
        background_color: '#f5f6f8',
        theme_color: '#4f46e5',
        icons: [
          { src: '/icon.svg', sizes: '192x192', type: 'image/svg+xml' },
          { src: '/icon.svg', sizes: '512x512', type: 'image/svg+xml' },
        ],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
  },
});
