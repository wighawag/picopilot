import {error} from '@sveltejs/kit';
import {findGame, games} from '$lib/games';
import type {EntryGenerator, PageLoad} from './$types';

// Prerender one static page per showcased game (the manual selection in games.ts).
export const entries: EntryGenerator = () => games.map((g) => ({slug: g.slug}));

export const load: PageLoad = ({params}) => {
	const game = findGame(params.slug);
	if (game === undefined) {
		throw error(404, `No showcased game "${params.slug}"`);
	}
	return {game};
};
