import { DEFAULT_SETTINGS, STORAGE_KEY } from '../constants';
import type { Settings } from '../types';

export const getSettings = async (): Promise<Settings> => {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  // Clone so callers can mutate without touching the default.
  return (stored[STORAGE_KEY] as Settings | undefined) ?? structuredClone(DEFAULT_SETTINGS);
};
