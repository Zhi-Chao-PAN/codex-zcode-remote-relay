const encoder = new TextEncoder();
const decoder = new TextDecoder();

const TYPE_UNDEFINED = 0;
const TYPE_STRING = 1;
const TYPE_BUFFER = 2;
const TYPE_VSBUFFER = 3;
const TYPE_ARRAY = 4;
const TYPE_OBJECT = 5;
const TYPE_INT = 6;

export function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

export function base64ToBytes(text) {
  return new Uint8Array(Buffer.from(text, 'base64'));
}

function writeVarint(parts, value) {
  let n = value >>> 0;
  while (n >= 0x80) {
    parts.push(Uint8Array.of((n & 0x7f) | 0x80));
    n >>>= 7;
  }
  parts.push(Uint8Array.of(n));
}

function readVarint(reader) {
  let result = 0;
  let shift = 0;
  for (;;) {
    const byte = reader.readByte();
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return result >>> 0;
    shift += 7;
    if (shift > 35) throw new Error('Invalid varint.');
  }
}

function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function encodeValue(value) {
  const parts = [];
  encodeInto(parts, value);
  return concat(parts);
}

function encodeInto(parts, value) {
  if (value === undefined) {
    parts.push(Uint8Array.of(TYPE_UNDEFINED));
    return;
  }
  if (typeof value === 'string') {
    const bytes = encoder.encode(value);
    parts.push(Uint8Array.of(TYPE_STRING));
    writeVarint(parts, bytes.length);
    parts.push(bytes);
    return;
  }
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    parts.push(Uint8Array.of(TYPE_INT));
    writeVarint(parts, value);
    return;
  }
  if (value instanceof Uint8Array) {
    parts.push(Uint8Array.of(TYPE_BUFFER));
    writeVarint(parts, value.length);
    parts.push(value);
    return;
  }
  if (Array.isArray(value)) {
    parts.push(Uint8Array.of(TYPE_ARRAY));
    writeVarint(parts, value.length);
    for (const item of value) encodeInto(parts, item);
    return;
  }

  const bytes = encoder.encode(JSON.stringify(value));
  parts.push(Uint8Array.of(TYPE_OBJECT));
  writeVarint(parts, bytes.length);
  parts.push(bytes);
}

class Reader {
  constructor(bytes) {
    this.bytes = bytes;
    this.offset = 0;
  }

  readByte() {
    if (this.offset >= this.bytes.length) throw new Error('Unexpected end of RPC payload.');
    return this.bytes[this.offset++];
  }

  readBytes(length) {
    if (this.offset + length > this.bytes.length) throw new Error('Unexpected end of RPC payload.');
    const out = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }
}

export function decodeValue(bytes) {
  return decodeFrom(new Reader(bytes));
}

export function decodeFrameValues(bytes) {
  const reader = new Reader(bytes);
  const values = [];
  while (reader.offset < reader.bytes.length) {
    values.push(decodeFrom(reader));
  }
  return values;
}

function decodeFrom(reader) {
  const type = reader.readByte();
  if (type === TYPE_UNDEFINED) return undefined;
  if (type === TYPE_STRING) return decoder.decode(reader.readBytes(readVarint(reader)));
  if (type === TYPE_BUFFER || type === TYPE_VSBUFFER) return reader.readBytes(readVarint(reader));
  if (type === TYPE_INT) return readVarint(reader);
  if (type === TYPE_ARRAY) {
    const length = readVarint(reader);
    const out = [];
    for (let i = 0; i < length; i += 1) out.push(decodeFrom(reader));
    return out;
  }
  if (type === TYPE_OBJECT) return JSON.parse(decoder.decode(reader.readBytes(readVarint(reader))));
  throw new Error(`Unsupported RPC value type: ${type}`);
}

export function encodeRequest(id, channelName, methodName, args = []) {
  const header = encodeValue([100, id, channelName, methodName]);
  const body = encodeValue(args);
  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  out.set(body, header.length);
  return out;
}

export function decodeResponse(bytes) {
  const [header, body] = decodeFrameValues(bytes);
  return { header, body };
}
