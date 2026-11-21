import { describe, expect, it } from 'vitest';
import type { Settings } from '../types';
import { getIsTranslationRequestChanged, mergeSettings } from './settings';

describe('mergeSettings minFontSize', () => {
  it('defaults to 18 for settings saved before the option existed', () => {
    const settings = mergeSettings({ translation: { model: 'qwen' } } as Partial<Settings>);
    expect(settings.translation.minFontSize).toBe(18);
  });
});

describe('getIsTranslationRequestChanged', () => {
  const translation = mergeSettings(undefined).translation;

  it('ignores a font size change, which only affects drawing', () => {
    expect(getIsTranslationRequestChanged(translation, { ...translation, minFontSize: 24 })).toBe(false);
  });

  it('detects a change that affects the API result', () => {
    expect(getIsTranslationRequestChanged(translation, { ...translation, model: 'other' })).toBe(true);
  });
});
