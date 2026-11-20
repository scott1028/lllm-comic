import { describe, expect, it } from 'vitest';
import { getBlobDataUrl } from './blob';

describe('getBlobDataUrl', () => {
  it('encodes bytes and keeps the MIME type', async () => {
    expect(await getBlobDataUrl(new Blob(['abc'], { type: 'image/png' }))).toBe('data:image/png;base64,YWJj');
  });

  it('round-trips data larger than one chunk', async () => {
    const bytes = Uint8Array.from({ length: 70000 }, (_, index) => index % 256);
    const dataUrl = await getBlobDataUrl(new Blob([bytes]));
    const decoded = Uint8Array.from(atob(dataUrl.split(',')[1]), (char) => char.charCodeAt(0));
    expect(decoded).toEqual(bytes);
    expect(dataUrl.startsWith('data:application/octet-stream;base64,')).toBe(true);
  });
});
