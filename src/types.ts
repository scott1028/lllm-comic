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
  // Translation layer text floor in px; small boxes overflow instead of shrinking below it.
  minFontSize: number;
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

// Viewport coordinates in CSS pixels.
export type Rect = { left: number; top: number; right: number; bottom: number };

export type GetFileSizesMessage = { type: 'GET_FILE_SIZES'; urls: string[] };

export type FileSizes = Record<string, number | null>;

// Ratios (0-1) of the image size.
export type Box = { x: number; y: number; width: number; height: number };

export type Dialogue = { box: Box; text: string; translation: string };

export type TranslationState =
  | { status: 'pending' }
  | { status: 'done'; dialogues: Dialogue[] }
  // willRetry: transient server trouble; the content script retries with backoff.
  | { status: 'error'; message: string; willRetry: boolean };

// source: data: URL (blob: images are converted in page) or http(s) URL.
export type TranslateImageMessage = { type: 'TRANSLATE_IMAGE'; source: string };

export type TranslateImageResponse = { dialogues: Dialogue[] } | { error: string; isRetryable: boolean };

// Screenshot fallback for tainted canvases; rect is the visible part to crop.
export type CaptureRegionMessage = { type: 'CAPTURE_REGION'; rect: Rect; viewportWidth: number };

// isRetryable: the tab was not in front; try again later instead of failing.
export type CaptureRegionResponse = { dataUrl: string } | { error: string; isRetryable: boolean };
