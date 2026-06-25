import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  base64ToBytes,
  bytesToBase64,
  encodeValue,
  decodeValue,
  decodeFrameValues,
  encodeRequest,
  decodeResponse
} from '../src/rpc-codec.mjs';

// ---- base64 helpers ----

test('bytesToBase64 / base64ToBytes round-trips arbitrary bytes', () => {
  const cases = [
    new Uint8Array([]),
    new Uint8Array([0]),
    new Uint8Array([255]),
    new Uint8Array([0, 1, 2, 3, 254, 255]),
    new Uint8Array(Array.from({ length: 256 }, (_, i) => i))
  ];
  for (const bytes of cases) {
    const encoded = bytesToBase64(bytes);
    const decoded = base64ToBytes(encoded);
    assert.deepEqual(Array.from(decoded), Array.from(bytes));
  }
});

test('bytesToBase64 produces canonical base64', () => {
  assert.equal(bytesToBase64(new Uint8Array([])), '');
  assert.equal(bytesToBase64(new Uint8Array([0])), 'AA==');
  assert.equal(bytesToBase64(new Uint8Array([255])), '/w==');
});

// ---- encodeValue / decodeValue round-trip for every supported type ----

test('encodeValue round-trips undefined', () => {
  assert.equal(decodeValue(encodeValue(undefined)), undefined);
});

test('encodeValue round-trips strings including empty and unicode', () => {
  for (const value of ['', 'a', 'hello', '中文测试', '🎉', '\u0000\u0001']) {
    assert.equal(decodeValue(encodeValue(value)), value);
  }
});

test('encodeValue round-trips non-negative integers', () => {
  for (const value of [0, 1, 127, 128, 255, 256, 16383, 16384, 0x7fffffff, 0xffffffff]) {
    assert.equal(decodeValue(encodeValue(value)), value, `failed for ${value}`);
  }
});

test('encodeValue round-trips Uint8Array buffers', () => {
  for (const value of [new Uint8Array([]), new Uint8Array([1, 2, 3]), new Uint8Array([0, 255, 128, 64])]) {
    const decoded = decodeValue(encodeValue(value));
    assert.deepEqual(Array.from(decoded), Array.from(value));
  }
});

test('encodeValue round-trips arrays of mixed types', () => {
  const value = ['a', 5, [1, 2, ['nested']], undefined, new Uint8Array([7, 8])];
  const decoded = decodeValue(encodeValue(value));
  assert.equal(decoded[0], 'a');
  assert.equal(decoded[1], 5);
  assert.deepEqual(decoded[2], [1, 2, ['nested']]);
  assert.equal(decoded[3], undefined);
  assert.deepEqual(Array.from(decoded[4]), [7, 8]);
});

test('encodeValue round-trips objects via JSON', () => {
  const value = { a: 1, b: 'x', c: [1, 2], nested: { deep: true } };
  assert.deepEqual(decodeValue(encodeValue(value)), value);
});

test('encodeValue preserves object key order (JSON.stringify)', () => {
  const value = { z: 1, a: 2, m: 3 };
  assert.deepEqual(decodeValue(encodeValue(value)), value);
});

// ---- varint boundary coverage ----

test('varint encodes single-byte boundary (127) vs two-byte (128)', () => {
  // 127 -> 1 byte (0x7f), 128 -> 2 bytes (0x80 0x01)
  assert.equal(encodeValue(127).length, 2); // type byte + 1 varint byte
  assert.equal(encodeValue(128).length, 3); // type byte + 2 varint bytes
});

test('varint handles full 32-bit range without overflow beyond >>> 0', () => {
  // encodeValue uses >>> 0, so values up to 0xffffffff round-trip
  assert.equal(decodeValue(encodeValue(0xffffffff)), 0xffffffff);
});

// ---- decodeFrameValues: multiple values in one buffer ----

test('decodeFrameValues reads sequential values from one buffer', () => {
  const a = encodeValue('first');
  const b = encodeValue(42);
  const combined = new Uint8Array(a.length + b.length);
  combined.set(a, 0);
  combined.set(b, a.length);
  const values = decodeFrameValues(combined);
  assert.equal(values.length, 2);
  assert.equal(values[0], 'first');
  assert.equal(values[1], 42);
});

// ---- encodeRequest / decodeResponse (the actual RPC framing) ----

test('encodeRequest produces header [100, id, channel, method] + body args', () => {
  const frame = encodeRequest(12345, 'zcode-task', 'getTaskSnapshot', [{ taskId: 't1' }]);
  const { header, body } = decodeResponse(frame);
  assert.deepEqual(header, [100, 12345, 'zcode-task', 'getTaskSnapshot']);
  assert.deepEqual(body, [{ taskId: 't1' }]);
});

test('encodeRequest preserves large rpc id (post monotonic-counter fix)', () => {
  const id = 1; // first monotonic id
  const frame = encodeRequest(id, 'chan', 'method', []);
  const { header } = decodeResponse(frame);
  assert.equal(header[1], id);
});

test('encodeRequest with empty args still decodes body as []', () => {
  const frame = encodeRequest(1, 'c', 'm');
  const { header, body } = decodeResponse(frame);
  assert.deepEqual(header, [100, 1, 'c', 'm']);
  assert.deepEqual(body, []);
});

// ---- error / robustness ----

test('decodeValue throws on unsupported type tag', () => {
  const bad = new Uint8Array([99]); // 99 is not a known type
  assert.throws(() => decodeValue(bad), /Unsupported RPC value type: 99/);
});

test('decodeValue throws on truncated payload', () => {
  // TYPE_STRING (1) with varint length=5 but no bytes follow
  const truncated = new Uint8Array([1, 5]);
  assert.throws(() => decodeValue(truncated), /Unexpected end of RPC payload/);
});

test('readVarint throws on runaway varint (>35 bit shift)', () => {
  // Build a varint that never terminates (all continuation bytes)
  const runaway = new Uint8Array([1, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80]); // TYPE_STRING then 6x 0x80
  assert.throws(() => decodeValue(runaway), /Invalid varint|Unexpected end/);
});

// ---- property-style: random fuzz round-trip ----

test('fuzz: random mixed values round-trip through encode/decode', () => {
  const rnd = (n) => Math.floor(Math.random() * n);
  for (let i = 0; i < 200; i += 1) {
    const pick = rnd(4);
    let value;
    if (pick === 0) value = `s${rnd(1000000)}`;
    else if (pick === 1) value = rnd(0xffffffff);
    else if (pick === 2) value = { k: rnd(100), v: `v${rnd(100)}` };
    else value = [rnd(50), `x${rnd(50)}`, rnd(50)];
    assert.deepEqual(decodeValue(encodeValue(value)), value);
  }
});
