<script lang="ts">
	import {base} from '$app/paths';
	import {games, groupedGames, gameLabel} from '$lib/games';

	const themes = groupedGames();
</script>

<section>
	<h1 class="text-2xl font-bold">Showcase</h1>
	<p class="mt-2 text-neutral-400">
		PICO-8 games built with picopilot, grouped by jam theme and by the time
		budget they were built in. Click one to play it in your browser.
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
		{#each themes as themeGroup (themeGroup.theme)}
			<div class="mt-10">
				<h2 class="text-xl font-bold text-emerald-400 capitalize">
					{themeGroup.theme}
				</h2>
				{#each themeGroup.runtimes as runtimeGroup (runtimeGroup.runtime)}
					<div class="mt-6">
						<h3
							class="text-sm font-semibold tracking-wide text-neutral-500 uppercase"
						>
							{runtimeGroup.runtime}
						</h3>
						<ul class="mt-3 grid gap-4 sm:grid-cols-2">
							{#each runtimeGroup.games as game (game.slug)}
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
											<h4 class="text-lg font-semibold">{game.title}</h4>
											<p class="mt-1 text-sm text-neutral-400">{game.blurb}</p>
											{#if game.author}
												<p class="mt-2 text-xs text-neutral-500">
													by {game.author}
												</p>
											{/if}
										</div>
									</a>
								</li>
							{/each}
						</ul>
					</div>
				{/each}
			</div>
		{/each}
	{/if}
</section>
