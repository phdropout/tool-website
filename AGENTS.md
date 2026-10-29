## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## UI conventions

- Use the shared teal accent, soft neutral backgrounds, and simple layouts across the homepage and tools.
- Use `src/components/UsefulDetails.astro` for FAQs: a readable-width section, plain disclosure rows, thin separators, and generous spacing. Avoid individual boxed FAQ cards.
- Keep supporting content similarly lightweight and readable.
- Separate content sections with spacing rather than divider borders, with subtle dividers below the site header and above the footer. Preserve the shared FAQ row separators and useful control outlines. Give dropdown chevrons comfortable inset spacing. Avoid link underlines; use accent colors, hover feedback, and visible keyboard focus instead.
- Keep one continuous neutral page background across sections, with closely related panel tones and subtle borders/shadows. Keep upload areas neutral until a file is dragged over them; reserve stronger teal fills for actions and selections.
- Use the shared theme variables in `src/styles/global.css` for UI colors so new tools support both light and dark mode. Keep PDF pages and exported files in their original colors.
- Keep testing and file access within this project. Do not browse unrelated files or locations, including through desktop automation or native file pickers.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
