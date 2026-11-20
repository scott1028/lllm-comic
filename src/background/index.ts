import { GET_FILE_SIZES } from '../constants';
import type { FileSizes, GetFileSizesMessage } from '../types';
import { getContentRangeTotal } from '../utils';

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

const getFileSizes = async (urls: string[]): Promise<FileSizes> => {
  const sizes = await Promise.all(
    urls.map((url) => {
      let size = fileSizeCache.get(url);
      if (!size) {
        size = runLimited(() => fetchFileSize(url));
        fileSizeCache.set(url, size);
      }
      return size;
    }),
  );
  return Object.fromEntries(urls.map((url, index) => [url, sizes[index]]));
};

chrome.runtime.onMessage.addListener((message: GetFileSizesMessage, _sender, sendResponse) => {
  if (message.type !== GET_FILE_SIZES) return;
  void getFileSizes(message.urls).then(sendResponse);
  // Keep the channel open for the async response.
  return true;
});
