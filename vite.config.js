import { defineConfig } from 'vite';

// Relative asset paths so the built game (dist/) works from any folder or static host (GitHub Pages, itch.io, a zip).
export default defineConfig({ base: './', build: { chunkSizeWarningLimit: 2500 } });
