import {readFileSync} from 'node:fs';
import {dirname, isAbsolute, join} from 'node:path';

/**
 * A `#include` resolver for the drive-transform, bound to the SOURCE cart's dir:
 * picopilot's standard scaffold is `main.p8` = `#include main.lua`, and the
 * driven cart runs from a throwaway temp dir where `main.lua` is absent, so the
 * transform inlines includes to be self-contained. Reads the included file
 * relative to the cart (absolute paths honoured); returns `undefined` if it
 * cannot be read (the directive is then left verbatim). Shared by `playtest` and
 * the `--label-frame` capture.
 */
export function makeReadInclude(
	cartPath: string,
): (p: string) => string | undefined {
	const base = dirname(cartPath);
	return (includePath) => {
		const full = isAbsolute(includePath)
			? includePath
			: join(base, includePath);
		try {
			return readFileSync(full, 'utf8');
		} catch {
			return undefined;
		}
	};
}
