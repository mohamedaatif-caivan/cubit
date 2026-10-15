import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

// The CI build stamps the commit, so Settings and problem reports say exactly which deploy is running.
declare const process: { env: Record<string, string | undefined> };
const version = `${pkg.version}+${(process.env.GITHUB_SHA ?? 'dev').slice(0, 7)}`;

export default defineConfig({
  // Relative paths so the app works from any GitHub Pages folder (user.github.io/repo/).
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'Cubit',
        short_name: 'Cubit',
        description: 'An exact construction calculator for feet, inches and metres.',
        id: './',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f2f5f9',
        theme_color: '#f2f5f9',
        launch_handler: { client_mode: 'focus-existing' },
        categories: ['productivity', 'utilities'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['**/og.png'],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
