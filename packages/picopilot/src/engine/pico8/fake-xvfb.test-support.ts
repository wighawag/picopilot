import type {XvfbProcess} from './display.js';

/**
 * Test support (excluded from the build): a controllable fake Xvfb. A test makes
 * it report a display number, write stderr, exit, or fail to spawn, and reads
 * back the signals it received, so virtual-display teardown is provable without
 * a real X server.
 */
export class FakeXvfb implements XvfbProcess {
	readonly pid = 4242;
	signals: string[] = [];
	exited = false;
	args: string[] = [];
	private fdCb: (c: string) => void = () => {};
	private exitCb: (code: number | null) => void = () => {};
	private errorCb: (e: NodeJS.ErrnoException) => void = () => {};
	private stderrCb: (c: string) => void = () => {};
	/** Exit as soon as SIGTERM arrives (a well-behaved server). */
	exitOnTerm = true;

	onDisplayFd(cb: (c: string) => void) {
		this.fdCb = cb;
	}
	onStderr(cb: (c: string) => void) {
		this.stderrCb = cb;
	}
	onExit(cb: (code: number | null) => void) {
		this.exitCb = cb;
	}
	onError(cb: (e: NodeJS.ErrnoException) => void) {
		this.errorCb = cb;
	}
	kill(signal: NodeJS.Signals) {
		this.signals.push(signal);
		if (this.exited) return;
		if (signal === 'SIGKILL' || this.exitOnTerm) this.exit(null);
	}
	// drivers
	reportDisplay(n: number) {
		this.fdCb(`${n}\n`);
	}
	writeStderr(s: string) {
		this.stderrCb(s);
	}
	exit(code: number | null) {
		if (this.exited) return;
		this.exited = true;
		setImmediate(() => this.exitCb(code));
	}
	fail(code: string) {
		const e = new Error(code) as NodeJS.ErrnoException;
		e.code = code;
		this.errorCb(e);
	}
}
