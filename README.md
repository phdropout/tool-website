# Papers & Pixels

Browser-based utilities for images, PDFs, timers, and local media. File processing happens in the browser.

## Local development

Use Node.js 24 (the project requires at least 22.13).

```sh
npm ci
npm run dev -- --background
```

Manage the server with `npm run astro -- dev status`, `npm run astro -- dev logs`, and `npm run astro -- dev stop`.

```sh
node --test tests/*.test.mjs
npm run build
node scripts/check-built-site.mjs
npm run preview
```

`predev` and `prebuild` copy PDF.js resources from the installed dependency into `public/pdfjs/`. These generated resources and `dist/` are ignored by Git; do not upload them manually.

## Publish on GitHub Pages

The configured Git remote is `https://github.com/phdropout/tool-website.git`. The workflow in `.github/workflows/deploy.yml` publishes pushes to `main`, or can be run manually from the Actions tab.

1. Open the repository on GitHub. Under **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source. GitHub Free requires a public repository for Pages.
2. Review and commit the project changes, including `.github/workflows/deploy.yml`, `package-lock.json`, and the new path helper and build-check script. Push to `main`.
3. Open **Actions → Deploy to GitHub Pages** and wait for both jobs to finish. If the workflow is already on GitHub, use **Run workflow** after enabling Pages.
4. Open the published URL shown in the deployment. With the default project-site URL this is `https://phdropout.github.io/tool-website/`. If the account's main Pages site has a custom domain, the project may inherit that domain; use the URL GitHub reports.
5. Check navigation, image tools, PDF previews and exports, the media viewer, About, and Privacy. Use only files you deliberately select for testing.

The workflow reads the configured Pages origin and base path automatically, installs dependencies with `npm ci`, runs tests, builds, validates internal links/assets and PDF resource paths, and deploys `dist/`. It uses the built-in GitHub token; no personal token or manually configured secrets are required. Your other repository's site is independent of this deployment.

### Reproduce the project-site build locally

```sh
ASTRO_SITE=https://phdropout.github.io ASTRO_BASE=/tool-website npm run build
ASTRO_BASE=/tool-website node scripts/check-built-site.mjs
ASTRO_SITE=https://phdropout.github.io ASTRO_BASE=/tool-website npm run preview
```

Visit the preview URL with `/tool-website/` appended. Without these environment variables, local development uses `/`.

### Custom domains and future hosting

For a custom domain, configure the domain and DNS through GitHub Pages settings first. The workflow reads the new URL automatically. Other static hosts can build with `npm run build`, publish `dist`, and set `ASTRO_SITE` and `ASTRO_BASE` as appropriate (the base defaults to `/`).

GitHub Pages limits commercial hosting; check its suitability before using this as an advertising-funded business: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits

Deployment references:
- https://docs.astro.build/en/guides/deploy/github/
- https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
