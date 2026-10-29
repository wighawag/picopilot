/**
 * `engine/audio`: "ears" for a model that cannot hear. Measures a WAV (a
 * `picopilot audio render` / `audio record` capture) and turns the numbers into
 * plain-language warnings: too loud, shrill, monotonous, spiky, repetitive.
 *
 * Pure TypeScript (no Python, no PICO-8): a RIFF/WAVE PCM reader, a radix-2
 * FFT, and frame statistics. The thresholds are CALIBRATED on the conquest
 * dogfood (finding `pico8-audio-music-taste-and-analysis`): a soundtrack the
 * user called shrill and grating, one called "far too violent", and the two
 * accepted ones, all measured this way.
 *
 * Measures are over the recording minus its first `skipSeconds` (default 1 s,
 * as in the calibration: the cart's own startup for `audio record`, a song's
 * first notes for `audio render`; an SFX render skips nothing), in
 * non-overlapping frames of {@link FRAME_SIZE} samples.
 */

/** Samples per analysis frame (93 ms at PICO-8's 22050 Hz). */
export const FRAME_SIZE = 2048;

/** A frame quieter than this RMS (about -50 dBFS) counts as silence. */
export const SILENCE_RMS = 0.003;

/** The loudness-profile step, in seconds. */
export const PROFILE_STEP_SECONDS = 0.5;

/**
 * The warning thresholds (documented in the picopilot-audio skill and the
 * finding). Calibration, mean RMS / centroid / energy above 2 kHz / dynamic
 * range / loop:
 * - shrill, grating first track: 0.156 / 1286 Hz / 13.2 % / 1.9 dB / ~15 s;
 * - "far too violent": 0.195 / 612 Hz / 3.1 %;
 * - accepted title: 0.097 / 459 Hz / 0.2 % / 7 dB;
 * - accepted in-game: 0.069 / 378 Hz / - / 8 dB / ~64 s.
 */
export const THRESHOLDS = {
	/** Mean frame RMS above this: too loud for music under SFX. */
	loudMeanRms: 0.12,
	/** Mean frame RMS below this: (nearly) nothing was captured. */
	quietMeanRms: 0.01,
	/** Median spectral centroid above this (Hz): shrill. */
	shrillCentroidHz: 900,
	/** Median spectral centroid above this (Hz): on the bright side. */
	brightCentroidHz: 550,
	/** Share of energy above 2 kHz above this (%): shrill. */
	shrillAbove2kHzPercent: 8,
	/** Share of energy above 2 kHz above this (%): on the bright side. */
	brightAbove2kHzPercent: 2,
	/** Dynamic range (p90 - p10 frame level) below this (dB): monotonous. */
	flatRangeDb: 4,
	/** Loudest frame over the median frame above this ratio: spikes. */
	spikeRatio: 3,
	/** 99.9th-percentile absolute sample above this: close to clipping. */
	clipSample: 0.9,
	/** A detected loop shorter than this (s): repetitive. */
	shortLoopSeconds: 20,
	/** Music louder than this relative to the reference SFX (dB): SFX get buried. */
	musicOverSfxDb: -3,
} as const;

/** A decoded WAV: mono samples in [-1, 1]. */
export interface DecodedWav {
	sampleRate: number;
	channels: number;
	samples: Float32Array;
}

/** A structured analysis failure. */
export class AudioAnalyzeError extends Error {
	readonly code: 'audio-analyze-bad-wav' | 'audio-analyze-too-short';
	constructor(code: AudioAnalyzeError['code'], message: string) {
		super(message);
		this.name = 'AudioAnalyzeError';
		this.code = code;
	}
}

/** One plain-language finding about the recording. */
export interface AnalysisWarning {
	code:
		| 'loud'
		| 'near-silent'
		| 'shrill'
		| 'bright'
		| 'monotonous'
		| 'spikes'
		| 'near-clipping'
		| 'repetitive'
		| 'music-over-sfx';
	message: string;
}

