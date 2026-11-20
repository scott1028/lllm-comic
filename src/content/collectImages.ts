import type { ImageMetrics } from '../types';
import { getDataUrlByteSize, getIsUniformPixels, getOversizeRatio } from '../utils';

export type ImageCandidate = { element: HTMLImageElement | HTMLCanvasElement; metrics: ImageMetrics };

const FINGERPRINT_SIZE = 16;

const elementIds = new WeakMap<Element, number>();
let nextElementId = 0;

// Stable key for a canvas element itself (canvases have no URL).
const getCanvasElementKey = (canvas: HTMLCanvasElement): string => {
  let id = elementIds.get(canvas);
  if (id === undefined) {
    id = nextElementId++;
    elementIds.set(canvas, id);
  }
  return `canvas:#${id}`;
};

// Translation key that changes when the canvas is redrawn; undefined while it is still blank.
export const getCanvasContentKey = (canvas: HTMLCanvasElement): string | undefined => {
  // New canvas per call: drawing a tainted canvas would taint a shared one for good.
  const context = new OffscreenCanvas(FINGERPRINT_SIZE, FINGERPRINT_SIZE).getContext('2d', {
    willReadFrequently: true,
  })!;
  context.drawImage(canvas, 0, 0, FINGERPRINT_SIZE, FINGERPRINT_SIZE);
  let pixels: Uint8ClampedArray;
  try {
    pixels = context.getImageData(0, 0, FINGERPRINT_SIZE, FINGERPRINT_SIZE).data;
  } catch {
    // Tainted by cross-origin pixels: cannot fingerprint, fall back to the element.
    return getCanvasElementKey(canvas);
  }
  if (getIsUniformPixels(pixels)) return undefined;
  return `canvas:${String.fromCharCode(...pixels)}`;
};

// Size known without a lookup; undefined means look it up later (blob: in page, others via service worker).
const getKnownFileSize = (url: string): number | undefined => {
  if (url.startsWith('data:')) return getDataUrlByteSize(url);
  // Cross-origin entries report 0 unless the server sends Timing-Allow-Origin.
  const entry = performance.getEntriesByName(url)[0] as PerformanceResourceTiming | undefined;
  return entry && entry.encodedBodySize > 0 ? entry.encodedBodySize : undefined;
};

// Hidden elements cannot be marked.
const getRenderedRect = (element: Element): DOMRect | undefined => {
  const rect = element.getBoundingClientRect();
  return rect.width === 0 || rect.height === 0 ? undefined : rect;
};

export const collectImages = (): ImageCandidate[] => {
  const candidates: ImageCandidate[] = [];
  for (const img of document.images) {
    const url = img.currentSrc || img.src;
    if (!url || !img.complete || img.naturalWidth === 0) continue;
    const rect = getRenderedRect(img);
    if (!rect) continue;
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
  for (const canvas of document.querySelectorAll('canvas')) {
    // Skip our own translation layers.
    if (canvas.closest('lis-overlay') || canvas.width === 0 || canvas.height === 0) continue;
    const rect = getRenderedRect(canvas);
    if (!rect) continue;
    candidates.push({
      element: canvas,
      metrics: {
        url: getCanvasElementKey(canvas),
        // Backing pixels play the role of the natural size.
        width: canvas.width,
        height: canvas.height,
        oversizeRatio: getOversizeRatio(canvas.width, rect.width, window.devicePixelRatio),
        fileSizeBytes: null,
      },
    });
  }
  return candidates;
};
