import {
	createReadStream,
	existsSync,
	mkdtempSync,
	rmSync,
	statSync,
} from 'node:fs';
import {createServer, type Server} from 'node:http';
import {tmpdir} from 'node:os';
import {extname, isAbsolute, join, normalize, resolve} from 'node:path';
import {type Cli, z} from 'incur';
import {
	EXPORT_HTML_NAME,
	type Pico8Adapter,
	ShellPico8Adapter,
} from '../engine/pico8/index.js';

/**
 * Injects the PICO-8 adapter `serve` uses (defaults to the shell adapter). Same
 * seam as `export`/`run`: a test passes a stub so the export step needs no paid
 * binary, and the child `env` (`PICO8_PATH`/`PATH`) stays isolated.
 */
export type Pico8AdapterFactory = (env: NodeJS.ProcessEnv) => Pico8Adapter;

const defaultAdapterFactory: Pico8AdapterFactory = (env) =>
	new ShellPico8Adapter({env});

/**
 * Injects the HTTP-server factory `serve` binds. The default is a zero-dep
 * `node:http` static server over the export dir; a test injects a fake to assert
 * the serve loop WITHOUT opening a real socket. The factory returns the started
 * server plus the bound port (so `:0` -> an OS-assigned port is observable).
 */
export type ServerFactory = (
	rootDir: string,
	port: number,
) => Promise<{server: Server; port: number}>;

const DEFAULT_PORT = 5858;
const DEFAULT_BACKSTOP_MS = 30_000;

/**
 * Best-effort recursive removal of the temp export dir, swallowing any error (a
 * cleanup failure must never mask the command's own result or crash on exit).
 */
function removeDir(dir: string): void {
	try {
		rmSync(dir, {recursive: true, force: true});
	} catch {
		// A stubborn temp dir is not fatal; the OS reaps it eventually.
	}
}

/**
 * Registers a one-shot cleanup for the serving case: `serve` runs until the user
 * interrupts it (the socket keeps the process alive), so the temp export dir is
 * removed on SIGINT/SIGTERM and on normal `exit`. The handler fires at most once.
 * The default uses `process`; a test injects a fake to assert the wiring without
 * touching real signal handlers.
 */
export type CleanupRegistrar = (cleanup: () => void) => void;

const defaultCleanupRegistrar: CleanupRegistrar = (cleanup) => {
	let done = false;
	const once = (): void => {
		if (done) return;
		done = true;
		cleanup();
	};
	process.once('exit', once);
	// On a signal, run cleanup then re-exit so the temp dir is gone even on Ctrl-C.
	process.once('SIGINT', () => {
		once();
		process.exit(130);
	});
	process.once('SIGTERM', () => {
		once();
		process.exit(143);
	});
};

/** MIME types the static server needs for a PICO-8 export (html + the runtime js). */
const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.wasm': 'application/wasm',
	'.png': 'image/png',
	'.json': 'application/json; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
};

/**
 * The default {@link ServerFactory}: a minimal, zero-dependency `node:http`
 * static file server rooted at `rootDir`. It resolves `/` to `index.html`,
 * path-traversal-guards every request against `rootDir`, and streams files with
 * a best-effort content type. It exists to PLAY an export locally, not to be a
 * production server. Binding `:0` yields an OS-assigned port, reported back so
 * the command can print the real URL.
 */
const defaultServerFactory: ServerFactory = (rootDir, port) =>
	new Promise((resolvePromise, reject) => {
		const server = createServer((req, res) => {
			const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]!);
			// Resolve the request against the root and guard against traversal: the
			// resolved path must stay inside rootDir.
			const rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
			let filePath = join(rootDir, rel);
			if (!filePath.startsWith(rootDir)) {
				res.writeHead(403).end('forbidden');
				return;
			}
			try {
				if (existsSync(filePath) && statSync(filePath).isDirectory()) {
					filePath = join(filePath, 'index.html');
				}
				if (!existsSync(filePath)) {
					res.writeHead(404).end('not found');
					return;
				}
				res.writeHead(200, {
					'content-type':
						MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
				});
				createReadStream(filePath).pipe(res);
			} catch {
				res.writeHead(500).end('server error');
			}
		});
		server.on('error', reject);
		server.listen(port, '127.0.0.1', () => {
			const addr = server.address();
			const bound =
				typeof addr === 'object' && addr !== null ? addr.port : port;
			resolvePromise({server, port: bound});
		});
	});