/** The analysis of one recording. */
export interface AudioAnalysis {
	sampleRate: number;
	/** Length of the whole file, in seconds. */
	durationSeconds: number;
	/** Seconds skipped at the start (PICO-8 startup). */
	skippedSeconds: number;
	/** Seconds actually analysed. */
	analyzedSeconds: number;
	loudness: {
		/** Mean RMS of the 2048-sample frames (0..1). */
		meanRms: number;
		/** Median frame RMS. */
		medianRms: number;
		/** The loudest frame's RMS. */
		peakFrameRms: number;
		/** When the loudest frame starts, in seconds from the start of the file. */
		peakFrameAtSeconds: number;
		/** The 99.9th-percentile absolute sample (0..1). */
		peakSample: number;
		/** Share of frames that are silence (%). */
		silentPercent: number;
	};
	brightness: {
		/** Median energy-weighted spectral centroid of the non-silent frames (Hz). */
		centroidHz: number;
		/** Share of spectral energy above 2 kHz (%). */
		above2kHzPercent: number;
	};
	/** p90 minus p10 of the non-silent frames' level (dB). */
	dynamicRangeDb: number;
	profile: {
		stepSeconds: number;
		/** RMS per step. */
		rms: number[];
		/** The same, as a one-line bar chart (relative to the loudest step). */
		sparkline: string;
	};
	/** The repetition (loop) length, when one is detectable. */
	loop: {seconds: number; confidence: number} | {seconds: null; reason: string};
	/** Loudness against a reference SFX recording (`--against`). */
	against?: {
		/** The reference's mean RMS over its non-silent frames. */
		referenceRms: number;
		/** 20*log10(music meanRms / referenceRms): below 0 = the music is quieter. */
		musicOverReferenceDb: number;
	};
	warnings: AnalysisWarning[];
}

/**
 * Decodes a RIFF/WAVE file (PCM 8/16/24/32-bit integer or 32-bit float, any
 * channel count; channels are averaged to mono).
 *
 * @throws {AudioAnalyzeError} `audio-analyze-bad-wav`.
 */
export function decodeWav(bytes: Uint8Array): DecodedWav {
	const bad = (why: string) =>
		new AudioAnalyzeError(
			'audio-analyze-bad-wav',
			`not a readable WAV: ${why}.`,
		);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const tag = (at: number) =>
		String.fromCharCode(
			bytes[at]!,
			bytes[at + 1]!,
			bytes[at + 2]!,
			bytes[at + 3]!,
		);
	if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
		throw bad('missing the RIFF/WAVE header');
	}
	let format: number | undefined;
	let channels = 0;
	let sampleRate = 0;
	let bits = 0;
	let data: {at: number; len: number} | undefined;
	for (let at = 12; at + 8 <= bytes.length;) {
		const id = tag(at);
		const size = view.getUint32(at + 4, true);
		const body = at + 8;
		if (id === 'fmt ') {
			if (size < 16 || body + 16 > bytes.length)
				throw bad('truncated fmt chunk');
			format = view.getUint16(body, true);
			channels = view.getUint16(body + 2, true);
			sampleRate = view.getUint32(body + 4, true);
			bits = view.getUint16(body + 14, true);
			if (format === 0xfffe && size >= 26)
				format = view.getUint16(body + 24, true);
		} else if (id === 'data') {
			data = {at: body, len: Math.min(size, bytes.length - body)};
		}
		at = body + size + (size % 2);
	}
	if (format === undefined) throw bad('no fmt chunk');
	if (data === undefined) throw bad('no data chunk');
	if (channels < 1 || sampleRate < 1)
		throw bad('bad channel count or sample rate');
	const isFloat = format === 3 && bits === 32;
	if (!(format === 1 && [8, 16, 24, 32].includes(bits)) && !isFloat) {
		throw bad(`unsupported encoding (format ${format}, ${bits} bits)`);
	}
	const bytesPer = bits / 8;
	const frames = Math.floor(data.len / (bytesPer * channels));
	const samples = new Float32Array(frames);
	for (let i = 0; i < frames; i++) {
		let sum = 0;
		for (let c = 0; c < channels; c++) {
			const p = data.at + (i * channels + c) * bytesPer;
			let v: number;
			if (isFloat) v = view.getFloat32(p, true);
			else if (bits === 8) v = (bytes[p]! - 128) / 128;
			else if (bits === 16) v = view.getInt16(p, true) / 32768;
			else if (bits === 24) {
				const raw = bytes[p]! | (bytes[p + 1]! << 8) | (bytes[p + 2]! << 16);
				v = ((raw << 8) >> 8) / 8388608;
			} else v = view.getInt32(p, true) / 2147483648;
			sum += v;
		}
		samples[i] = sum / channels;
	}
	return {sampleRate, channels, samples};
}

