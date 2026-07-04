/**
 * The per-cart `picopilot.json` config model: the schema `init` scaffolds from
 * and the later `gfx set` reads `allowMapOverlap` through (via incur's config
 * layer). See `config.ts` for why the shape lives here as one source of truth.
 */
export {
	defaultConfig,
	defaultConfigFile,
	GfxSetOptions,
	PicopilotConfig,
	readAllowMapOverlap,
} from './config.js';
