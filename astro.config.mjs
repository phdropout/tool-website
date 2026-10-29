// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  // The Pages workflow supplies these from GitHub's configured site URL.
  // Local development and builds on other hosts default to the domain root.
  site: process.env.ASTRO_SITE || undefined,
  base: process.env.ASTRO_BASE || '/',
  trailingSlash: 'always',
  vite: {
    optimizeDeps: {
      // Prepare dependencies used by lazy-loaded tools before serving pages.
      // Late discovery can otherwise invalidate a module URL already in use.
      include: ['exifreader', '@pdf-lib/upng', 'libheif-js', 'pdf-lib', 'pdfjs-dist'],
    },
  },
});
