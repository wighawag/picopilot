<script lang="ts">
	import '../app.css';
	import {base} from '$app/paths';
	let {children} = $props();
</script>

<div class="flex min-h-full flex-col">
	<header class="border-b border-neutral-800">
		<nav class="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
			<a href="{base}/" class="flex items-center gap-2">
				<img src="{base}/logo.svg" alt="" class="h-8 w-8" />
				<span class="text-lg font-bold tracking-tight">
					<span class="text-neutral-50">pico</span><span class="text-pink-400"
						>pilot</span
					>
				</span>
			</a>
			<div class="flex gap-4 text-sm text-neutral-300">
				<a class="hover:text-white" href="{base}/showcase/">Showcase</a>
				<a
					class="hover:text-white"
					href="https://github.com/wighawag/picopilot"
					rel="external">GitHub</a
				>
			</div>
		</nav>
	</header>

	<main class="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
		{@render children()}
	</main>

	<footer
		class="border-t border-neutral-800 px-4 py-6 text-center text-sm text-neutral-500"
	>
		picopilot &middot; an agent-first PICO-8 toolchain
	</footer>
</div>
