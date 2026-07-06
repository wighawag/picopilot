import {base} from '$app/paths';

/**
 * One showcased game. `slug` is the folder under `static/games/<slug>/` that a
 * human populated by running `picopilot export <cart> ./website/static/games/<slug>/`
 * (see the repo's export command / ADR-0013). The player loads that folder's
 * PICO-8 export.
 */
export interface Game {
	/** URL-safe id; also the `static/games/<slug>/` folder name. */
	readonly slug: string;
	/** Human-readable title shown on the card and player page. */
	readonly title: string;
	/** One-line description for the showcase card. */
	readonly blurb: string;
	/** Optional author/credit line. */
	readonly author?: string;
	/**
	 * Which export shape this slug's folder holds:
	 *  - 'standalone': an `index.html` + `index.js` pair (the default export).
	 *  - 'payload': just `index.js` (a `--payload-only` export); the player
	 *    provides its own shell.
	 * Defaults to 'standalone'.
	 */
	readonly shape?: 'standalone' | 'payload';
}

/**
 * The showcase. Add an entry here after exporting a cart into
 * `static/games/<slug>/`. This is the manual selection ADR-0013 describes: no CI
 * export step, a human curates the list.
 */
export const games: readonly Game[] = [
	{
		slug: 'fliprun',
		title: 'FLIPRUN',
		blurb:
			'A one-button gravity-flip runner. Flip between floor and ceiling to dodge spikes and grab orbs. Built in a 50-minute PICO-8 game-jam session with picopilot.',
		author: 'picopilot game-jam',
		shape: 'standalone',
	},
];

/** Look up a single game by slug (for the player route). */
export function findGame(slug: string): Game | undefined {
	return games.find((g) => g.slug === slug);
}

/** The public URL of a game's export folder, respecting the site base path. */
export function gameDir(slug: string): string {
	return `${base}/games/${slug}`;
}
