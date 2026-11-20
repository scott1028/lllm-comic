import type { ImageMetrics, Rule, RuleResult, Settings } from '../types';

export { getContentRangeTotal, getDataUrlByteSize } from './fileSize';

const evaluateRule = (rule: Rule, metrics: ImageMetrics): RuleResult => {
  let actual: number | undefined;
  switch (rule.metric) {
    case 'fileSizeKB':
      if (metrics.fileSizeBytes === undefined) return 'unknown';
      actual = metrics.fileSizeBytes === null ? undefined : metrics.fileSizeBytes / 1024;
      break;
    case 'width':
      actual = metrics.width;
      break;
    case 'height':
      actual = metrics.height;
      break;
    case 'oversizeRatio':
      actual = metrics.oversizeRatio;
      break;
  }
  if (actual === undefined) return false;
  return rule.operator === '>=' ? actual >= rule.value : actual <= rule.value;
};

// Three-valued: 'unknown' only when the missing file size can change the outcome.
export const evaluateRules = (
  metrics: ImageMetrics,
  { matchMode, rules }: Pick<Settings, 'matchMode' | 'rules'>,
): RuleResult => {
  if (rules.length === 0) return false;
  const ruleResults = rules.map((rule) => evaluateRule(rule, metrics));
  if (matchMode === 'all') {
    if (ruleResults.includes(false)) return false;
    return ruleResults.every((ruleResult) => ruleResult === true) ? true : 'unknown';
  }
  if (ruleResults.includes(true)) return true;
  return ruleResults.every((ruleResult) => ruleResult === false) ? false : 'unknown';
};

export type Rect = { left: number; top: number; right: number; bottom: number };

// Overlap of all rects; undefined when they do not overlap.
export const getIntersection = (rects: Rect[]): Rect | undefined => {
  const intersection = {
    left: Math.max(...rects.map((rect) => rect.left)),
    top: Math.max(...rects.map((rect) => rect.top)),
    right: Math.min(...rects.map((rect) => rect.right)),
    bottom: Math.min(...rects.map((rect) => rect.bottom)),
  };
  return intersection.right > intersection.left && intersection.bottom > intersection.top
    ? intersection
    : undefined;
};

// RGBA pixels that are all the same color, e.g. a canvas not drawn yet.
export const getIsUniformPixels = (pixels: ArrayLike<number>): boolean => {
  for (let index = 4; index < pixels.length; index++) {
    if (pixels[index] !== pixels[index % 4]) return false;
  }
  return true;
};

// How many times wider the image is than the screen pixels it occupies.
export const getOversizeRatio = (
  naturalWidth: number,
  displayWidth: number,
  devicePixelRatio: number,
): number | undefined => {
  if (displayWidth <= 0) return undefined;
  return naturalWidth / (displayWidth * devicePixelRatio);
};

export const getBadgeText = (metrics: ImageMetrics): string => {
  const parts: string[] = [];
  const bytes = metrics.fileSizeBytes;
  if (typeof bytes === 'number') {
    parts.push(
      bytes >= 1024 * 1024
        ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
        : `${Math.round(bytes / 1024)} KB`,
    );
  }
  parts.push(`${metrics.width}×${metrics.height}`);
  if (metrics.oversizeRatio !== undefined) {
    parts.push(`${metrics.oversizeRatio.toFixed(1)}x`);
  }
  return parts.join(' · ');
};
