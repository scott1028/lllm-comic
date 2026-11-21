import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../constants';
import type { Settings } from '../types';
import { mergeSettings } from './settings';

describe('mergeSettings', () => {
  it('returns a copy of the defaults when nothing is stored', () => {
    const settings = mergeSettings(undefined);
    expect(settings).toEqual(DEFAULT_SETTINGS);
    settings.rules.push({ metric: 'width', operator: '>=', value: 1 });
    expect(DEFAULT_SETTINGS.rules).toHaveLength(3);
  });

  it('adds translation defaults to settings saved before translation existed', () => {
    const oldSettings = { isEnabled: false, matchMode: 'all', rules: [] } as Partial<Settings>;
    const settings = mergeSettings(oldSettings);
    expect(settings.isEnabled).toBe(false);
    expect(settings.rules).toEqual([]);
    expect(settings.translation).toEqual(DEFAULT_SETTINGS.translation);
  });

  it('keeps stored translation fields and fills missing ones', () => {
    const settings = mergeSettings({ translation: { model: 'qwen' } } as Partial<Settings>);
    expect(settings.translation.model).toBe('qwen');
    expect(settings.translation.targetLanguage).toBe('繁體中文');
  });
});
