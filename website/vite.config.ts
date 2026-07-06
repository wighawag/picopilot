import tailwindcss from '@tailwindcss/vite';
import {sveltekit} from '@sveltejs/kit/vite';
import {defineConfig} from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	build: {
		emptyOutDir: true,
	},
	server: {
		host: '0.0.0.0',
		allowedHosts: true,
	},
});
