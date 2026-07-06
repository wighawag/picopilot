<script lang="ts">
	import {base} from '$app/paths';
	import {games} from '$lib/games';
</script>

<section>
	<h1 class="text-2xl font-bold">Showcase</h1>
	<p class="mt-2 text-neutral-400">
		PICO-8 games built with picopilot. Click one to play it in your browser.
	</p>

	{#if games.length === 0}
		<div
			class="mt-8 rounded-lg border border-neutral-800 bg-neutral-900/50 p-6 text-neutral-300"
		>
			<p class="font-medium">The showcase is empty.</p>
			<p class="mt-2 text-sm text-neutral-400">
				Add a game by exporting a cart into its own folder, then listing it in
				<code>src/lib/games.ts</code>:
			</p>
			<pre
				class="mt-3 overflow-x-auto rounded bg-black/40 p-3 text-xs text-neutral-200">picopilot export my-game.p8 ./website/static/games/my-game/</pre>
		</div>
	{:else}
		<ul class="mt-8 grid gap-4 sm:grid-cols-2">
			{#each games as game (game.slug)}
				<li>
					<a
						href="{base}/showcase/{game.slug}/"
						class="block rounded-lg border border-neutral-800 p-5 transition hover:border-emerald-600 hover:bg-neutral-900/50"
					>
						<h2 class="text-lg font-semibold">{game.title}</h2>
						<p class="mt-1 text-sm text-neutral-400">{game.blurb}</p>
						{#if game.author}
							<p class="mt-2 text-xs text-neutral-500">by {game.author}</p>
						{/if}
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</section>
