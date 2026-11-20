import { CAPTURE_REGION } from '../constants';
import type { Box, CaptureRegionMessage, CaptureRegionResponse, Rect } from '../types';
import { getClippingAncestors, getVisibleRect } from './marker';

const CAPTURING_ATTRIBUTE = 'data-lis-capturing';
// Pages mostly off screen wait until scrolled in, instead of translating a sliver.
const MIN_VISIBLE_AREA_RATIO = 0.9;

// Tab hidden or canvas off screen: try again later, not a failure.
export class CaptureNotReadyError extends Error {}

export type CapturedImage = {
  dataUrl: string;
  // Captured part as ratios of the canvas; dialogue boxes are relative to it.
  region: Box;
};

type CaptureRegion = { rect: DOMRect; visibleRect: Rect };

let captureQueue: Promise<unknown> = Promise.resolve();

const getCaptureRegion = (canvas: HTMLCanvasElement): CaptureRegion | undefined => {
  if (document.visibilityState !== 'visible') return undefined;
  const rect = canvas.getBoundingClientRect();
  const visibleRect = getVisibleRect(rect, getClippingAncestors(canvas));
  if (!visibleRect) return undefined;
  const visibleArea = (visibleRect.right - visibleRect.left) * (visibleRect.bottom - visibleRect.top);
  return visibleArea >= rect.width * rect.height * MIN_VISIBLE_AREA_RATIO ? { rect, visibleRect } : undefined;
};

// Transient conditions only; iframe canvases go ahead and fail with a permanent error.
export const getIsCaptureReady = (canvas: HTMLCanvasElement): boolean =>
  window !== window.top || getCaptureRegion(canvas) !== undefined;

const waitForFrames = (count: number) =>
  new Promise<void>((resolve) => {
    const step = (remaining: number) => (remaining === 0 ? resolve() : requestAnimationFrame(() => step(remaining - 1)));
    step(count);
  });

const captureCanvas = async (canvas: HTMLCanvasElement): Promise<CapturedImage> => {
  // Inside an iframe its offset in the tab is unknown, so the screenshot cannot be cropped.
  if (window !== window.top) throw new Error('Tainted canvas inside an iframe is not supported');
  const captureRegion = getCaptureRegion(canvas);
  if (!captureRegion) throw new CaptureNotReadyError();
  const { rect, visibleRect } = captureRegion;

  document.documentElement.setAttribute(CAPTURING_ATTRIBUTE, '');
  try {
    // Let the hidden marks leave the screen before the screenshot.
    await waitForFrames(2);
    const message: CaptureRegionMessage = { type: CAPTURE_REGION, rect: visibleRect, viewportWidth: window.innerWidth };
    const response: CaptureRegionResponse = await chrome.runtime.sendMessage(message);
    if ('error' in response) {
      if (response.isRetryable) throw new CaptureNotReadyError();
      throw new Error(response.error);
    }
    return {
      dataUrl: response.dataUrl,
      region: {
        x: (visibleRect.left - rect.left) / rect.width,
        y: (visibleRect.top - rect.top) / rect.height,
        width: (visibleRect.right - visibleRect.left) / rect.width,
        height: (visibleRect.bottom - visibleRect.top) / rect.height,
      },
    };
  } finally {
    document.documentElement.removeAttribute(CAPTURING_ATTRIBUTE);
  }
};

// One at a time: a finishing capture would unhide marks during the next screenshot.
export const captureCanvasInOrder = (canvas: HTMLCanvasElement): Promise<CapturedImage> => {
  const run = captureQueue.then(() => captureCanvas(canvas));
  captureQueue = run.catch(() => undefined);
  return run;
};
