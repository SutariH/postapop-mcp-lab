// Tiny picture headers for tests. inspectPicture reads only the header, so
// these few bytes are enough; no real picture is needed.

export function png(width: number, height: number) {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

export function jpeg(width: number, height: number) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(9, 2);
  sof.writeUInt8(8, 4);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(4)]);
}

export function webp(width: number, height: number) {
  const bytes = Buffer.alloc(30);
  bytes.write('RIFF', 0, 'latin1');
  bytes.writeUInt32LE(22, 4);
  bytes.write('WEBP', 8, 'latin1');
  bytes.write('VP8X', 12, 'latin1');
  bytes.writeUInt32LE(10, 16);
  bytes.writeUIntLE(width - 1, 24, 3);
  bytes.writeUIntLE(height - 1, 27, 3);
  return bytes;
}

export function webpLossy(width: number, height: number) {
  const bytes = Buffer.alloc(30);
  bytes.write('RIFF', 0, 'latin1');
  bytes.writeUInt32LE(22, 4);
  bytes.write('WEBP', 8, 'latin1');
  bytes.write('VP8 ', 12, 'latin1');
  Buffer.from([0x9d, 0x01, 0x2a]).copy(bytes, 23);
  bytes.writeUInt16LE(width, 26);
  bytes.writeUInt16LE(height, 28);
  return bytes;
}

export function webpLossless(width: number, height: number) {
  const bytes = Buffer.alloc(25);
  bytes.write('RIFF', 0, 'latin1');
  bytes.writeUInt32LE(17, 4);
  bytes.write('WEBP', 8, 'latin1');
  bytes.write('VP8L', 12, 'latin1');
  bytes.writeUInt8(0x2f, 20);
  bytes.writeUInt32LE((width - 1) | ((height - 1) << 14), 21);
  return bytes;
}

/** A JPEG with fill bytes (0xFF 0xFF) before its frame marker, which the format allows. */
export function jpegWithFill(width: number, height: number) {
  const plain = jpeg(width, height);
  return Buffer.concat([plain.subarray(0, 8), Buffer.from([0xff]), plain.subarray(8)]);
}
