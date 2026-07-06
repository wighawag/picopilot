import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	encodeFrame,
	FrameDecoder,
	SESSION_BASE_DIRNAME,
	SessionRegistry,
	type SessionRequest,
	type SessionResponse,
} from './supervisor.js';

/**
 * The session SUPERVISOR's pure pieces are CI-tested without a socket or binary
 * (ADR-0011): the id/path registry (so a session can never escape its controlled
 * base) and the newline-JSON frame codec (so the client<->daemon protocol is
 * exact). The live daemon is the manual/opt-in tier.
 */

describe('SessionRegistry: id validation (no path traversal, controlled base)', () => {
	it('accepts filesystem-safe ids', () => {
		for (const id of ['run1', 's-abc123', 'A.b_c-1']) {
			expect(SessionRegistry.validateId(id)).toBe(id);
		}
	});

	it('rejects traversal + unsafe ids (structured throw)', () => {
		for (const bad of ['..', '.', 'a/b', '../etc', 'a b', '', 'x'.repeat(65)]) {
			expect(() => SessionRegistry.validateId(bad)).toThrow();
		}
	});

	it('fresh ids are unique + safe', () => {
		const a = SessionRegistry.freshId();
		const b = SessionRegistry.freshId();
		expect(a).not.toBe(b);
		expect(SessionRegistry.validateId(a)).toBe(a);
	});
});

describe('SessionRegistry: path derivation under a controlled base', () => {
	let base: string;
	beforeEach(() => {
		base = mkdtempSync(join(tmpdir(), 'pp-sess-'));
	});
	afterEach(() => rmSync(base, {recursive: true, force: true}));

	it('resolves a session id to its dir/socket/shots under the base', () => {
		const reg = new SessionRegistry(base);
		const p = reg.resolve('run1');
		expect(p.dir).toBe(join(base, 'run1'));
		expect(p.socket.startsWith(p.dir)).toBe(true);
		expect(p.shotDir.startsWith(p.dir)).toBe(true);
	});

	it('a resolved socket/shotDir NEVER escapes the base (no traversal path)', () => {
		const reg = new SessionRegistry(base);
		expect(() => reg.resolve('../escape')).toThrow();
	});

	it('create makes the dir + shotDir and list/remove round-trip', () => {
		const reg = new SessionRegistry(base);
		reg.create('a');
		reg.create('b');
		expect(reg.list()).toEqual(['a', 'b']);
		reg.remove('a');
		expect(reg.list()).toEqual(['b']);
	});

	it('the default base sits under tmp (never ~/Desktop or the carts root)', () => {
		const reg = new SessionRegistry();
		expect(reg.base).toBe(join(tmpdir(), SESSION_BASE_DIRNAME));
	});
});

describe('the session frame codec (client <-> daemon protocol)', () => {
	it('encodes a request as one newline-terminated JSON frame', () => {
		const req: SessionRequest = {verb: 'step', frames: 30};
		expect(encodeFrame(req)).toBe(`${JSON.stringify(req)}\n`);
	});

	it('decodes whole frames + buffers a partial one across chunks', () => {
		const a: SessionResponse = {
			ok: true,
			value: {id: 'x', frame: 1, alive: true},
		};
		const b: SessionResponse = {ok: false, code: 'e', message: 'boom'};
		const wire = encodeFrame(a) + encodeFrame(b);

		// A single push of the whole stream yields both frames, in order.
		expect(new FrameDecoder<SessionResponse>().push(wire)).toEqual([a, b]);

		// A frame split across two chunks still decodes exactly once (no half frame).
		const dec = new FrameDecoder<SessionResponse>();
		const cut = Math.floor(wire.indexOf('\n') / 2); // mid the FIRST frame
		expect(dec.push(wire.slice(0, cut))).toEqual([]); // no complete frame yet
		expect(dec.push(wire.slice(cut))).toEqual([a, b]); // both complete now
	});

	it('ignores blank lines between frames', () => {
		const dec = new FrameDecoder<SessionRequest>();
		expect(dec.push('\n\n')).toEqual([]);
	});
});
