import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * The installed picopilot version, read from the package manifest at load time.
 *
 * Single source of truth: the version lives only in `package.json`. The manifest
 * sits one level above the compiled module (`dist/version.js` → `package.json`)
 * and one level above the source module (`src/version.ts` → `package.json`), so
 * the same relative lookup works for both the built binary and `tsx` dev runs.
 */
function readVersion(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	const manifestPath = join(here, '..', 'package.json');
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
		version?: string;
	};
	return manifest.version ?? '0.0.0';
}

export const VERSION = readVersion();
