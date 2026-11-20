export type Metric = 'fileSizeKB' | 'width' | 'height' | 'oversizeRatio';

export type Operator = '>=' | '<=';

export type Rule = { metric: Metric; operator: Operator; value: number };

export type MatchMode = 'all' | 'any';

export type TranslationSettings = {
  isEnabled: boolean;
  targetLanguage: string;
  apiBaseUrl: string;
  model: string;
  // Sent as reasoning_effort; '' = let the server decide.
  reasoningEffort: string;
};

export type Settings = {
  isEnabled: boolean;
  matchMode: MatchMode;
  rules: Rule[];
  translation: TranslationSettings;
};

export type ImageMetrics = {
  // Image URL, or a synthetic key for canvases (see collectImages).
  url: string;
  // natural (intrinsic) pixel size
  width: number;
  height: number;
  // undefined when the element is not rendered
  oversizeRatio?: number;
  // undefined = not looked up yet, null = lookup failed or no file (canvas)
  fileSizeBytes?: number | null;
};

export type RuleResult = boolean | 'unknown';

export type GetFileSizesMessage = { type: 'GET_FILE_SIZES'; urls: string[] };

export type FileSizes = Record<string, number | null>;

// Ratios (0-1) of the image size.
export type Box = { x: number; y: number; width: number; height: number };

export type Dialogue = { box: Box; text: string; translation: string };

export type TranslationState =
  | { status: 'pending' }
  | { status: 'done'; dialogues: Dialogue[] }
  | { status: 'error'; message: string };

// source: data: URL (blob: images are converted in page) or http(s) URL.
export type TranslateImageMessage = { type: 'TRANSLATE_IMAGE'; source: string };

export type TranslateImageResponse = { dialogues: Dialogue[] } | { error: string };
