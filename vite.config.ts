import { defineConfig } from 'vite';

// GitHub Pages serves project sites from /<repo-name>/, so built asset URLs
// need that prefix in production. The dev server still runs at the root.
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/right-of-way/' : '/',
});
