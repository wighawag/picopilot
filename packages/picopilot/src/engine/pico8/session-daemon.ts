/**
 * The playtest session DAEMON runtime + CLIENT (ADR-0011, prd US #6). This is the
 * IO half of the supervisor: the daemon LISTENS on a session's Unix domain socket
 * and drives a live {@link DriveSession} on behalf of each verb sub-invocation;
 * the {@link SessionClient} CONNECTS to that socket to send a verb and read back
 * the structured response.
 *
 * The daemon owns the live process the whole session, so the game stays ALIVE +
 * PAUSED between the agent's turns. It self-reaps on an IDLE timeout (the orphan
 * path) and on `stop`. The live daemon end-to-end is the manual/opt-in tier; the
 * pure pieces it composes (the handshake {@link DriveSession}, the registry, the
 * frame codec) are unit-tested without a real socket or binary.
 */

import {spawn} from 'node:child_process';
import {createConnection, createServer, type Socket} from 'node:net';
import {existsSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
	DriveSession,
	SessionError,
	type ShotResult,
	type StepResult,
} from './session.js';
import type {Pico8Process} from './shell.js';
import {
	DEFAULT_IDLE_TIMEOUT_MS,
	encodeFrame,
	FrameDecoder,
	type SessionPaths,
	type SessionRequest,
	type SessionResponse,
	type SessionResponseValue,
} from './supervisor.js';

/**
 * A client for a running session daemon: connects to its socket, sends ONE verb
 * request, awaits the single response, and closes. Each `playtest step/input/shot
 * /stop` sub-invocation makes exactly one of these round-trips.
 */
export class SessionClient {
	constructor(private readonly socketPath: string) {}

	/**
	 * Sends `request` to the daemon and resolves its {@link SessionResponse}. A
	 * connection failure (no daemon / dead socket) rejects with a plain Error the
	 * command maps to `playtest-session-not-found`.
	 */
	send(request: SessionRequest): Promise<SessionResponse> {
		return new Promise<SessionResponse>((resolve, reject) => {
			const decoder = new FrameDecoder<SessionResponse>();
			let settled = false;
			const sock = createConnection(this.socketPath);
			sock.setEncoding('utf8');
			sock.on('connect', () => sock.write(encodeFrame(request)));
			sock.on('data', (chunk: string) => {
				const [msg] = decoder.push(chunk);
				if (msg !== undefined && !settled) {
					settled = true;
					resolve(msg);
					sock.end();
				}
			});
			sock.on('error', (err) => {
				if (!settled) {
					settled = true;
					reject(err);
				}
			});
			sock.on('close', () => {
				if (!settled) {
					settled = true;
					reject(new Error('daemon closed the connection with no response'));
				}
			});
		});
	}
}

/** Whether a session daemon is reachable (its socket exists). */
export function sessionExists(paths: SessionPaths): boolean {
	return existsSync(paths.socket);
}

/** Resolves the sibling daemon-entry module (`.ts` in dev, `.js` when built). */
function daemonEntryPath(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	// This module and the entry are compiled/loaded together, so the extension
	// here (`.ts` under tsx, `.js` under dist) is the entry's extension too.
	const ext = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
	return join(here, `session-daemon-entry${ext}`);
}

/**
 * Spawns the session DAEMON as a DETACHED background process that outlives this
 * (the `start`) invocation, so the driven PICO-8 stays alive across the agent's
 * separate verb turns. It re-invokes the current executable + `execArgv` (so the
 * daemon runs under the SAME loader, dev `tsx` or built node) on the daemon entry
 * file, passing the config as a single JSON arg. `unref` + `detached` cut it free
 * from this process's lifetime; its stdio is ignored (the daemon talks over the
 * session socket, not this process's pipes).
 */
export function spawnSessionDaemon(
	config: import('./session-daemon-main.js').DaemonConfig,
): void {
	const child = spawn(
		process.execPath,
		[...process.execArgv, daemonEntryPath(), JSON.stringify(config)],
		{detached: true, stdio: 'ignore'},
	);
	child.unref();
}

/** Options for {@link serveSession}. */
export interface ServeSessionOptions {
	readonly id: string;
	readonly paths: SessionPaths;
	/** The live driven process to own for this session (spawned by the caller). */
	readonly process: Pico8Process;
	/** The screenshot basename the driven cart names each SHOT (matches transform). */
	readonly shotBasename: string;
	/** Idle-reap window (defaults to {@link DEFAULT_IDLE_TIMEOUT_MS}). */
	readonly idleTimeoutMs?: number;
	/** Per-command ACK deadline forwarded to {@link DriveSession}. */
	readonly ackTimeoutMs?: number;
	/** Called when the daemon has fully torn down (for the process to exit). */
	readonly onExit?: () => void;
}

/**
 * Runs the session daemon: wraps the live process in a {@link DriveSession},
 * listens on the session socket, and dispatches each incoming verb request to the
 * handshake (send-command -> wait-ack -> respond). Resets an IDLE-reap timer on
 * every verb, so an orphaned session tears down on its own. Returns the net
 * server so the caller (the daemon entrypoint) can await its lifetime.
 */
