import { describe, expect, it } from 'vitest';
import { getContentRangeTotal, getDataUrlByteSize } from './fileSize';

describe('getDataUrlByteSize', () => {
  it('decodes base64 length with padding', () => {
    expect(getDataUrlByteSize(`data:image/png;base64,${btoa('abcd')}`)).toBe(4);
    expect(getDataUrlByteSize(`data:image/png;base64,${btoa('abcde')}`)).toBe(5);
    expect(getDataUrlByteSize(`data:image/png;base64,${btoa('abcdef')}`)).toBe(6);
  });

  it('counts percent-encoded UTF-8 bytes', () => {
    expect(getDataUrlByteSize('data:image/svg+xml,%3Csvg%3E')).toBe(5);
    expect(getDataUrlByteSize('data:text/plain,%E4%B8%AD')).toBe(3);
  });
});

describe('getContentRangeTotal', () => {
  it('reads the total length', () => {
    expect(getContentRangeTotal('bytes 0-0/12345')).toBe(12345);
    expect(getContentRangeTotal('bytes */999')).toBe(999);
  });

  it('returns null when total is unknown or header is missing', () => {
    expect(getContentRangeTotal('bytes 0-0/*')).toBeNull();
    expect(getContentRangeTotal(null)).toBeNull();
  });
});
