import adapter from '@sveltejs/adapter-static';
import {vitePreprocess} from '@sveltejs/vite-plugin-svelte';

// GitHub Pages serves a project site under /<repo>/. Set BASE_PATH to that
// subpath in CI (e.g. `/picopilot`); locally it defaults to '' (served at root).
const BASE_PATH = process.env.BASE_PATH ?? '';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// A fully static site: prerender everything to plain files for GitHub Pages.
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: undefined,
			precompress: false,
			strict: true,
		}),
		paths: {
			base: BASE_PATH,
		},
		prerender: {
			// The showcase can legitimately be empty: the dynamic /showcase/[slug]
			// route then generates zero pages. Don't fail the build over it.
			handleUnseenRoutes: 'ignore',
		},
	},
};

export default config;
