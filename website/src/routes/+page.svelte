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
	<div class="mb-4 flex items-center gap-4">
		<img
			src="{base}/logo.svg"
			alt=""
			class="h-20 w-20 shrink-0 sm:h-24 sm:w-24"
		/>
		<h1 class="!m-0 text-4xl sm:text-5xl">
			<span class="text-neutral-50">pico</span><span class="text-pink-400"
				>pilot</span
			>
		</h1>
	</div>
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
	<h2 class="text-xl font-semibold">Get started</h2>
	<p class="mt-2 text-neutral-400">
		picopilot runs with no install via <code>npx</code>. The steps below make
		your coding agent discover picopilot and scaffold a cart.
	</p>

	<ol class="mt-4 space-y-4">
		<li>
			<p class="text-sm font-medium text-neutral-200">
				1. Install the agent skills (one opt-in write to your shared skill dir)
			</p>
			<p class="mt-1 text-sm text-neutral-400">
				So your agent (Claude Code, pi, etc.) auto-discovers picopilot and knows
				the cart / art / audio / debug loops.
			</p>
			<pre
				class="mt-2 overflow-x-auto rounded bg-black/40 p-3 text-xs text-neutral-200">npx picopilot skills add</pre>
		</li>
		<li>
			<p class="text-sm font-medium text-neutral-200">
				2. Scaffold a cart in an empty folder
			</p>
			<p class="mt-1 text-sm text-neutral-400">
				Creates <code>main.p8</code> + <code>main.lua</code> (you edit the Lua),
				an <code>AGENTS.md</code> PICO-8 reference, and a
				<code>picopilot.json</code> config.
			</p>
			<pre
				class="mt-2 overflow-x-auto rounded bg-black/40 p-3 text-xs text-neutral-200">npx picopilot init</pre>
		</li>
		<li>
			<p class="text-sm font-medium text-neutral-200">
				3. Build, then gate every change
			</p>
			<p class="mt-1 text-sm text-neutral-400">
				Point your agent at the folder and let it work the loop; keep
				<code>verify</code> green.
			</p>
			<pre
				class="mt-2 overflow-x-auto rounded bg-black/40 p-3 text-xs text-neutral-200">npx picopilot verify</pre>
		</li>
	</ol>

	<div class="mt-4 rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
		<p class="text-sm font-medium text-neutral-200">Optional dependencies</p>
		<ul class="mt-2 space-y-1 text-sm text-neutral-400">
			<li>
				<code class="text-emerald-400">shrinko</code> powers the token / lint /
				minify / <code>verify</code> commands:
				<code>uv pip install shrinko</code>. Without it those commands return a
				clear <code>shrinko-not-found</code> with this exact remedy; the rest work.
			</li>
			<li>
				<strong>PICO-8</strong> (a paid binary) is only needed to actually run a
				cart: <code>run</code>, <code>playtest</code>, <code>export</code>, and
				<code>audio render</code>. Set <code>PICO8_PATH</code> or put
				<code>pico8</code> on your PATH. Everything else (edit, verify, art, audio
				authoring) works without it.
			</li>
		</ul>
	</div>

	<p class="mt-3 text-xs text-neutral-500">
		Prefer a global install? <code>npm i -g picopilot</code>, then drop the
		<code>npx</code> prefix. picopilot is also an MCP server, run
		<code>npx picopilot</code> to see all commands.
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
			<code
				>website/static/games/&lt;theme&gt;/&lt;runtime&gt;/&lt;slug&gt;/</code
			>
			with a
			<code>meta.json</code>.
		{/if}
	</p>
	<a
		href="{base}/showcase/"
		class="mt-4 inline-block rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500"
	>
		Open the showcase
	</a>
</section>
