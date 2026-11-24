import type { Dialogue, TranslationSettings } from '../types';
import { getBlobDataUrl } from '../utils/blob';
import { getApiKey, getSettings } from '../utils/settings';
import {
  getIsRetryableStatus,
  getReasoningParams,
  getResizedSize,
  getTranslationPrompt,
  parseDialogues,
} from '../utils/translation';
import { runWithReferer } from './referer';

const MAX_IMAGE_EDGE = 1600;
const REQUEST_TIMEOUT_MS = 180_000;
// TODO: evict old entries; storage.local has a 10 MB quota.
const CACHE_KEY_PREFIX = 'translation:';

type EncodedImage = { dataUrl: string; width: number; height: number };

// Server down, restarting or overloaded: worth retrying later.
export class RetryableApiError extends Error {}

// One request at a time: local model servers usually run a single job.
let translationQueue: Promise<unknown> = Promise.resolve();

const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
  const run = translationQueue.then(task);
  translationQueue = run.catch(() => undefined);
  return run;
};

const getSha256Hex = async (bytes: ArrayBuffer): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const getCachedDialogues = async (cacheKey: string): Promise<Dialogue[] | undefined> =>
  (await chrome.storage.local.get(cacheKey))[cacheKey] as Dialogue[] | undefined;

// Box ratios do not depend on the size we send, so shrink big pages to save time.
const encodeImage = async (blob: Blob): Promise<EncodedImage> => {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = getResizedSize(bitmap.width, bitmap.height, MAX_IMAGE_EDGE);
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  return { dataUrl: await getBlobDataUrl(jpeg), width, height };
};

const requestDialogues = async (
  image: EncodedImage,
  translation: TranslationSettings,
  apiKey: string,
  signal: AbortSignal,
): Promise<Dialogue[]> => {
  const requestUrl = `${translation.apiBaseUrl.replace(/\/+$/, '')}/chat/completions`;
  const request: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: translation.model,
      temperature: 0,
      ...getReasoningParams(translation.reasoningEffort),
      messages: [
        { role: 'system', content: getTranslationPrompt(translation.targetLanguage) },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Target language: ${translation.targetLanguage}` },
            { type: 'image_url', image_url: { url: image.dataUrl } },
          ],
        },
      ],
    }),
    // Aborting closes the connection, so the server can stop generating.
    signal: AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), signal]),
  };
  let response: Response;
  try {
    response = await fetch(requestUrl, request);
  } catch (error) {
    // Connection refused or timed out.
    throw new RetryableApiError(error instanceof Error ? error.message : String(error));
  }
  if (!response.ok) {
    const message = `API ${response.status}: ${(await response.text()).slice(0, 200)}`;
    throw getIsRetryableStatus(response.status) ? new RetryableApiError(message) : new Error(message);
  }
  const completion = await response.json();
  const content = completion?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('API response has no message content');
  return parseDialogues(content, image.width, image.height);
};

// source: data: URL or http(s) URL; host permissions let us fetch it without CORS.
// pageUrl: page showing the image, sent as Referer.
// signal: aborted when the content script cancels (image left the page, tab closed).
export const translateImage = async (
  source: string,
  pageUrl: string | undefined,
  signal: AbortSignal,
): Promise<Dialogue[]> => {
  const [{ translation }, apiKey] = await Promise.all([getSettings(), getApiKey()]);
  const imageResponse = await runWithReferer(source, pageUrl, () => fetch(source));
  if (!imageResponse.ok) throw new Error(`Image fetch failed: HTTP ${imageResponse.status}`);
  const imageBlob = await imageResponse.blob();

  // Key by content: blob: URLs change on every page load.
  const hash = await getSha256Hex(await imageBlob.arrayBuffer());
  const cacheKey = [
    CACHE_KEY_PREFIX + hash,
    translation.model,
    translation.targetLanguage,
    translation.reasoningEffort,
  ].join(':');
  const cachedDialogues = await getCachedDialogues(cacheKey);
  if (cachedDialogues) return cachedDialogues;

  return enqueue(async () => {
    // Cancelled while waiting: skip without calling the server.
    signal.throwIfAborted();
    // The same image may have been translated while this one waited.
    const latestCachedDialogues = await getCachedDialogues(cacheKey);
    if (latestCachedDialogues) return latestCachedDialogues;
    const dialogues = await requestDialogues(await encodeImage(imageBlob), translation, apiKey, signal);
    // Saved inside the queue so the next waiting duplicate finds it.
    await chrome.storage.local.set({ [cacheKey]: dialogues });
    return dialogues;
  });
};
