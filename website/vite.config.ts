import tailwindcss from '@tailwindcss/vite';
import {sveltekit} from '@sveltejs/kit/vite';
import {defineConfig} from 'vite';

// The site's absolute public URL (no trailing slash), for link-preview meta tags,
// which need absolute URLs. CI passes the Pages URL; the fallback is production.
const SITE_URL = (
	process.env.SITE_URL || 'https://wighawag.github.io/picopilot'
).replace(/\/+$/, '');

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	define: {
		__SITE_URL__: JSON.stringify(SITE_URL),
	},
	build: {
		emptyOutDir: true,
	},
	server: {
		host: '0.0.0.0',
		allowedHosts: true,
	},
});
