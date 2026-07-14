/**
 * The playtest SESSION SUPERVISOR (ADR-0011, spec US #6): the daemon that keeps a
 * driven PICO-8 process ALIVE + PAUSED across the agent's separate CLI turns, and
 * the client the per-verb sub-invocations use to address it BY ID.
 *
 * The problem this solves: `playtest step <id>` / `input <id>` / `shot <id>` are
 * SEPARATE process invocations, but the driven PICO-8 must survive between them
 * (staying alive + paused). A one-shot CLI process cannot hold another process's
 * pipe, so `start` spawns a small DETACHED daemon that owns the live process + its
 * stdin/stdout (via {@link DriveSession}) and listens on a per-session Unix domain
 * socket; each later verb CONNECTS to that socket, sends its request, and gets the
 * structured result back. The session is addressed by an id = the socket + a
 * session dir under a controlled temp base (never `~/Desktop`, never the carts
 * root).
 *
 * Lifecycle robustness (US #6 acceptance):
 *  - ORPHAN reaping: the daemon self-reaps after an IDLE timeout (no verb within
 *    the window), so a session whose agent never `stop`s it does not leak a live
 *    PICO-8 forever. `stop <id>` tears it down promptly.
 *  - PICO-8 dying mid-session surfaces as a STRUCTURED error (via
 *    {@link SessionError}), not a hang; the next verb reports `process-dead`.
 *  - `start` with PICO-8 ABSENT returns the same structured `pico8-not-found`
 *    boundary as `run`/`audio render`.
 *
 * ONE session per id (the id IS the socket). Multiple concurrent sessions ARE
 * allowed (distinct ids/dirs/daemons); the tool does not serialize them, an agent
 * that wants isolation uses distinct ids (the default id is random, so parallel
 * `start`s never collide).
 *
 * The pure, CI-testable pieces (the id/path registry, the request/response codec)
 * live here alongside the IO daemon; the live daemon end-to-end is the
 * manual/opt-in tier. The handshake core it drives ({@link DriveSession}) is
 * separately unit-tested against a fake process.
 */

import {randomBytes} from 'node:crypto';
import {existsSync, mkdirSync, readdirSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

/** The controlled base dir all session dirs live under (never `~/Desktop`). */
export const SESSION_BASE_DIRNAME = 'picopilot-playtest-sessions' as const;

/**
 * The default IDLE-reap window: a daemon with no verb for this long tears its
 * session (and the live PICO-8) down, so an orphaned session (the agent walked
 * away without `stop`) cannot leak a process indefinitely. Every verb resets it.
 */
export const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60_000;

/** The session verbs a client can send the daemon over the socket. */
export type SessionVerb = 'input' | 'step' | 'shot' | 'stop' | 'status';

/** A request sent from a verb sub-invocation to the session daemon. */
export type SessionRequest =
	| {readonly verb: 'input'; readonly held: number}
	| {readonly verb: 'step'; readonly frames: number}
	| {readonly verb: 'shot'}
	| {readonly verb: 'stop'}
	| {readonly verb: 'status'};

/** A structured daemon response: either an ok payload or a structured error. */
export type SessionResponse =
	| {readonly ok: true; readonly value: SessionResponseValue}
	| {readonly ok: false; readonly code: string; readonly message: string};

/** The ok payload shape (a superset; each verb fills the relevant fields). */
export interface SessionResponseValue {
	/** The session id. */
	readonly id: string;
	/** Total frames advanced so far. */
	readonly frame: number;
	/** The ACK line the cart printed for this command (settled-frame proof). */
	readonly ack?: string;
	/** For `shot`: the absolute screenshot path the cart just wrote. */
	readonly screenshot?: string;
	/** For `shot`: the basename the cart named the capture. */
	readonly shotName?: string;
	/** Whether the session is still alive after this verb. */
	readonly alive: boolean;
}

/**
 * Encodes a request/response as a single newline-terminated JSON frame (the
 * socket protocol). Newline-framed so a reader can split a stream into whole
 * messages; kept pure so the codec is unit-tested without a socket.
 */
export function encodeFrame(msg: SessionRequest | SessionResponse): string {
	return `${JSON.stringify(msg)}\n`;
}

/**
 * A stateful frame decoder mirroring {@link encodeFrame}: feed it raw socket
 * chunks, it yields whole parsed messages (buffering partial lines). Typed loose
 * (`T`) because a client decodes responses and the daemon decodes requests.
 */
export class FrameDecoder<T> {
	private buffer = '';
	push(chunk: string): T[] {
		this.buffer += chunk;
		const out: T[] = [];
		let nl: number;
		while ((nl = this.buffer.indexOf('\n')) !== -1) {
			const line = this.buffer.slice(0, nl);
			this.buffer = this.buffer.slice(nl + 1);
			if (line.trim().length > 0) out.push(JSON.parse(line) as T);
		}
		return out;
	}
}

/** A resolved session's on-disk layout (all under the controlled base). */
export interface SessionPaths {
	/** The session id (also the dir name under the base). */
	readonly id: string;
	/** The session dir: `<base>/<id>`. */
	readonly dir: string;
	/** The Unix domain socket the daemon listens on. */
	readonly socket: string;
	/** The `-desktop` dir PICO-8 writes SHOT screenshots into. */
	readonly shotDir: string;
	/** The pidfile written by the daemon (for reap/liveness checks). */
	readonly pidfile: string;
}

/**
 * The session REGISTRY: the pure id/path logic mapping a session id to its
 * on-disk layout under a controlled base dir. No IO beyond the base-dir join, so
 * the id validation + path derivation are unit-tested. The daemon and the client
 * both resolve a session THROUGH this, so they agree on where the socket is.
 */
export class SessionRegistry {
	readonly base: string;

	constructor(base?: string) {
		this.base = base ?? join(tmpdir(), SESSION_BASE_DIRNAME);
	}

	/** A fresh random session id (short, filesystem-safe, collision-free enough). */
	static freshId(): string {
		return `s-${randomBytes(6).toString('hex')}`;
	}

	/**
	 * Validates a caller-supplied id: filesystem-safe, no path traversal, so an id
	 * can never escape the controlled base. Returns the id or throws a plain Error
	 * (the command maps it to a structured refusal).
	 */
	static validateId(id: string): string {
		if (!/^[A-Za-z0-9._-]{1,64}$/.test(id) || id === '.' || id === '..') {
			throw new Error(
				`invalid session id "${id}": use 1-64 chars of [A-Za-z0-9._-]`,
			);
		}
		return id;
	}

	/** Resolves a session id to its {@link SessionPaths} under the base. */
	resolve(id: string): SessionPaths {
		SessionRegistry.validateId(id);
		const dir = join(this.base, id);
		return {
			id,
			dir,
			socket: join(dir, 'sock'),
			shotDir: join(dir, 'shots'),
			pidfile: join(dir, 'pid'),
		};
	}

	/** Creates the session dir + shot dir (idempotent), returning the paths. */
	create(id: string): SessionPaths {
		const paths = this.resolve(id);
		mkdirSync(paths.shotDir, {recursive: true});
		return paths;
	}

	/** The ids of all sessions with a dir present under the base (for listing/reap). */
	list(): string[] {
		if (!existsSync(this.base)) return [];
		return readdirSync(this.base)
			.filter((name) => {
				try {
					return statSync(join(this.base, name)).isDirectory();
				} catch {
					return false;
				}
			})
			.sort();
	}

	/** Removes a session's whole dir (the reap/cleanup, after the daemon exits). */
	remove(id: string): void {
		const {dir} = this.resolve(id);
		rmSync(dir, {recursive: true, force: true});
	}
}
