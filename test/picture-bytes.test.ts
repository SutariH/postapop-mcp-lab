import { describe, expect, it } from 'vitest';
import { inspectPicture } from '../src/pictures/picture-bytes.js';
import { jpeg, jpegWithFill, png, webp, webpLossless, webpLossy } from './pictures-fixtures.js';

describe('inspectPicture', () => {
  it('reads the format and size of PNG, JPEG and WebP from the header', () => {
    expect(inspectPicture(png(1374, 1145), 'image/png')).toEqual({ format: 'png', width: 1374, height: 1145 });
    expect(inspectPicture(jpeg(1080, 1350), undefined)).toEqual({ format: 'jpeg', width: 1080, height: 1350 });
    expect(inspectPicture(webp(2048, 2048), 'image/webp')).toEqual({ format: 'webp', width: 2048, height: 2048 });
    expect(inspectPicture(webpLossy(1234, 567), 'image/webp')).toEqual({ format: 'webp', width: 1234, height: 567 });
    expect(inspectPicture(webpLossless(1234, 567), 'image/webp')).toEqual({ format: 'webp', width: 1234, height: 567 });
    expect(inspectPicture(jpegWithFill(1234, 567), 'image/jpeg')).toEqual({ format: 'jpeg', width: 1234, height: 567 });
  });

  it('reads the stated type without caring about upper case or "jpg"', () => {
    expect(inspectPicture(jpeg(1000, 1000), 'image/JPG').format).toBe('jpeg');
  });

  it('lets the bytes decide, not the file name or the stated type', () => {
    expect(() => inspectPicture(Buffer.from('%PDF-1.7 not a picture'), 'image/png')).toThrow(/not a PNG, JPEG or WebP/);
    expect(() => inspectPicture(png(1000, 1000), 'image/jpeg')).toThrow(/says it is image\/jpeg, but its bytes are image\/png/);
  });

  it('refuses a picture too large to decode safely, before anything decodes it', () => {
    expect(() => inspectPicture(png(60_000, 60_000), 'image/png')).toThrow(/more than 50 megapixels/);
  });

  it('refuses a picture with a side under 320 pixels', () => {
    expect(() => inspectPicture(jpeg(300, 1000), 'image/jpeg')).toThrow(/at least 320 pixels/);
  });

  it('refuses a header that is cut short', () => {
    expect(() => inspectPicture(png(1000, 1000).subarray(0, 14), 'image/png')).toThrow(/damaged/);
  });
});
