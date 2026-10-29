<script lang="ts">
	import {base} from '$app/paths';
	import Pico8Player from '$lib/Pico8Player.svelte';
	import {gamePageUrl, gamePreviewImage} from '$lib/games';
	import type {PageData} from './$types';

	let {data}: {data: PageData} = $props();
	const title = $derived(`${data.game.title} · picopilot`);
	const image = $derived(gamePreviewImage(data.game));
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={data.game.blurb} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="picopilot" />
	<meta property="og:title" content={data.game.title} />
	<meta property="og:description" content={data.game.blurb} />
	<meta property="og:url" content={gamePageUrl(data.game)} />
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content={data.game.title} />
	<meta name="twitter:description" content={data.game.blurb} />
	{#if image}
		<meta property="og:image" content={image} />
		<meta property="og:image:alt" content="{data.game.title} title card" />
		<meta name="twitter:image" content={image} />
	{/if}
</svelte:head>

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
