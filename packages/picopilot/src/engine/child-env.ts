/**
 * The environment an external tool (PICO-8, shrinko8) is spawned with: the
 * PARENT environment overlaid with the values a command RESOLVED (incur parses
 * only the keys a command declares, e.g. PICO8_PATH / PATH). Handing the child
 * just that parsed subset strips everything else it needs: DISPLAY, HOME,
 * XDG_RUNTIME_DIR and SDL_* for PICO-8 (ADR-0017), HOME / PYTHONUSERBASE for a
 * `pip install --user` shrinko8. An `undefined` resolved value never erases a
 * parent value.
 *
 * `parent` is a parameter (the command layer defaults it to `process.env`; it is
 * never read here) so tests inject a controlled environment.
 */
export function overlayEnv(
	resolved: Readonly<Record<string, string | undefined>>,
	parent: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {...parent};
	for (const [key, value] of Object.entries(resolved)) {
		if (value !== undefined) env[key] = value;
	}
	return env;
}
