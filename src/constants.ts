import type { Settings } from './types';

export const STORAGE_KEY = 'settings';

// API key stays in storage.local so it is not synced to the Google account.
export const API_KEY_STORAGE_KEY = 'apiKey';

export const GET_FILE_SIZES = 'GET_FILE_SIZES';

export const TRANSLATE_IMAGE = 'TRANSLATE_IMAGE';

export const CAPTURE_REGION = 'CAPTURE_REGION';

export const DEFAULT_SETTINGS: Settings = {
  isEnabled: true,
  matchMode: 'any',
  rules: [
    { metric: 'fileSizeKB', operator: '>=', value: 500 },
    { metric: 'width', operator: '>=', value: 2000 },
  ],
  translation: {
    isEnabled: false,
    targetLanguage: '繁體中文',
    apiBaseUrl: 'http://127.0.0.1:8888/v1',
    model: '',
    reasoningEffort: 'none',
  },
};
