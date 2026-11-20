import type { ImageMetrics } from '../types';
import { getDataUrlByteSize, getOversizeRatio } from '../utils';

export type ImageCandidate = { element: Element; metrics: ImageMetrics };

// Size known without a network request; undefined means ask the service worker.
const getKnownFileSize = (url: string): number | undefined => {
  if (url.startsWith('data:')) return getDataUrlByteSize(url);
  // Cross-origin entries report 0 unless the server sends Timing-Allow-Origin.
  const entry = performance.getEntriesByName(url)[0] as PerformanceResourceTiming | undefined;
  return entry && entry.encodedBodySize > 0 ? entry.encodedBodySize : undefined;
};

export const collectImages = (): ImageCandidate[] => {
  const candidates: ImageCandidate[] = [];
  for (const img of document.images) {
    const url = img.currentSrc || img.src;
    if (!url || url.startsWith('blob:') || !img.complete || img.naturalWidth === 0) continue;
    const rect = img.getBoundingClientRect();
    // Hidden images cannot be marked.
    if (rect.width === 0 || rect.height === 0) continue;
    candidates.push({
      element: img,
      metrics: {
        url,
        width: img.naturalWidth,
        height: img.naturalHeight,
        oversizeRatio: getOversizeRatio(img.naturalWidth, rect.width, window.devicePixelRatio),
        fileSizeBytes: getKnownFileSize(url),
      },
    });
  }
  return candidates;
};
