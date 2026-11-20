import type { Settings } from './types';

export const STORAGE_KEY = 'settings';

export const GET_FILE_SIZES = 'GET_FILE_SIZES';

export const DEFAULT_SETTINGS: Settings = {
  isEnabled: true,
  matchMode: 'any',
  rules: [
    { metric: 'fileSizeKB', operator: '>=', value: 500 },
    { metric: 'width', operator: '>=', value: 2000 },
  ],
};
