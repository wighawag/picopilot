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

<!-- Hero: logo + one-line tagline only. -->
<section>
	<div class="flex items-center gap-4">
		<img
			src="{base}/logo.svg"
			alt=""
			class="h-20 w-20 shrink-0 sm:h-24 sm:w-24"
		/>
		<h1 class="!m-0 text-4xl font-bold sm:text-5xl">
			<span class="text-neutral-50">pico</span><span class="text-pink-400"
				>pilot</span
			>
		</h1>
	</div>
	<p class="mt-4 text-lg text-neutral-300">
		An agent-first toolchain that lets an LLM build PICO-8 games. A quick setup
		and you are playing something your agent made.
	</p>
</section>

<!-- Get started: the hero action. Big, copyable, try-in-seconds. -->
<section
	class="mt-8 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 sm:p-8"
>
	<h2 class="text-2xl font-bold text-neutral-50">Try it in seconds</h2>
	<p class="mt-1 text-sm text-neutral-400">
		Two steps and your agent is building a PICO-8 game:
	</p>

	<div class="mt-6 space-y-6">
		<div>
			<div class="flex items-baseline gap-3">
				<span
					class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-sm font-bold text-black"
					>1</span
				>
				<p class="font-medium text-neutral-100">
					Install picopilot and its agent skills
				</p>
			</div>
			<p class="mt-1 pl-9 text-sm text-neutral-400">
				So the <code>picopilot</code> command is on your PATH (the agent calls it
				many times per iteration), and one opt-in write lets your agent (Claude
				Code, pi, ...) discover it.
			</p>
			<pre
				class="mt-2 ml-9 overflow-x-auto rounded-lg bg-black/50 px-4 py-3 text-sm text-emerald-300">npm i -g picopilot
picopilot skills add

# optional but recommended: the token / verify gate
uv pip install shrinko</pre>
		</div>

		<div>
			<div class="flex items-baseline gap-3">
				<span
					class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-sm font-bold text-black"
					>2</span
				>
				<p class="font-medium text-neutral-100">
					Ask your agent to build a game
				</p>
			</div>
			<p class="mt-1 pl-9 text-sm text-neutral-400">
				In an empty folder. It scaffolds the cart, writes the Lua, draws the
				sprites, and keeps <code>verify</code> green on its own.
			</p>
			<pre
				class="mt-2 ml-9 overflow-x-auto rounded-lg bg-black/50 px-4 py-3 text-sm text-emerald-300">pi -p "make me a fun PICO-8 game with picopilot"</pre>
		</div>
	</div>

	<p class="mt-6 text-xs text-neutral-500">
		Any skills-capable coding agent works. Prefer a theme? Try
		<code>"a one-button game about gravity"</code> and let it run.
	</p>
	<p class="mt-2 text-xs text-neutral-500">
		Prefer not to install globally? Add <code>picopilot</code> as a project
		dependency instead; the skills call it bare, so it just needs to resolve on
		PATH. <code>shrinko</code> is optional: skip it and the build still runs, you
		only lose the token count and the <code>verify</code> gate (more below).
	</p>
</section>

<!-- Deferred prose + optional deps, out of the way of the try-it path. -->
<section class="mt-10">
	<details class="group rounded-lg border border-neutral-800 bg-neutral-900/40">
		<summary
			class="cursor-pointer list-none px-4 py-3 text-sm font-medium text-neutral-200 select-none marker:content-none"
		>
			<span class="text-neutral-500 group-open:hidden">+ </span><span
				class="hidden text-neutral-500 group-open:inline">− </span
			>What is picopilot, and what do I need?
		</summary>
		<div class="space-y-4 border-t border-neutral-800 px-4 py-4">
			<p class="text-sm text-neutral-400">
				picopilot is a single tool that is simultaneously a CLI, an MCP server,
				and a set of auto-installable agent skills. It is the transpile-and-verify
				layer between an agent's strength (text) and PICO-8's reality (binary cart
				sections): it gives the agent eyes (render sprites to a viewable PNG),
				token-bloat detection, safe cart editing, audio-as-text, and one static
				acceptance gate, so an LLM can build PICO-8 games and self-correct.
			</p>
			<div>
				<p class="text-sm font-medium text-neutral-200">Optional dependencies</p>
				<ul class="mt-2 space-y-1 text-sm text-neutral-400">
					<li>
						<code class="text-emerald-400">shrinko</code> (optional) powers the
						token / lint / minify / <code>verify</code> commands. Install with
						<code>uv pip install shrinko</code> (needs Python 3.8+). Note the PyPI
						package is <code>shrinko</code> and the module is <code>shrinko8</code>,
						so install <code>shrinko</code>, not <code>shrinko8</code>. Without it
						those commands return a clear <code>shrinko-not-found</code> carrying
						that exact remedy, and <code>verify</code> reports a distinct
						<code>gate-incapable</code> outcome (never a false green) because it
						will not skip its token check. Everything not token-related keeps
						working.
					</li>
					<li>
						<strong>PICO-8</strong> (a paid binary) is only needed to actually run
						a cart: <code>run</code>, <code>playtest</code>, <code>export</code>,
						and <code>audio render</code>. Set <code>PICO8_PATH</code> or put
						<code>pico8</code> on your PATH. Everything else (edit, verify, art,
						audio authoring) works without it.
					</li>
				</ul>
			</div>
			<p class="text-xs text-neutral-500">
				picopilot is also an MCP server, run <code>npx picopilot</code> to see all
				commands.
			</p>
		</div>
	</details>
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
