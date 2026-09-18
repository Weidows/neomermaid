import { defineConfig } from 'vite';

/**
 * Relative base (`./`) is deliberate: the same build works at
 * `https://weidows.github.io/neomermaid/` (GitHub Pages project site), at
 * `http://localhost:4173/` (vite preview / the smoke test) and from a local
 * file path — no rebuild per host.
 */
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    // mermaid is ~5 MB minified; the warning is noise for this app.
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/mermaid') || id.includes('node_modules/d3-')) return 'mermaid';
          if (id.includes('node_modules/@neomermaid')) return 'neomermaid-core';
          return undefined;
        },
      },
    },
  },
  server: { port: 5173, strictPort: false },
  preview: { port: 4173, strictPort: true },
});
