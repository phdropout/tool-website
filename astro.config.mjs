// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  vite: {
    optimizeDeps: {
      // Prepare dependencies used by lazy-loaded tools before serving pages.
      // Late discovery can otherwise invalidate a module URL already in use.
      include: ['exifreader', '@pdf-lib/upng', 'libheif-js', 'pdf-lib', 'pdfjs-dist'],
    },
  },
});
