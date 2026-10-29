import {describe, expect, it} from 'vitest';

import {
	analyzeAudio,
	AudioAnalyzeError,
	decodeWav,
	type DecodedWav,
	encodeWav16,
	percentile,
	sparkline,
} from './analyze.js';

const RATE = 22050;

/** Builds a mono signal from per-second generator `f(t)`. */
function signal(seconds: number, f: (t: number) => number): DecodedWav {
	const samples = new Float32Array(Math.round(seconds * RATE));
	for (let i = 0; i < samples.length; i++) samples[i] = f(i / RATE);
	return {sampleRate: RATE, channels: 1, samples};
}

const sine = (hz: number, amp: number) => (t: number) =>
	amp * Math.sin(2 * Math.PI * hz * t);

/** A deterministic "melody": a new pitch every `noteSeconds`, from a seeded sequence. */
function melody(seed: number, noteSeconds: number) {
	const pitches = [220, 247, 262, 294, 330, 349, 392, 440];
	return (t: number) => {
		const n = Math.floor(t / noteSeconds);
		const x = Math.sin((n + 1) * 12.9898 * seed) * 43758.5453;
		const hz = pitches[Math.floor((x - Math.floor(x)) * pitches.length)]!;
		return 0.1 * Math.sin(2 * Math.PI * hz * t);
	};
}

describe('decodeWav / encodeWav16', () => {
	it('round-trips 16-bit mono PCM', () => {
		const wav = signal(0.5, sine(440, 0.5));
		const back = decodeWav(encodeWav16(wav.samples, RATE));
		expect(back.sampleRate).toBe(RATE);
		expect(back.channels).toBe(1);
		expect(back.samples).toHaveLength(wav.samples.length);
		expect(back.samples[100]).toBeCloseTo(wav.samples[100]!, 3);
	});

	it('downmixes stereo and reads 8-bit', () => {
		// Hand-build a 2-channel 8-bit WAV with 2 frames: (255,1) and (128,128).
		const data = [255, 1, 128, 128];
		const buf = new Uint8Array(44 + data.length);
		const v = new DataView(buf.buffer);
		buf.set(
			[...'RIFF'].map((c) => c.charCodeAt(0)),
			0,
		);
		v.setUint32(4, 36 + data.length, true);
		buf.set(
			[...'WAVEfmt '].map((c) => c.charCodeAt(0)),
			8,
		);
		v.setUint32(16, 16, true);
		v.setUint16(20, 1, true);
		v.setUint16(22, 2, true);
		v.setUint32(24, 8000, true);
		v.setUint32(28, 16000, true);
		v.setUint16(32, 2, true);
		v.setUint16(34, 8, true);
		buf.set(
			[...'data'].map((c) => c.charCodeAt(0)),
			36,
		);
		v.setUint32(40, data.length, true);
		buf.set(data, 44);
		const wav = decodeWav(buf);
		expect(wav.channels).toBe(2);
		expect(wav.samples).toHaveLength(2);
		expect(wav.samples[0]).toBeCloseTo(0, 1); // (+0.99 + -0.99) / 2
		expect(wav.samples[1]).toBe(0);
	});

	it('refuses something that is not a WAV', () => {
		expect(() =>
			decodeWav(new TextEncoder().encode('hello world, not a wav')),
		).toThrow(AudioAnalyzeError);
	});
});

