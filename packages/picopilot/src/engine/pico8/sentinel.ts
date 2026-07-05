import {DONE_SENTINEL} from './adapter.js';

/**
 * The pure sentinel-watch core (ADR-0006): scan a stdout stream line by line and
 * decide WHEN to kill PICO-8. A cart cannot self-quit the app, so it signals
 * "done" by printing a sentinel line via `printh`; the launcher kills the moment
 * it matches. This is strictly better than a blind timeout (no guessing the
 * duration), which stays only as a backstop in the shell layer.
 *
 * Kept PURE and stream-shaped on purpose: it is the load-bearing logic and the
 * one piece testable in CI WITHOUT the paid PICO-8 binary. The shell layer feeds
 * it real child stdout; a test feeds it a fake array of lines.
 */

/**
 * Splits a raw stdout chunk into complete lines plus a trailing remainder,
 * so sentinel matching works on whole lines even when the OS delivers stdout in
 * arbitrary chunks. The remainder (an unterminated final line) is carried to the
 * next chunk by the caller.
 *
 * Handles both `\n` and `\r\n`; the `\r` is stripped so a sentinel matches
 * regardless of platform line endings.
 */
export function splitLines(chunk: string): {lines: string[]; rest: string} {
	const parts = chunk.split('\n');
	const rest = parts.pop() ?? '';
	return {
		lines: parts.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l)),
		rest,
	};
}

/**
 * Scans `lines` for the `sentinel` and reports whether it appeared and at which
 * index. A match means the caller should kill PICO-8 now (exit reason
 * `sentinel`); no match means keep streaming until the backstop or a natural
 * exit. The comparison is an EXACT line match (the cart prints the sentinel on
 * its own line), so incidental substrings in other output never trip it.
 */
export function findSentinel(
	lines: readonly string[],
	sentinel: string = DONE_SENTINEL,
): {matched: boolean; index: number} {
	const index = lines.findIndex((l) => l === sentinel);
	return {matched: index !== -1, index};
}

/**
 * A stateful line accumulator for a streaming run: feed it raw stdout chunks;
 * it buffers partial lines, exposes the complete lines seen so far, and reports
 * the moment the sentinel is matched. This is the exact glue the shell adapter
 * drives (feed chunks, stop on `sentinelSeen`), and a test drives it with
 * synthetic chunks to assert prompt-kill vs. no-match without a real process.
 */
export class SentinelWatcher {
	private buffer = '';
	private readonly linesSeen: string[] = [];
	private matched = false;

	constructor(private readonly sentinel: string = DONE_SENTINEL) {}

	/**
	 * Feeds one raw stdout chunk. Returns `true` the first time the sentinel is
	 * matched (the caller should kill PICO-8 then); once matched it stays matched.
	 */
	push(chunk: string): boolean {
		const {lines, rest} = splitLines(this.buffer + chunk);
		this.buffer = rest;
		for (const line of lines) {
			this.linesSeen.push(line);
			if (line === this.sentinel) this.matched = true;
		}
		return this.matched;
	}

	/** Whether the sentinel has been seen on a complete line so far. */
	get sentinelSeen(): boolean {
		return this.matched;
	}

	/**
	 * The full captured stdout as text (complete lines plus any unterminated
	 * trailing buffer), for the run report's `printh`. The sentinel line itself
	 * is KEPT (it is real cart output); the command decides whether to show it.
	 */
	get text(): string {
		const all =
			this.buffer.length > 0
				? [...this.linesSeen, this.buffer]
				: this.linesSeen;
		return all.join('\n');
	}
}
