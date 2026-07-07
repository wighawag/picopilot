<script lang="ts">
	import {gameDir, type DiscoveredGame} from './games';

	/**
	 * Plays a PICO-8 export from `static/games/<slug>/`.
	 *
	 * PICO-8's HTML export (`picopilot export`, ADR-0013) is a self-contained
	 * player: `index.html` is a ~700-line shell (input, layout, audio, gamepad,
	 * touch) that loads a sibling `index.js` (the Emscripten runtime + baked-in
	 * cart). Reimplementing that shell in Svelte would be a brittle port, so for
	 * the STANDALONE shape we reuse PICO-8's own shell verbatim inside an iframe:
	 * the site provides the surrounding chrome, PICO-8 provides the proven player.
	 *
	 * The PAYLOAD-ONLY shape (a `--payload-only` export: just `index.js`, no shell)
	 * is the thinner integration for a site that wants to own the shell. A full
	 * from-scratch bootstrap port is future work; until then this component only
	 * fully supports the standalone shape and shows a clear notice for payload-only
	 * folders. See `static/games/README.md`.
	 */
	let {game}: {game: DiscoveredGame} = $props();

	const shape = $derived(game.shape ?? 'standalone');
	const src = $derived(`${gameDir(game)}/index.html`);
</script>

{#if shape === 'standalone'}
	<div
		class="mx-auto aspect-square w-full max-w-2xl overflow-hidden rounded-lg border border-neutral-800 bg-black"
	>
		<iframe
			title={game.title}
			{src}
			class="h-full w-full border-0"
			allow="fullscreen; autoplay; gamepad"
		></iframe>
	</div>
{:else}
	<div
		class="mx-auto max-w-2xl rounded-lg border border-amber-800 bg-amber-950/40 p-4 text-sm text-amber-200"
	>
		<p class="font-semibold">This game is a payload-only export.</p>
		<p class="mt-1">
			A payload-only folder holds just <code>index.js</code> (no PICO-8 shell), for
			a site that provides its own player. The from-scratch player shell is not built
			yet. Re-export this cart in standalone mode to play it here:
		</p>
		<pre
			class="mt-2 overflow-x-auto rounded bg-black/40 p-2 text-xs">picopilot export {game.slug}.p8 ./website/static/games/{game.slug}/</pre>
	</div>
{/if}
