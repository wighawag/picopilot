<script lang="ts">
	import {base} from '$app/paths';
	import {games} from '$lib/games';

	const commands = [
		{name: 'init', text: 'Scaffold an agent-ready PICO-8 cart.'},
		{name: 'gfx', text: 'Edit sprites as text; render them to a viewable PNG.'},
		{
			name: 'tokens / lint / minify',
			text: 'Count tokens, lint, and minify via shrinko8.',
		},
		{
			name: 'verify',
			text: 'The single static acceptance gate (tokens + lint + integrity).',
		},
		{
			name: 'run / playtest',
			text: 'Run a cart, capture screenshots, drive input.',
		},
		{name: 'audio', text: 'Author sound and music as text (picopilot-MML).'},
		{
			name: 'export / serve',
			text: 'Export to a playable HTML bundle and serve it in a browser.',
		},
	];
</script>

<section class="prose max-w-none prose-invert">
	<img src="{base}/logo.svg" alt="picopilot logo" class="mb-4 h-24 w-24" />
	<h1 class="!mb-2">
		<span class="text-neutral-50">pico</span><span class="text-pink-400"
			>pilot</span
		>
	</h1>
	<p class="lead text-lg text-neutral-300">
		An agent-first toolchain that makes PICO-8 game development easy with an
		LLM.
	</p>
	<p>
		picopilot is a single tool that is simultaneously a CLI, an MCP server, and
		a set of auto-installable agent skills. It is the transpile-and-verify layer
		between an agent's strength (text) and PICO-8's reality (binary cart
		sections): it gives the agent eyes (render sprites to a viewable PNG),
		token-bloat detection, safe cart editing, audio-as-text, and one static
		acceptance gate, so an LLM can build PICO-8 games and self-correct.
	</p>
</section>

<section class="mt-10">
	<h2 class="text-xl font-semibold">What it gives you</h2>
	<ul class="mt-4 grid gap-3 sm:grid-cols-2">
		{#each commands as c (c.name)}
			<li class="rounded-lg border border-neutral-800 p-4">
				<code class="text-emerald-400">{c.name}</code>
				<p class="mt-1 text-sm text-neutral-400">{c.text}</p>
			</li>
		{/each}
	</ul>
</section>

<section class="mt-10">
	<h2 class="text-xl font-semibold">Play the showcase</h2>
	<p class="mt-2 text-neutral-400">
		{#if games.length > 0}
			Games built with picopilot, playable in your browser.
		{:else}
			No games in the showcase yet. Export a cart into
			<code>website/static/games/&lt;slug&gt;/</code> and add it to the list.
		{/if}
	</p>
	<a
		href="{base}/showcase/"
		class="mt-4 inline-block rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500"
	>
		Open the showcase
	</a>
</section>
