<script lang="ts">
	import {base} from '$app/paths';
	import Pico8Player from '$lib/Pico8Player.svelte';
	import type {PageData} from './$types';

	let {data}: {data: PageData} = $props();
</script>

<section>
	<a href="{base}/showcase/" class="text-sm text-neutral-400 hover:text-white"
		>&larr; Back to showcase</a
	>

	<h1 class="mt-3 text-2xl font-bold">{data.game.title}</h1>
	{#if data.game.author}
		<p class="text-sm text-neutral-500">by {data.game.author}</p>
	{/if}
	<p class="mt-2 text-neutral-400">{data.game.blurb}</p>
	{#if data.game.links?.length}
		<p class="mt-2 flex flex-wrap gap-x-4 text-sm">
			{#each data.game.links as link (link.url)}
				<a href={link.url} class="text-emerald-400 hover:underline"
					>{link.label}</a
				>
			{/each}
		</p>
	{/if}

	<div class="mt-6">
		<Pico8Player game={data.game} />
	</div>
</section>
