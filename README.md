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

## Coloring Studio

The activity page is at `/coloring-studio/`. Add starter PNG files to `public/coloring-pages/`; the gallery picks them up on the next build. Filenames become display titles, with hyphens and underscores replaced by spaces. SVG starters are not included. Personal uploads stay in the browser and are not added to the public gallery.

The first version includes round, pencil, and soft brushes, palettes and custom colors, an eraser, pen pressure, a hand tool, fullscreen, and PNG export. Coloring is kept separate from the original page. Up to 100 actions can be undone; older marks remain in the artwork. Sessions are not saved after leaving or refreshing the page.

## Google Analytics

GA4 measurement ID: `G-S2L3Q2591F`, defined in `src/site.js`.

The shared layout includes an analytics preference prompt in production builds. It runs only on `papersandpixels.net` and `www.papersandpixels.net`; localhost, previews on other domains, and development builds do not send traffic. The Google tag is not loaded until a visitor accepts analytics. Accept/Decline choices are stored for up to 180 days, and visitors can change their choice on the Privacy page. Changing the hosting domain requires updating the host list in `src/scripts/analytics.js`.

Before publishing this integration:

1. In Google Analytics, open **Admin → Data streams → your web stream** and turn **Enhanced measurement OFF**. The integration sends a standard pageview per full page load; it does not intentionally instrument tool fields, local files, downloads, or artwork. Enhanced measurement can automatically collect additional interactions, including form and download metadata, so leave it off unless those events have been reviewed separately.
2. Publish the changes, visit the live website, and accept analytics to test it. Look in **Reports → Realtime** for your visit. A declined choice or an ad blocker can prevent your test visit from appearing. The setup wizard may not detect the tag before consent.
3. Keep Google signals, advertising personalization, user-provided data collection, and cross-product advertising connections disabled unless separately reviewed and disclosed. Configure the property's data retention and account data-sharing options in Google Analytics for your needs.

The tag configuration removes query strings and fragments from page/referrer URLs and disables Google signals and advertising personalization. Campaign parameters in page URLs are intentionally excluded. Analytics reports count consenting, unblocked visitors and will not represent every visit.

`tests/analytics.test.mjs` uses a mocked Google tag and DOM. Tests do not contact Google or send real traffic events.
