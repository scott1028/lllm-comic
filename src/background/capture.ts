import type { Rect } from '../types';
import { getBlobDataUrl } from '../utils/blob';

// Chrome allows about 2 captureVisibleTab calls per second.
const MIN_CAPTURE_INTERVAL_MS = 600;

// Thrown when the tab is not in front; the content script retries later.
export class TabNotActiveError extends Error {}

let captureQueue: Promise<unknown> = Promise.resolve();
let lastCaptureAt = 0;

const enqueueCapture = <T>(task: () => Promise<T>): Promise<T> => {
  const run = captureQueue.then(async () => {
    const waitMs = lastCaptureAt + MIN_CAPTURE_INTERVAL_MS - Date.now();
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    try {
      return await task();
    } finally {
      lastCaptureAt = Date.now();
    }
  });
  captureQueue = run.catch(() => undefined);
  return run;
};

// Screenshot the visible tab and crop rect (CSS px) out of it.
export const captureRegion = (tab: chrome.tabs.Tab, rect: Rect, viewportWidth: number): Promise<string> =>
  enqueueCapture(async () => {
    // captureVisibleTab shows the window's active tab, which must be the requesting one.
    const { active } = await chrome.tabs.get(tab.id!);
    if (!active) throw new TabNotActiveError('Tab is not in front');
    const screenshotUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const bitmap = await createImageBitmap(await (await fetch(screenshotUrl)).blob());
    // Screenshot pixels per CSS pixel (device pixel ratio and zoom).
    const scale = bitmap.width / viewportWidth;
    const width = Math.round((rect.right - rect.left) * scale);
    const height = Math.round((rect.bottom - rect.top) * scale);
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d')!.drawImage(bitmap, rect.left * scale, rect.top * scale, width, height, 0, 0, width, height);
    bitmap.close();
    return getBlobDataUrl(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 }));
  });