describe('analyzeAudio: loudness, brightness, dynamics', () => {
	it('a steady 440 Hz sine: centroid ~440 Hz, no high energy, flat, and its RMS', () => {
		const a = analyzeAudio(signal(6, sine(440, 0.1)));
		expect(a.skippedSeconds).toBe(1);
		expect(a.analyzedSeconds).toBeCloseTo(5, 1);
		expect(a.loudness.meanRms).toBeCloseTo(0.1 / Math.SQRT2, 2);
		expect(Math.abs(a.brightness.centroidHz - 440)).toBeLessThan(30);
		expect(a.brightness.above2kHzPercent).toBeLessThan(0.1);
		expect(a.dynamicRangeDb).toBeLessThan(0.5);
		const codes = a.warnings.map((w) => w.code);
		expect(codes).toContain('monotonous');
		expect(codes).not.toContain('loud');
		expect(codes).not.toContain('shrill');
	});

	it('a loud, bright square wave is loud and shrill', () => {
		const a = analyzeAudio(
			signal(4, (t) => (Math.sin(2 * Math.PI * 1500 * t) >= 0 ? 0.3 : -0.3)),
		);
		const codes = a.warnings.map((w) => w.code);
		expect(codes).toContain('loud');
		expect(codes).toContain('shrill');
		expect(a.brightness.above2kHzPercent).toBeGreaterThan(8);
	});

	it('the first second (PICO-8 startup) is not measured', () => {
		const a = analyzeAudio(
			signal(4, (t) => (t < 1 ? sine(440, 0.9)(t) : sine(440, 0.05)(t))),
		);
		expect(a.loudness.peakFrameRms).toBeLessThan(0.05);
		expect(
			analyzeAudio(signal(4, sine(440, 0.05)), {skipSeconds: 0}).skippedSeconds,
		).toBe(0);
	});

	it('a short burst over a quiet bed is a spike, located in time', () => {
		const a = analyzeAudio(
			signal(6, (t) =>
				t > 3 && t < 3.3 ? sine(330, 0.5)(t) : sine(330, 0.05)(t),
			),
		);
		expect(a.warnings.map((w) => w.code)).toContain('spikes');
		expect(a.loudness.peakFrameAtSeconds).toBeGreaterThan(2.9);
		expect(a.loudness.peakFrameAtSeconds).toBeLessThan(3.3);
	});

	it('quiet and loud passages give a dynamic range; silence is excluded from it', () => {
		const a = analyzeAudio(
			signal(9, (t) => {
				const phase = Math.floor(t) % 3;
				return phase === 0 ? 0 : sine(330, phase === 1 ? 0.02 : 0.1)(t);
			}),
		);
		expect(a.dynamicRangeDb).toBeGreaterThan(10);
		expect(a.dynamicRangeDb).toBeLessThan(16);
		expect(a.loudness.silentPercent).toBeGreaterThan(20);
	});

	it('near-silence is reported as such (and nothing else)', () => {
		const a = analyzeAudio(signal(3, () => 0));
		expect(a.warnings.map((w) => w.code)).toEqual(['near-silent']);
	});

	it('a loudness profile per half second, with a sparkline', () => {
		const a = analyzeAudio(signal(5, (t) => sine(440, t < 3 ? 0.02 : 0.2)(t)));
		expect(a.profile.stepSeconds).toBe(0.5);
		expect(a.profile.rms).toHaveLength(8);
		expect(a.profile.sparkline).toHaveLength(8);
		expect(a.profile.sparkline.at(-1)).toBe('█');
	});

	it('too short for one frame is a structured error', () => {
		expect(() => analyzeAudio(signal(0.05, sine(440, 0.1)))).toThrow(
			AudioAnalyzeError,
		);
	});
});

describe('analyzeAudio: repetition (loop) length', () => {
	it('finds a 5 s loop repeated three times, and calls it repetitive', () => {
		const loop = melody(7, 0.25);
		const a = analyzeAudio(
			signal(16, (t) => loop(t % 5)),
			{skipSeconds: 0},
		);
		expect(a.loop.seconds).not.toBeNull();
		expect(Math.abs(a.loop.seconds! - 5)).toBeLessThan(0.15);
		expect(a.warnings.map((w) => w.code)).toContain('repetitive');
	});

	it('picks the loop, not a multiple of it', () => {
		const loop = melody(3, 0.2);
		const a = analyzeAudio(
			signal(25, (t) => loop(t % 4)),
			{skipSeconds: 0},
		);
		expect(Math.abs(a.loop.seconds! - 4)).toBeLessThan(0.15);
	});

	it('says why when no repetition is visible', () => {
		const a = analyzeAudio(signal(12, melody(11, 0.25)), {skipSeconds: 0});
		expect(a.loop.seconds).toBeNull();
		expect((a.loop as {reason: string}).reason).toMatch(/at least 2x/);
	});
});

describe('analyzeAudio: against a reference SFX', () => {
	it('reports the music level relative to the SFX and warns when it is not under it', () => {
		const sfx = signal(1, sine(600, 0.2));
		const quiet = analyzeAudio(signal(4, sine(330, 0.05)), {against: sfx});
		expect(quiet.against!.musicOverReferenceDb).toBeLessThan(-10);
		expect(quiet.warnings.map((w) => w.code)).not.toContain('music-over-sfx');
		const loud = analyzeAudio(signal(4, sine(330, 0.2)), {against: sfx});
		expect(loud.warnings.map((w) => w.code)).toContain('music-over-sfx');
	});
});

describe('helpers', () => {
	it('percentile interpolates', () => {
		expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
		expect(percentile([0, 10], 90)).toBe(9);
	});

	it('sparkline scales to the loudest value and blanks silence', () => {
		expect(sparkline([0, 0.5, 1])).toBe(' ▅█');
	});
});

describe('analyzeAudio: review fixes', () => {
	it('a silent --against reference is refused, not a false warning', () => {
		expect(() =>
			analyzeAudio(signal(4, sine(330, 0.05)), {against: signal(1, () => 0)}),
		).toThrow(AudioAnalyzeError);
	});

	it('kind sfx keeps only the checks that apply to a one-shot', () => {
		// A short, loud blip with a silent tail: music rules would flag it.
		const blip = signal(2, (t) => (t < 0.3 ? sine(1500, 0.6)(t) : 0));
		const music = analyzeAudio(blip, {skipSeconds: 0}).warnings.map(
			(w) => w.code,
		);
		expect(music.length).toBeGreaterThan(0);
		const sfx = analyzeAudio(blip, {skipSeconds: 0, kind: 'sfx'}).warnings;
		expect(
			sfx.every((w) => w.code === 'near-silent' || w.code === 'near-clipping'),
		).toBe(true);
	});

	it('a truncated fmt chunk is a structured bad-wav error', () => {
		const ok = encodeWav16(new Float32Array(10), RATE);
		expect(() => decodeWav(ok.slice(0, 24))).toThrow(AudioAnalyzeError);
	});
});