/** Encodes mono samples in [-1, 1] as a 16-bit PCM WAV (fixtures, tests). */
export function encodeWav16(
	samples: Float32Array,
	sampleRate: number,
): Uint8Array {
	const buf = new Uint8Array(44 + samples.length * 2);
	const v = new DataView(buf.buffer);
	const put = (at: number, s: string) => {
		for (let i = 0; i < s.length; i++) buf[at + i] = s.charCodeAt(i);
	};
	put(0, 'RIFF');
	v.setUint32(4, 36 + samples.length * 2, true);
	put(8, 'WAVEfmt ');
	v.setUint32(16, 16, true);
	v.setUint16(20, 1, true);
	v.setUint16(22, 1, true);
	v.setUint32(24, sampleRate, true);
	v.setUint32(28, sampleRate * 2, true);
	v.setUint16(32, 2, true);
	v.setUint16(34, 16, true);
	put(36, 'data');
	v.setUint32(40, samples.length * 2, true);
	for (let i = 0; i < samples.length; i++) {
		const c = Math.max(-1, Math.min(1, samples[i]!));
		v.setInt16(44 + i * 2, Math.round(c * 32767), true);
	}
	return buf;
}

/** In-place iterative radix-2 FFT over `re`/`im` (length a power of two). */
function fft(re: Float64Array, im: Float64Array): void {
	const n = re.length;
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			[re[i], re[j]] = [re[j]!, re[i]!];
			[im[i], im[j]] = [im[j]!, im[i]!];
		}
	}
	for (let len = 2; len <= n; len <<= 1) {
		const ang = (-2 * Math.PI) / len;
		const wr = Math.cos(ang);
		const wi = Math.sin(ang);
		for (let i = 0; i < n; i += len) {
			let cr = 1;
			let ci = 0;
			for (let k = 0; k < len / 2; k++) {
				const a = i + k;
				const b = a + len / 2;
				const tr = re[b]! * cr - im[b]! * ci;
				const ti = re[b]! * ci + im[b]! * cr;
				re[b] = re[a]! - tr;
				im[b] = im[a]! - ti;
				re[a] = re[a]! + tr;
				im[a] = im[a]! + ti;
				const ncr = cr * wr - ci * wi;
				ci = cr * wi + ci * wr;
				cr = ncr;
			}
		}
	}
}