export function serveSession(options: ServeSessionOptions): {
	close: () => void;
} {
	const session = new DriveSession({
		process: options.process,
		shotBasename: options.shotBasename,
		ackTimeoutMs: options.ackTimeoutMs,
	});
	const idleMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;

	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	let tornDown = false;

	const teardown = (): void => {
		if (tornDown) return;
		tornDown = true;
		if (idleTimer !== undefined) clearTimeout(idleTimer);
		try {
			session.stop();
		} catch {
			// best-effort; the process kill below is the real backstop
		}
		try {
			server.close();
		} catch {
			// ignore
		}
		// Reap the WHOLE session dir (socket + pidfile + driven cart + shots), so an
		// idle/orphan teardown leaves nothing behind, not just the socket. (The CLI
		// `stop` also sweeps the dir; doing it here covers the no-`stop` orphan path.)
		try {
			rmSync(options.paths.dir, {recursive: true, force: true});
		} catch {
			// ignore
		}
		options.onExit?.();
	};

	const armIdle = (): void => {
		if (idleTimer !== undefined) clearTimeout(idleTimer);
		idleTimer = setTimeout(teardown, idleMs);
		idleTimer.unref?.();
	};

	const handle = async (req: SessionRequest): Promise<SessionResponse> => {
		armIdle();
		try {
			switch (req.verb) {
				case 'input': {
					const r: StepResult = await session.input(req.held);
					return ok(options.id, {frame: r.frame, ack: r.ack, alive: true});
				}
				case 'step': {
					// A frames span may exceed one byte; the daemon issues it as repeated
					// single-byte steps, each awaiting its own STEP-DONE ack, so the total
					// is exact and lossless regardless of size.
					let last: StepResult = {frame: session.frame, ack: ''};
					let remaining = Math.max(0, Math.floor(req.frames));
					while (remaining > 0) {
						const chunk = Math.min(remaining, 0xff);
						last = await session.step(chunk);
						remaining -= chunk;
					}
					return ok(options.id, {
						frame: last.frame,
						ack: last.ack,
						alive: true,
					});
				}
				case 'shot': {
					const r: ShotResult = await session.shot();
					const screenshot = collectShot(options.paths.shotDir, r.shotName);
					return ok(options.id, {
						frame: r.frame,
						ack: r.ack,
						shotName: r.shotName,
						screenshot,
						alive: true,
					});
				}
				case 'status': {
					return ok(options.id, {
						frame: session.frame,
						alive: !session.isDead,
					});
				}
				case 'stop': {
					// The connection handler tears the daemon down AFTER this response has
					// flushed to the client (so `stop` returns cleanly, no close-race).
					return ok(options.id, {frame: session.frame, alive: false});
				}
			}
		} catch (e) {
			if (e instanceof SessionError) {
				return {ok: false, code: e.code, message: e.message};
			}
			return {
				ok: false,
				code: 'playtest-session-error',
				message: e instanceof Error ? e.message : String(e),
			};
		}
	};

	const server = createServer((sock: Socket) => {
		sock.setEncoding('utf8');
		const decoder = new FrameDecoder<SessionRequest>();
		sock.on('data', (chunk: string) => {
			for (const req of decoder.push(chunk)) {
				const isStop = req.verb === 'stop';
				void handle(req).then((res) => {
					try {
						// Flush the response, THEN (for `stop`) end the socket and tear the
						// daemon down, so the client always reads the stop reply first.
						sock.write(encodeFrame(res), () => {
							if (isStop) {
								sock.end();
								teardown();
							}
						});
					} catch {
						if (isStop) teardown();
					}
				});
			}
		});
		sock.on('error', () => {
			/* a dropped client is not fatal to the daemon */
		});
	});

	// If the driven process dies, the next verb reports it (process-dead); we do
	// NOT auto-teardown here, so the agent can still `stop`/`status` and get the
	// structured error rather than a vanished socket.
	server.listen(options.paths.socket, () => {
		writeFileSync(options.paths.pidfile, String(process.pid));
		armIdle();
	});

	return {close: teardown};
}

/** Builds an ok {@link SessionResponse} from a partial value + the id. */
function ok(
	id: string,
	partial: Omit<SessionResponseValue, 'id'>,
): SessionResponse {
	return {ok: true, value: {id, ...partial}};
}

/**
 * Resolves the absolute path of the screenshot a SHOT just produced in the
 * `-desktop` dir. The cart named it `<shotName>` (basename) and PICO-8 appends
 * `.png`; if the exact file is not yet visible (a filesystem race) it falls back
 * to the most-recent PNG, so the caller still gets a path to read.
 */
function collectShot(shotDir: string, shotName: string): string | undefined {
	const exact = join(shotDir, `${shotName}.png`);
	if (existsSync(exact)) return exact;
	try {
		const pngs = readdirSync(shotDir)
			.filter((f) => f.toLowerCase().endsWith('.png'))
			.sort();
		const last = pngs.at(-1);
		return last !== undefined ? join(shotDir, last) : undefined;
	} catch {
		return undefined;
	}
}