/**
 * Registers `picopilot serve`, the "play this cart in a browser" loop. It ALWAYS
 * exports first (the quick round-trip: cart -> standalone HTML bundle -> local
 * server -> URL you open), so it takes a cart path, not a pre-built dir. The
 * export step hard-requires PICO-8 (absence is the structured `pico8-not-found`
 * value + a nonzero exit, mirroring `run`/`export`); the static server itself is
 * a zero-dep `node:http` file server over the temp export dir, so no extra
 * dependency and no ~/Desktop pollution.
 *
 * It is distinct from `export`: `export` PRODUCES a bundle at a chosen dest (for
 * the showcase); `serve` throws the bundle in a temp dir and serves it for a
 * quick manual play. It runs until interrupted (the server keeps the process
 * alive), which is why the injected {@link ServerFactory} seam lets a test drive
 * the export + bind path without leaving a real socket open.
 *
 * @param adapterFactory injects the PICO-8 adapter (defaults to the shell one).
 * @param serverFactory injects the HTTP server (defaults to the zero-dep static
 *   server); a test passes a fake to assert the loop without a real socket.
 * @param registerCleanup injects the exit/signal cleanup wiring (defaults to the
 *   real `process` handlers); a test passes a fake to capture the cleanup fn.
 */
export function registerServe(
	cli: Cli.Cli,
	adapterFactory: Pico8AdapterFactory = defaultAdapterFactory,
	serverFactory: ServerFactory = defaultServerFactory,
	registerCleanup: CleanupRegistrar = defaultCleanupRegistrar,
): void {
	cli.command('serve', {
		description:
			'Export a cart and serve it locally so you can play it in a browser. Requires PICO-8.',
		args: z.object({
			cart: z
				.string()
				.default('main.p8')
				.describe(
					'The .p8 cart to export and serve. Defaults to main.p8 in the current folder.',
				),
		}),
		options: z.object({
			port: z
				.number()
				.int()
				.min(0)
				.max(65535)
				.default(DEFAULT_PORT)
				.describe('Port to serve on (0 = an OS-assigned free port).'),
			backstopMs: z
				.number()
				.int()
				.positive()
				.default(DEFAULT_BACKSTOP_MS)
				.describe('Safety backstop for the export step.'),
		}),
		env: z.object({
			PICO8_PATH: z
				.string()
				.optional()
				.describe('Explicit path to the PICO-8 binary (else `pico8` on PATH).'),
			PATH: z.string().optional().describe('Used to locate `pico8`.'),
		}),
		output: z.object({
			url: z.string().describe('The local URL to open in a browser.'),
			port: z.number().describe('The port the server bound to.'),
			serveDir: z
				.string()
				.describe('The temp dir the export bundle was served from.'),
		}),
		examples: [
			{description: 'Export and serve main.p8'},
			{description: 'Serve a specific cart', args: {cart: 'game.p8'}},
			{
				description: 'Serve on a chosen port',
				args: {cart: 'game.p8'},
				options: {port: 8080},
			},
		],
		async run({args, options, env, error, ok}) {
			const cartPath = isAbsolute(args.cart)
				? args.cart
				: resolve(process.cwd(), args.cart);

			if (!existsSync(cartPath)) {
				return error({
					code: 'cart-not-found',
					message: `no cart at ${cartPath}`,
					exitCode: 1,
				});
			}

			// Always export first, into an isolated temp dir (never a user path or
			// ~/Desktop). The bundle is the standalone pair the static server plays.
			const serveDir = mkdtempSync(join(tmpdir(), 'picopilot-serve-'));
			const adapter = adapterFactory(env as NodeJS.ProcessEnv);
			const result = await adapter.export({
				cartPath,
				outDir: serveDir,
				htmlName: EXPORT_HTML_NAME,
				backstopMs: options.backstopMs,
			});

			if (!result.ok) {
				// Nothing is being served: remove the temp dir now, not on exit.
				removeDir(serveDir);
				return error({
					code: result.reason,
					message: `PICO-8 is not installed. ${result.remedy} (needs: ${result.needs.join(', ')})`,
					exitCode: 1,
				});
			}

			if (result.value.jsPath === undefined) {
				removeDir(serveDir);
				return error({
					code: 'export-failed',
					message: result.value.labelWarning
						? 'PICO-8 produced no bundle (the cart has no __label__). Capture a label first, then re-serve.'
						: 'PICO-8 produced no export bundle. Check the cart runs without a boot error.',
					exitCode: 1,
				});
			}

			const {server, port} = await serverFactory(serveDir, options.port);
			const url = `http://127.0.0.1:${port}/`;

			// The server keeps the process alive until interrupted; the temp export dir
			// is reaped on SIGINT/SIGTERM/exit so a long-lived serve leaves no leak.
			// `server` is referenced so its lifetime is the command's; a test's fake
			// resolves without a real socket.
			registerCleanup(() => removeDir(serveDir));
			void server;

			return ok({url, port, serveDir});
		},
	});
}