/** The p-th percentile (0..100) of a numeric array (linear interpolation). */
export function percentile(values: ArrayLike<number>, p: number): number {
	if (values.length === 0) return 0;
	const sorted = Float64Array.from(values).sort();
	const pos = (p / 100) * (sorted.length - 1);
	const lo = Math.floor(pos);
	const hi = Math.ceil(pos);
	return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Per-frame spectral data computed once and shared by every measure. */
interface FrameStats {
	rms: number[];
	centroid: number[];
	lowEnergy: number;
	highEnergy: number;
}

/** Hann-windowed spectra of consecutive frames of `size` samples, `hop` apart. */
function* spectra(
	samples: Float32Array,
	size: number,
	hop: number,
): Generator<{start: number; rms: number; power: Float64Array}> {
	const win = new Float64Array(size);
	for (let i = 0; i < size; i++)
		win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
	const re = new Float64Array(size);
	const im = new Float64Array(size);
	const power = new Float64Array(size / 2 + 1);
	for (let start = 0; start + size <= samples.length; start += hop) {
		let sq = 0;
		for (let i = 0; i < size; i++) {
			const v = samples[start + i]!;
			sq += v * v;
			re[i] = v * win[i]!;
			im[i] = 0;
		}
		fft(re, im);
		for (let k = 0; k <= size / 2; k++)
			power[k] = re[k]! * re[k]! + im[k]! * im[k]!;
		yield {start, rms: Math.sqrt(sq / size), power};
	}
}

/** RMS, centroid and the energy split of every analysis frame. */
function frameStats(samples: Float32Array, sampleRate: number): FrameStats {
	const binHz = sampleRate / FRAME_SIZE;
	const out: FrameStats = {rms: [], centroid: [], lowEnergy: 0, highEnergy: 0};
	for (const {rms, power} of spectra(samples, FRAME_SIZE, FRAME_SIZE)) {
		out.rms.push(rms);
		// The ENERGY-weighted centroid (power, not magnitude): magnitude
		// weighting lets the long low-level tail of a PICO-8 spectrum dominate
		// (it read 3.6 kHz for a track whose energy centroid is 1.3 kHz).
		let energy = 0;
		let weighted = 0;
		// Bin 0 (DC) is inaudible and left out of every measure.
		for (let k = 1; k < power.length; k++) {
			energy += power[k]!;
			weighted += power[k]! * k * binHz;
			if (k * binHz > 2000) out.highEnergy += power[k]!;
			else out.lowEnergy += power[k]!;
		}
		out.centroid.push(energy > 0 ? weighted / energy : 0);
	}
	return out;
}

/** Log-spaced band energies per frame, for repetition detection. */
function bandFeatures(
	samples: Float32Array,
	sampleRate: number,
	hop: number,
): Float64Array[] {
	const bands = 24;
	const lo = 60;
	const hi = Math.min(8000, sampleRate / 2);
	const binHz = sampleRate / FRAME_SIZE;
	const edges: number[] = [];
	for (let b = 0; b <= bands; b++) {
		edges.push(Math.round((lo * (hi / lo) ** (b / bands)) / binHz));
	}
	const out: Float64Array[] = [];
	for (const {power} of spectra(samples, FRAME_SIZE, hop)) {
		const f = new Float64Array(bands);
		for (let b = 0; b < bands; b++) {
			let e = 0;
			for (let k = edges[b]!; k < Math.max(edges[b]! + 1, edges[b + 1]!); k++)
				e += power[k] ?? 0;
			f[b] = Math.log10(1e-6 + e);
		}
		out.push(f);
	}
	return out;
}

/**
 * The repetition (loop) length: the smallest lag at which the spectral feature
 * sequence matches itself almost as well as at its best lag. Needs the loop to
 * fit at least twice in the analysed audio.
 */
function detectLoop(
	samples: Float32Array,
	sampleRate: number,
): AudioAnalysis['loop'] {
	const hop = FRAME_SIZE / 2;
	const hopSeconds = hop / sampleRate;
	const feats = bandFeatures(samples, sampleRate, hop);
	const n = feats.length;
	const minLag = Math.max(1, Math.round(1 / hopSeconds));
	const maxLag = Math.floor(n / 2);
	const analysed = round((n * hop) / sampleRate, 1);
	if (maxLag <= minLag) {
		return {
			seconds: null,
			reason: `the recording (${analysed} s) is too short to see a repetition.`,
		};
	}
	const dist: number[] = [];
	for (let lag = minLag; lag <= maxLag; lag++) {
		let sum = 0;
		const count = n - lag;
		for (let i = 0; i < count; i++) {
			const a = feats[i]!;
			const b = feats[i + lag]!;
			for (let k = 0; k < a.length; k++) sum += Math.abs(a[k]! - b[k]!);
		}
		dist.push(sum / count);
	}
	const median = percentile(dist, 50);
	const best = Math.min(...dist);
	if (median <= 0 || best > LOOP_MAX_DISTANCE_RATIO * median) {
		return {
			seconds: null,
			reason: `no clear repetition within ${analysed} s. A loop is only detectable when the recording holds it at least twice: record at least 2x the expected loop length.`,
		};
	}
	// The smallest lag nearly as good as the best (a loop also matches at 2x, 3x).
	const accept = best + 0.15 * (median - best);
	let idx = dist.findIndex((d) => d <= accept);
	// Settle on the local minimum around that first acceptable lag.
	while (idx + 1 < dist.length && dist[idx + 1]! < dist[idx]!) idx++;
	const lag = minLag + idx;
	return {
		seconds: round(lag * hopSeconds, 1),
		confidence: round(1 - dist[idx]! / median, 2),
	};
}

/**
 * A lag counts as a repetition when its spectral distance is at most this
 * fraction of the median distance over all lags. A PICO-8 loop is exact, so it
 * lands well under it (0.1-0.25 with frame misalignment); a sequence of notes
 * that merely reuses pitches stays around 0.5.
 */
const LOOP_MAX_DISTANCE_RATIO = 0.35;

/** Rounds to `digits` decimals. */
function round(n: number, digits: number): number {
	const f = 10 ** digits;
	return Math.round(n * f) / f;
}

/** A one-line bar chart of non-negative values (blank = silence). */
export function sparkline(values: readonly number[]): string {
	const bars = '▁▂▃▄▅▆▇█';
	const max = Math.max(0, ...values);
	return values
		.map((v) => {
			if (v < SILENCE_RMS || max === 0) return ' ';
			return bars[
				Math.min(bars.length - 1, Math.floor((v / max) * bars.length))
			]!;
		})
		.join('');
}

/** The analysis options. */
export interface AnalyzeOptions {
	/** Seconds to skip at the start (as the calibration did). Default 1. */
	skipSeconds?: number;
	/** A reference SFX recording to compare the music's loudness against. */
	against?: DecodedWav;
	/**
	 * What the recording is. `music` (default) applies every warning; `sfx` (a
	 * short one-shot with a silent tail) keeps only near-silent and
	 * near-clipping, since the music thresholds (loudness, dynamics, spikes,
	 * repetition) do not apply to a one-shot sound.
	 */
	kind?: 'music' | 'sfx';
}

/**
 * Analyses a decoded recording. Skips `skipSeconds` (default 1) unless the
 * recording is too short for it (then nothing is skipped and the report says
 * so via `skippedSeconds: 0`).
 *
 * @throws {AudioAnalyzeError} `audio-analyze-too-short` (under one frame).
 */
export function analyzeAudio(
	wav: DecodedWav,
	options: AnalyzeOptions = {},
): AudioAnalysis {
	const {sampleRate} = wav;
	const durationSeconds = wav.samples.length / sampleRate;
	let skip = options.skipSeconds ?? 1;
	if (wav.samples.length - Math.round(skip * sampleRate) < FRAME_SIZE * 4)
		skip = 0;
	const samples = wav.samples.subarray(Math.round(skip * sampleRate));
	if (samples.length < FRAME_SIZE) {
		throw new AudioAnalyzeError(
			'audio-analyze-too-short',
			`the recording is ${round(durationSeconds, 2)} s, shorter than one ${FRAME_SIZE}-sample analysis frame.`,
		);
	}

	const stats = frameStats(samples, sampleRate);
	const frameSeconds = FRAME_SIZE / sampleRate;
	const meanRms = stats.rms.reduce((a, b) => a + b, 0) / stats.rms.length;
	const medianRms = percentile(stats.rms, 50);
	let peakIdx = 0;
	stats.rms.forEach((r, i) => {
		if (r > stats.rms[peakIdx]!) peakIdx = i;
	});
	const abs = new Float32Array(samples.length);
	for (let i = 0; i < samples.length; i++) abs[i] = Math.abs(samples[i]!);
	const peakSample = percentile(abs, 99.9);

	const voiced = stats.rms
		.map((r, i) => ({r, c: stats.centroid[i]!}))
		.filter((f) => f.r >= SILENCE_RMS);
	const silentPercent =
		(100 * (stats.rms.length - voiced.length)) / stats.rms.length;
	const centroidHz = percentile(
		voiced.map((f) => f.c),
		50,
	);
	const total = stats.lowEnergy + stats.highEnergy;
	const above2kHzPercent = total > 0 ? (100 * stats.highEnergy) / total : 0;
	const db = voiced.map((f) => 20 * Math.log10(f.r));
	const dynamicRangeDb =
		db.length > 0 ? percentile(db, 90) - percentile(db, 10) : 0;

	const stepSamples = Math.round(PROFILE_STEP_SECONDS * sampleRate);
	const profileRms: number[] = [];
	for (let s = 0; s + stepSamples / 2 <= samples.length; s += stepSamples) {
		let sq = 0;
		const end = Math.min(samples.length, s + stepSamples);
		for (let i = s; i < end; i++) sq += samples[i]! * samples[i]!;
		profileRms.push(round(Math.sqrt(sq / (end - s)), 3));
	}

	const loop = detectLoop(samples, sampleRate);

	const analysis: AudioAnalysis = {
		sampleRate,
		durationSeconds: round(durationSeconds, 2),
		skippedSeconds: skip,
		analyzedSeconds: round(samples.length / sampleRate, 2),
		loudness: {
			meanRms: round(meanRms, 3),
			medianRms: round(medianRms, 3),
			peakFrameRms: round(stats.rms[peakIdx]!, 3),
			peakFrameAtSeconds: round(skip + peakIdx * frameSeconds, 2),
			peakSample: round(peakSample, 3),
			silentPercent: round(silentPercent, 1),
		},
		brightness: {
			centroidHz: Math.round(centroidHz),
			above2kHzPercent: round(above2kHzPercent, 1),
		},
		dynamicRangeDb: round(dynamicRangeDb, 1),
		profile: {
			stepSeconds: PROFILE_STEP_SECONDS,
			rms: profileRms,
			sparkline: sparkline(profileRms),
		},
		loop,
		warnings: [],
	};

	if (options.against !== undefined) {
		const ref = frameStats(
			options.against.samples,
			options.against.sampleRate,
		).rms.filter((r) => r >= SILENCE_RMS);
		const referenceRms =
			ref.length > 0 ? ref.reduce((a, b) => a + b, 0) / ref.length : 0;
		if (referenceRms === 0 || meanRms === 0) {
			throw new AudioAnalyzeError(
				'audio-analyze-bad-wav',
				'the --against reference is silent: render an SFX that actually plays (e.g. `audio render --sfx <slot>`).',
			);
		}
		analysis.against = {
			referenceRms: round(referenceRms, 3),
			musicOverReferenceDb: round(20 * Math.log10(meanRms / referenceRms), 1),
		};
	}

	analysis.warnings =
		options.kind === 'sfx'
			? warningsFor(analysis).filter(
					(w) => w.code === 'near-silent' || w.code === 'near-clipping',
				)
			: warningsFor(analysis);
	return analysis;
}

/** The plain-language warnings for an analysis (see {@link THRESHOLDS}). */
export function warningsFor(a: AudioAnalysis): AnalysisWarning[] {
	const t = THRESHOLDS;
	const w: AnalysisWarning[] = [];
	const {meanRms, peakFrameRms, medianRms, peakSample, peakFrameAtSeconds} =
		a.loudness;
	const {centroidHz, above2kHzPercent} = a.brightness;
	if (meanRms < t.quietMeanRms) {
		w.push({
			code: 'near-silent',
			message: `Nearly silent (mean RMS ${meanRms}). Check that the target actually plays: the right pattern/SFX, channels not all off, volumes above 0.`,
		});
		return w;
	}
	if (meanRms > t.loudMeanRms) {
		w.push({
			code: 'loud',
			message: `Loud: mean RMS ${meanRms} (accepted game music measured 0.07 to 0.10; over ${t.loudMeanRms} reads as aggressive and leaves no room for SFX). Lower music volumes to mostly v1-v2 with v3 only on attacks, and soften drums (noise / drop-kick at high volume).`,
		});
	}
	if (
		centroidHz > t.shrillCentroidHz ||
		above2kHzPercent > t.shrillAbove2kHzPercent
	) {
		w.push({
			code: 'shrill',
			message: `Shrill: median brightness ${centroidHz} Hz, ${above2kHzPercent}% of energy above 2 kHz (accepted music: under 500 Hz and about 0.2%). Move the lead to o3 or below and the bass to o1, use triangle (@0) or a dampened organ (@5) instead of square/pulse/saw, and add !dampen.`,
		});
	} else if (
		centroidHz > t.brightCentroidHz ||
		above2kHzPercent > t.brightAbove2kHzPercent
	) {
		w.push({
			code: 'bright',
			message: `On the bright side: ${centroidHz} Hz, ${above2kHzPercent}% above 2 kHz (accepted music: under 500 Hz, about 0.2%). Consider softer waveforms (@0, @5), !dampen, or a lower register.`,
		});
	}
	if (a.dynamicRangeDb < t.flatRangeDb) {
		w.push({
			code: 'monotonous',
			message: `Monotonous: only ${a.dynamicRangeDb} dB between quiet and loud passages (accepted music: 7-8 dB). Vary density and volume: leave rests, shape notes with v[...] envelopes, thin the arrangement in some bars.`,
		});
	}
	if (medianRms > 0 && peakFrameRms / medianRms > t.spikeRatio) {
		w.push({
			code: 'spikes',
			message: `Loudness spikes: the loudest moment (${peakFrameRms} at ${peakFrameAtSeconds} s) is ${round(peakFrameRms / medianRms, 1)}x the median. Often unison notes on several channels summing up: drop one voice's volume or move it an octave or a chord tone away.`,
		});
	}
	if (peakSample > t.clipSample) {
		w.push({
			code: 'near-clipping',
			message: `Near clipping: 99.9th-percentile sample ${peakSample}. Lower the volumes.`,
		});
	}
	if (a.loop.seconds !== null && a.loop.seconds < t.shortLoopSeconds) {
		w.push({
			code: 'repetitive',
			message: `Repetitive: the audio repeats every ${a.loop.seconds} s. Background music that loops in under ${t.shortLoopSeconds} s grates fast; aim for about a minute, with sections and a melody that only appears in some bars.`,
		});
	}
	if (
		a.against !== undefined &&
		a.against.musicOverReferenceDb > t.musicOverSfxDb
	) {
		w.push({
			code: 'music-over-sfx',
			message: `The music is ${a.against.musicOverReferenceDb} dB relative to the reference SFX (want at most ${t.musicOverSfxDb} dB): the SFX will not stand out. Lower the music volumes or raise the SFX.`,
		});
	}
	return w;
}
