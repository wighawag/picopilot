import {overlayEnv} from '../engine/child-env.js';
import {
	type ChildRunner,
	type ShrinkoAdapter,
	ShellShrinkoAdapter,
} from '../engine/shrinko/index.js';

/**
 * Builds the {@link ShrinkoAdapter} a shrinko-backed command uses, given the
 * incur-resolved env (its `PATH`). A test passes its own factory to swap in a
 * stub adapter (the seam-swap contract).
 */
export type ShrinkoAdapterFactory = (env: NodeJS.ProcessEnv) => ShrinkoAdapter;

/** Dependencies for {@link createShellShrinkoFactory}, injectable for tests. */
export interface ShellShrinkoFactoryDeps {
	/** The parent environment shrinko inherits (defaults to `process.env`). */
	readonly parentEnv?: NodeJS.ProcessEnv;
	/** The child runner (defaults to the real `execFile`). */
	readonly run?: ChildRunner;
}

/**
 * The default shrinko factory: the shell adapter over a user-installed
 * shrinko8, whose child env is the parent env overlaid with the command's
 * resolved `PATH`. shrinko8 is a Python tool, so a `pip install --user` copy is
 * only found when HOME (user site-packages) reaches the child.
 */
export function createShellShrinkoFactory(
	deps: ShellShrinkoFactoryDeps = {},
): ShrinkoAdapterFactory {
	return (env) =>
		new ShellShrinkoAdapter({
			env: overlayEnv(
				env as Record<string, string | undefined>,
				deps.parentEnv ?? process.env,
			),
			run: deps.run,
		});
}
