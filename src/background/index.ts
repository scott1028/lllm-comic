import { CAPTURE_REGION, GET_FILE_SIZES, TRANSLATE_IMAGE } from '../constants';
import type {
  CaptureRegionMessage,
  CaptureRegionResponse,
  FileSizes,
  GetFileSizesMessage,
  TranslateImageMessage,
  TranslateImageResponse,
} from '../types';
import { getContentRangeTotal } from '../utils';
import { captureRegion, TabNotActiveError } from './capture';
import { runWithReferer } from './referer';
import { RetryableApiError, translateImage } from './translate';

const MAX_CONCURRENT_FETCHES = 6;

// Lives until the service worker is terminated; caches failures (null) too.
const fileSizeCache = new Map<string, Promise<number | null>>();
const fetchQueue: (() => void)[] = [];
let activeFetchCount = 0;

const runLimited = async <T>(task: () => Promise<T>): Promise<T> => {
  if (activeFetchCount < MAX_CONCURRENT_FETCHES) activeFetchCount++;
  else await new Promise<void>((resolve) => fetchQueue.push(resolve));
  try {
    return await task();
  } finally {
    // Hand the slot to the next waiter, or release it.
    const next = fetchQueue.shift();
    if (next) next();
    else activeFetchCount--;
  }
};

// Host permissions let the service worker skip CORS, so cross-origin headers are readable.
const fetchFileSize = async (url: string): Promise<number | null> => {
  try {
    const headResponse = await fetch(url, { method: 'HEAD' });
    const headLength = headResponse.headers.get('content-length');
    if (headResponse.ok && headLength) return Number(headLength);

    const rangeResponse = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    // Only headers are needed; stop the body download.
    void rangeResponse.body?.cancel();
    if (rangeResponse.status === 206) {
      return getContentRangeTotal(rangeResponse.headers.get('content-range'));
    }
    const fullLength = rangeResponse.headers.get('content-length');
    return rangeResponse.ok && fullLength ? Number(fullLength) : null;
  } catch {
    return null;
  }
};

const getFileSizes = async (urls: string[], pageUrl: string | undefined): Promise<FileSizes> => {
  const sizes = await Promise.all(
    urls.map((url) => {
      let size = fileSizeCache.get(url);
      if (!size) {
        size = runLimited(() => runWithReferer(url, pageUrl, () => fetchFileSize(url)).catch(() => null));
        fileSizeCache.set(url, size);
      }
      return size;
    }),
  );
  return Object.fromEntries(urls.map((url, index) => [url, sizes[index]]));
};

// One port per translation, so the content script can cancel it.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== TRANSLATE_IMAGE) return;
  const controller = new AbortController();
  // Content script cancelled, or its page closed or navigated away.
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener((message: TranslateImageMessage) => {
    void translateImage(message.source, port.sender?.url, controller.signal)
      .then(
        (dialogues): TranslateImageResponse => ({ dialogues }),
        (error: unknown): TranslateImageResponse => ({
          error: error instanceof Error ? error.message : String(error),
          isRetryable: error instanceof RetryableApiError,
        }),
      )
      .then((response) => {
        // Posting to a closed port throws.
        if (!controller.signal.aborted) port.postMessage(response);
      });
  });
});

chrome.runtime.onMessage.addListener(
  (message: GetFileSizesMessage | CaptureRegionMessage, sender, sendResponse) => {
    if (message.type === GET_FILE_SIZES) {
      void getFileSizes(message.urls, sender.url).then(sendResponse);
      // Keep the channel open for the async response.
      return true;
    }
    if (message.type === CAPTURE_REGION && sender.tab) {
      captureRegion(sender.tab, message.rect, message.viewportWidth).then(
        (dataUrl) => sendResponse({ dataUrl } satisfies CaptureRegionResponse),
        (error: unknown) =>
          sendResponse({
            error: error instanceof Error ? error.message : String(error),
            isRetryable: error instanceof TabNotActiveError,
          } satisfies CaptureRegionResponse),
      );
      return true;
    }
  },
);
