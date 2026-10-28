import { ApiError } from '../scheduling-api.js';

export const MAX_PIXELS = 50_000_000;
export const MIN_SIDE = 320;

export type PictureFormat = 'png' | 'jpeg' | 'webp';

const MIME: Record<PictureFormat, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

/**
 * Reads what a file really is from its first bytes ("magic bytes"), and its
 * size in pixels from its header, WITHOUT decoding the picture. A small file
 * can claim to be 60,000 × 60,000 pixels and use gigabytes of memory when
 * decoded, so the size is checked before any decoder sees it.
 */
export function inspectPicture(bytes: Buffer, declaredMime: string | undefined) {
  const format = formatOf(bytes);
  if (!format) {
    throw new ApiError('not_a_picture', 'This file is not a PNG, JPEG or WebP picture. Send a picture in one of these formats.');
  }
  // The file name and the stated type are only claims. The bytes decide; a
  // claim that disagrees with them is a reason to stop.
  const claimed = declaredMime?.trim().toLowerCase().replace('image/jpg', 'image/jpeg');
  if (claimed && claimed !== MIME[format]) {
    throw new ApiError('not_a_picture', `This file says it is ${declaredMime}, but its bytes are ${MIME[format]}. Send the picture again, as it is.`);
  }

  const size = sizeOf(bytes, format);
  if (!size) {
    throw new ApiError('not_a_picture', 'This picture is damaged: its size cannot be read. Send it again, or send another picture.');
  }
  if (size.width * size.height > MAX_PIXELS) {
    throw new ApiError('too_large', `This picture is ${size.width} × ${size.height} pixels, more than ${MAX_PIXELS / 1_000_000} megapixels. Send a smaller picture.`);
  }
  if (Math.min(size.width, size.height) < MIN_SIDE) {
    throw new ApiError('too_small', `This picture is ${size.width} × ${size.height} pixels. Each side must be at least ${MIN_SIDE} pixels. Send a larger picture.`);
  }
  return { format, ...size };
}

function formatOf(bytes: Buffer): PictureFormat | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return undefined;
}

function sizeOf(bytes: Buffer, format: PictureFormat): { width: number; height: number } | undefined {
  try {
    if (format === 'png') {
      // The first chunk is IHDR: width and height as 4-byte numbers.
      if (bytes.toString('latin1', 12, 16) !== 'IHDR') return undefined;
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    if (format === 'webp') {
      const chunk = bytes.toString('latin1', 12, 16);
      if (chunk === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') {
        const bits = bytes.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (chunk === 'VP8X') return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
      return undefined;
    }
    // JPEG: walk the segments until a "start of frame" marker, which holds the size.
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return undefined;
      while (bytes[offset + 1] === 0xff) offset++; // fill bytes before a marker are allowed
      const marker = bytes[offset + 1] ?? 0;
      const length = bytes.readUInt16BE(offset + 2);
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      offset += 2 + length;
    }
    return undefined;
  } catch {
    return undefined; // a header cut short
  }
}
