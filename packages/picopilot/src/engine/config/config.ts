import {z} from 'incur';

/**
 * The per-cart `picopilot.json` config, US #10.
 *
 * picopilot's config is incur's built-in `config: { files: ['picopilot.json'] }`
 * mechanism (declared in `createCli`): a JSON file whose values become option
 * DEFAULTS for the matching command, with precedence `argv > config > zod
 * defaults`. incur keys config by command path, a command's options live under
 * `commands.<group>.commands.<name>.options.<key>`, so a policy an agent sets
 * once (like `allowMapOverlap`) is stored where the command that reads it looks.
 *
 * This module is the single source of truth for the config SHAPE: `init`
 * scaffolds a file from {@link defaultConfigFile}, and the later `gfx set`
 * command reads `allowMapOverlap` through incur's config layer (its own
 * `--allow-map-overlap` option default). Keeping the shape here, rather than
 * inlining a blob in `init`, means the scaffolded file and the reader cannot
 * drift.
 */

/**
 * The `gfx set` options that `picopilot.json` may set as defaults.
 *
 * `allowMapOverlap` authorises `gfx set` to write sprites 128-255 even when the
 * overlapping `__map__` rows hold real tiles (see ADR-0004). It is a rarely /
 * once-set PROJECT setting: OFF by default (the smart-refuse is the safety), so
 * a fresh cart never silently loses map data. The matching invocation flag is
 * `--allow-map-overlap`; `argv > config > default` means the flag always wins.
 */
export const GfxSetOptions = z.object({
	allowMapOverlap: z
		.boolean()
		.default(false)
		.describe(
			'Authorise `gfx set` to overwrite __map__ tiles that alias sprites 128-255 (ADR-0004). Off by default; the smart-refuse is the safety.',
		),
});

/**
 * The full `picopilot.json` document shape, mirroring incur's config tree
 * (`commands.<path>.options`). Only the keys picopilot actually reads are
 * modelled; the schema is `.strict()`-free on purpose so a human/agent may add
 * config for commands this version does not yet know about without a parse
 * failure.
 */
export const PicopilotConfig = z.object({
	$schema: z.string().optional().describe('JSON Schema reference (optional).'),
	commands: z
		.object({
			gfx: z
				.object({
					commands: z
						.object({
							set: z
								.object({
									options: GfxSetOptions.partial().optional(),
								})
								.optional(),
						})
						.optional(),
				})
				.optional(),
		})
		.optional()
		.describe(
			'Per-command option defaults, keyed by command path (incur config layout).',
		),
});

export type PicopilotConfig = z.infer<typeof PicopilotConfig>;

/**
 * The default `picopilot.json` written by `init`: valid, minimal, and
 * self-documenting via `$schema`. It sets `allowMapOverlap: false` explicitly
 * so the one policy knob an agent is likely to flip is visible in the file (an
 * agent is FREE to read/write this to match a higher-level instruction, US #10)
 * rather than hidden behind a zod default.
 */
export const defaultConfig: PicopilotConfig = {
	$schema: './picopilot.schema.json',
	commands: {
		gfx: {
			commands: {
				set: {
					options: {
						allowMapOverlap: false,
					},
				},
			},
		},
	},
};

/** The default `picopilot.json` serialized as it is written to disk (trailing newline). */
export function defaultConfigFile(): string {
	return `${JSON.stringify(defaultConfig, null, 2)}\n`;
}

/**
 * Reads `allowMapOverlap` out of a parsed `picopilot.json` tree, tolerating a
 * partially-shaped or absent config. Returns `false` when the key is missing or
 * the file is malformed enough that the value cannot be found, the SAFE default
 * (the smart-refuse still guards the genuine data-loss corner).
 *
 * `gfx set` normally gets this value through incur's config → option-default
 * layer; this helper exists for callers that hold a raw config object (and to
 * keep the "where allowMapOverlap lives" knowledge in one place).
 */
export function readAllowMapOverlap(config: unknown): boolean {
	const parsed = PicopilotConfig.safeParse(config);
	if (!parsed.success) return false;
	return (
		parsed.data.commands?.gfx?.commands?.set?.options?.allowMapOverlap ?? false
	);
}
