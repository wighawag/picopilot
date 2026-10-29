// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	/** Absolute public URL of the site, no trailing slash (see vite.config.ts). */
	const __SITE_URL__: string;
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
