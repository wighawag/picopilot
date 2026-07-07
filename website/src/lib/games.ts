import {base} from '$app/paths';

/**
 * One showcased game. Auto-discovered: each game is a folder
 * `static/games/<themeSlug>/<runtime>/<slug>/` holding its export
 * (`index.html` + `index.js`, optional `label.png`) AND a `meta.json` with the
 * fields below. The site globs those `meta.json`s (no hand-maintained list), so
 * adding a game is dropping one folder. `slug` is the unique id used by the
 * per-game player route; the served folder path is derived from the meta so the
 * URL matches the on-disk `<themeSlug>/<runtime>/<slug>/` layout.
 */
export interface Game {
	/** URL-safe id, unique across the showcase; the leaf folder name. */
	readonly slug: string;
	/** Human-readable title shown on the card and player page. */
	readonly title: string;
	/** One-line description for the showcase card. */
	readonly blurb: string;
	/** Optional author/credit line. */
	readonly author?: string;
	/**
	 * The jam THEME this game was built for (display string, e.g. "one button").
	 * The showcase groups by this first.
	 */
	readonly theme: string;
	/**
	 * The RUN-TIME budget it was built in (display string, e.g. "3 min",
	 * "50 min"). The showcase groups by this second, ordered LONGEST first
	 * (the more substantial games lead).
	 */
	readonly runtime: string;
	/**
	 * Whether this game's folder holds a `label.png` (PICO-8's 128x128 title
	 * card). When true the card shows it as a thumbnail; else the card is
	 * text-only.
	 */
	readonly hasLabel?: boolean;
	/**
	 * Export shape: 'standalone' (`index.html` + `index.js`, the default) or
	 * 'payload' (just `index.js`). Defaults to 'standalone'.
	 */
	readonly shape?: 'standalone' | 'payload';
}

/** A game plus the folder path it lives at (derived from the glob key). */
export interface DiscoveredGame extends Game {
	/** Folder path under static, e.g. "one-button/50min/fliprun" (no leading/trailing slash). */
	readonly dir: string;
}

/** Raw meta.json shape (theme/runtime/slug are also re-derived from the path as a fallback). */
type GameMeta = Omit<Game, never>;

/**
 * Auto-discover every game from its `meta.json`. The glob key is the file's
 * absolute path (`/static/games/<dir>/meta.json`); `dir` is the served folder.
 * We trust the meta's fields for display, and use the folder path only to build
 * the URL, so the served URL always matches the on-disk layout.
 */
const metas = import.meta.glob<{default?: GameMeta} & GameMeta>(
	'/static/games/**/meta.json',
	{eager: true},
);

function discover(): DiscoveredGame[] {
	const out: DiscoveredGame[] = [];
	for (const path in metas) {
		const mod = metas[path];
		const meta = (mod.default ?? mod) as GameMeta;
		// "/static/games/one-button/50min/fliprun/meta.json" -> "one-button/50min/fliprun"
		const dir = path
			.replace(/^\/static\/games\//, '')
			.replace(/\/meta\.json$/, '');
		if (!meta || !meta.slug || !meta.title) continue;
		out.push({...meta, dir});
	}
	// Stable order: theme, then runtime (LONGEST first by parsed minutes), then title.
	return out.sort(
		(a, b) =>
			a.theme.localeCompare(b.theme) ||
			runtimeMinutes(b.runtime) - runtimeMinutes(a.runtime) ||
			a.title.localeCompare(b.title),
	);
}

/** Parse a runtime display string ("3 min", "50 min", "24 h") to minutes for ordering. */
function runtimeMinutes(runtime: string): number {
	const m = runtime.match(/([\d.]+)\s*(min|h|hr|hour|day|d)?/i);
	if (!m) return Number.MAX_SAFE_INTEGER;
	const n = parseFloat(m[1]);
	const unit = (m[2] ?? 'min').toLowerCase();
	if (unit.startsWith('h')) return n * 60;
	if (unit.startsWith('d')) return n * 60 * 24;
	return n;
}

/** All showcased games, discovered and ordered. */
export const games: readonly DiscoveredGame[] = discover();

/**
 * The showcase grouped for display: an ordered list of themes, each with an
 * ordered list of runtime groups, each holding that group's games. This is what
 * the showcase page renders (theme heading -> runtime heading -> card grid).
 */
export interface RuntimeGroup {
	readonly runtime: string;
	readonly games: readonly DiscoveredGame[];
}
export interface ThemeGroup {
	readonly theme: string;
	readonly runtimes: readonly RuntimeGroup[];
}

export function groupedGames(): readonly ThemeGroup[] {
	const byTheme = new Map<string, Map<string, DiscoveredGame[]>>();
	for (const g of games) {
		const runtimes =
			byTheme.get(g.theme) ?? new Map<string, DiscoveredGame[]>();
		const bucket = runtimes.get(g.runtime) ?? [];
		bucket.push(g);
		runtimes.set(g.runtime, bucket);
		byTheme.set(g.theme, runtimes);
	}
	const themes: ThemeGroup[] = [];
	for (const [theme, runtimes] of byTheme) {
		const rgs: RuntimeGroup[] = [];
		for (const [runtime, gs] of runtimes) rgs.push({runtime, games: gs});
		rgs.sort((a, b) => runtimeMinutes(b.runtime) - runtimeMinutes(a.runtime));
		themes.push({theme, runtimes: rgs});
	}
	themes.sort((a, b) => a.theme.localeCompare(b.theme));
	return themes;
}

/** Look up a single game by slug (for the player route). */
export function findGame(slug: string): DiscoveredGame | undefined {
	return games.find((g) => g.slug === slug);
}

/** The public URL of a game's export folder, respecting the site base path. */
export function gameDir(game: DiscoveredGame): string {
	return `${base}/games/${game.dir}`;
}

/**
 * The public URL of a game's label image (PICO-8's title card), or undefined
 * when the game has no `label.png` in its folder.
 */
export function gameLabel(game: DiscoveredGame): string | undefined {
	return game.hasLabel ? `${gameDir(game)}/label.png` : undefined;
}
