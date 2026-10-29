<script lang="ts">
	import {base} from '$app/paths';
	import {
		games,
		groupedGames,
		gameLabel,
		directedGames,
		type DiscoveredGame,
	} from '$lib/games';

	const themes = groupedGames();
</script>

{#snippet card(game: DiscoveredGame)}
	{@const label = gameLabel(game)}
	<li>
		<a
			href="{base}/showcase/{game.slug}/"
			class="block overflow-hidden rounded-lg border border-neutral-800 transition hover:border-emerald-600 hover:bg-neutral-900/50"
		>
			{#if label}
				<img
					src={label}
					alt="{game.title} title card"
					width="128"
					height="128"
					class="aspect-square w-full border-b border-neutral-800 bg-black object-cover [image-rendering:pixelated]"
				/>
			{/if}
			<div class="p-5">
				<h5 class="text-lg font-semibold">{game.title}</h5>
				<p class="mt-1 text-sm text-neutral-400">{game.blurb}</p>
				{#if game.author}
					<p class="mt-2 text-xs text-neutral-500">by {game.author}</p>
				{/if}
			</div>
		</a>
	</li>
{/snippet}

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
				Add a game by exporting a cart into
				<code>static/games/&lt;theme&gt;/&lt;runtime&gt;/&lt;slug&gt;/</code>
				with a
				<code>meta.json</code>; the showcase discovers it automatically.
			</p>
		</div>
	{:else}
		{#if directedGames.length > 0}
			<div class="mt-10">
				<h2 class="text-xl font-bold text-emerald-400">Games</h2>
				<p class="mt-1 text-sm text-neutral-500">
					Directed, playtested and fine-tuned until they held up.
				</p>
				<ul class="mt-3 grid gap-4 sm:grid-cols-2">
					{#each directedGames as game (game.slug)}
						{@render card(game)}
					{/each}
				</ul>
			</div>
		{/if}
		{#if themes.length > 0}
			<h2 class="mt-12 text-xl font-bold text-emerald-400">Game jams</h2>
			<p class="mt-1 text-sm text-neutral-500">
				Single time-boxed runs, grouped by theme and by the time budget they
				were built in.
			</p>
		{/if}
		{#each themes as themeGroup (themeGroup.theme)}
			<div class="mt-8">
				<h3 class="text-lg font-bold text-neutral-200 capitalize">
					{themeGroup.theme}
				</h3>
				{#each themeGroup.runtimes as runtimeGroup (runtimeGroup.runtime)}
					<div class="mt-6">
						<h4
							class="text-sm font-semibold tracking-wide text-neutral-500 uppercase"
						>
							{runtimeGroup.runtime}
						</h4>
						<ul class="mt-3 grid gap-4 sm:grid-cols-2">
							{#each runtimeGroup.games as game (game.slug)}
								{@render card(game)}
							{/each}
						</ul>
					</div>
				{/each}
			</div>
		{/each}
	{/if}
</section>
