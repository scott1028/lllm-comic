import { describe, expect, it } from 'vitest';
import type { ImageMetrics, Settings } from '../types';
import { evaluateRules, getBadgeText, getOversizeRatio } from '.';

const bigImage: ImageMetrics = { url: 'a.png', width: 4000, height: 3000, oversizeRatio: 5 };

const getSettings = (matchMode: Settings['matchMode'], rules: Settings['rules']): Settings => ({
  isEnabled: true,
  matchMode,
  rules,
});

describe('evaluateRules', () => {
  it('returns false when there are no rules', () => {
    expect(evaluateRules(bigImage, getSettings('any', []))).toBe(false);
  });

  it('supports >= and <= operators', () => {
    expect(evaluateRules(bigImage, getSettings('all', [{ metric: 'width', operator: '>=', value: 4000 }]))).toBe(true);
    expect(evaluateRules(bigImage, getSettings('all', [{ metric: 'height', operator: '<=', value: 2999 }]))).toBe(false);
  });

  it('ALL: false wins over unknown, so file size is not needed', () => {
    const settings = getSettings('all', [
      { metric: 'fileSizeKB', operator: '>=', value: 500 },
      { metric: 'width', operator: '>=', value: 5000 },
    ]);
    expect(evaluateRules(bigImage, settings)).toBe(false);
  });

  it('ALL: unknown file size with other rules passing returns unknown', () => {
    const settings = getSettings('all', [
      { metric: 'fileSizeKB', operator: '>=', value: 500 },
      { metric: 'width', operator: '>=', value: 2000 },
    ]);
    expect(evaluateRules(bigImage, settings)).toBe('unknown');
    expect(evaluateRules({ ...bigImage, fileSizeBytes: 600 * 1024 }, settings)).toBe(true);
    expect(evaluateRules({ ...bigImage, fileSizeBytes: 100 * 1024 }, settings)).toBe(false);
  });

  it('ANY: true wins over unknown, so file size is not needed', () => {
    const settings = getSettings('any', [
      { metric: 'fileSizeKB', operator: '>=', value: 500 },
      { metric: 'width', operator: '>=', value: 2000 },
    ]);
    expect(evaluateRules(bigImage, settings)).toBe(true);
  });

  it('ANY: unknown file size with other rules failing returns unknown', () => {
    const settings = getSettings('any', [
      { metric: 'fileSizeKB', operator: '>=', value: 500 },
      { metric: 'width', operator: '>=', value: 5000 },
    ]);
    expect(evaluateRules(bigImage, settings)).toBe('unknown');
  });

  it('treats a failed size lookup (null) as not matching', () => {
    const settings = getSettings('any', [{ metric: 'fileSizeKB', operator: '>=', value: 500 }]);
    expect(evaluateRules({ ...bigImage, fileSizeBytes: null }, settings)).toBe(false);
  });

  it('treats a missing oversize ratio (not rendered) as not matching', () => {
    const settings = getSettings('any', [{ metric: 'oversizeRatio', operator: '>=', value: 1 }]);
    expect(evaluateRules({ ...bigImage, oversizeRatio: undefined }, settings)).toBe(false);
  });
});

describe('getOversizeRatio', () => {
  it('accounts for devicePixelRatio', () => {
    expect(getOversizeRatio(4000, 1000, 1)).toBe(4);
    expect(getOversizeRatio(4000, 1000, 2)).toBe(2);
  });

  it('returns undefined when not rendered', () => {
    expect(getOversizeRatio(4000, 0, 1)).toBeUndefined();
  });
});

describe('getBadgeText', () => {
  it('shows size, dimensions and ratio', () => {
    expect(getBadgeText({ ...bigImage, fileSizeBytes: 1.5 * 1024 * 1024 })).toBe('1.5 MB · 4000×3000 · 5.0x');
    expect(getBadgeText({ ...bigImage, fileSizeBytes: 600 * 1024 })).toBe('600 KB · 4000×3000 · 5.0x');
  });

  it('omits unknown size and ratio', () => {
    expect(getBadgeText({ url: 'a.png', width: 10, height: 20, fileSizeBytes: null })).toBe('10×20');
  });
});
