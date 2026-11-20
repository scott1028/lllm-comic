import { API_KEY_STORAGE_KEY, DEFAULT_SETTINGS, STORAGE_KEY } from '../constants';
import type { Settings } from '../types';

// Fill fields missing from settings saved by older versions.
export const mergeSettings = (stored: Partial<Settings> | undefined): Settings => {
  // Clone so callers can mutate without touching the default.
  const defaults = structuredClone(DEFAULT_SETTINGS);
  if (!stored) return defaults;
  return {
    ...defaults,
    ...stored,
    translation: { ...defaults.translation, ...stored.translation },
  };
};

export const getSettings = async (): Promise<Settings> => {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  return mergeSettings(stored[STORAGE_KEY] as Partial<Settings> | undefined);
};

export const getApiKey = async (): Promise<string> => {
  const stored = await chrome.storage.local.get(API_KEY_STORAGE_KEY);
  return (stored[API_KEY_STORAGE_KEY] as string | undefined) ?? '';
};
