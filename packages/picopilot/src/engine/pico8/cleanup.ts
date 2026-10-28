/**
 * Kill-on-abort for child processes picopilot owns while a run is in flight
 * (the PICO-8 process group, a private Xvfb). Normal endings (sentinel,
 * backstop, crash) are handled by the run itself; this covers picopilot being
 * stopped mid-run: `process.exit`, an uncaught throw, or SIGINT / SIGTERM /
 * SIGHUP sent to picopilot alone (an agent harness or `timeout` killing it).
 * Without it, a detached PICO-8 or an Xvfb would outlive picopilot.
 *
 * `kill` must be synchronous (it runs inside an `exit` handler). On a signal,
 * the hook kills, then re-raises the signal with picopilot's handler removed so
 * the default behaviour (terminate) still happens, unless some other listener
 * owns that signal (an MCP server, a test runner), which then decides.
 */

const SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/**
 * The kill functions of every run in flight. ONE listener per event serves them
 * all (installed while the set is non-empty), so many concurrent runs (an MCP
 * server) never trip Node's MaxListeners warning.
 */
const pending = new Set<() => void>();
const signalHandlers = new Map<NodeJS.Signals, () => void>();

function killAll(): void {
	for (const kill of [...pending]) {
		pending.delete(kill);
		try {
			kill();
		} catch {
			// best effort: the process may already be gone
		}
	}
}

function onExit(): void {
	killAll();
}

function install(): void {
	process.on('exit', onExit);
	for (const signal of SIGNALS) {
		const handler = () => {
			killAll();
			uninstall();
			// Re-raise for the default behaviour (terminate) unless another listener
			// (an MCP server, a test runner) owns this signal.
			if (process.listenerCount(signal) === 0) {
				process.kill(process.pid, signal);
			}
		};
		signalHandlers.set(signal, handler);
		process.on(signal, handler);
	}
}

function uninstall(): void {
	process.removeListener('exit', onExit);
	for (const [signal, handler] of signalHandlers) {
		process.removeListener(signal, handler);
	}
	signalHandlers.clear();
}

/** Registers `kill` to run if picopilot exits or is signalled; returns the disposer. */
export function killOnAbort(kill: () => void): () => void {
	let entry: (() => void) | undefined = () => kill();
	if (pending.size === 0) install();
	pending.add(entry);
	return () => {
		if (entry === undefined) return;
		pending.delete(entry);
		entry = undefined;
		if (pending.size === 0) uninstall();
	};
}
