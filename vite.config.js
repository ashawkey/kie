import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built site works under a GitHub Pages
  // subpath (https://<user>.github.io/<repo>/) as well as any other
  // static host. Dev mode ignores this and serves from '/'.
  base: './',
  server: {
    port: 5173,
    watch: {
      // Skip workspace tooling dirs: locked files in a Chrome profile
      // (.ene/scratch/chrome-profile) crash the watcher on Windows (EBUSY).
      ignored: ['**/.ene/**', '**/.git/**'],
    },
  },
  preview: {
    port: 4173,
  },
  build: {
    // The app is a plain ES-module static site; keep the output close to
    // the source so it stays easy to reason about.
    target: 'es2022',
    assetsInlineLimit: 0,
  },
});
