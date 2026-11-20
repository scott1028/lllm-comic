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
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
export const translateImage = async (source: string): Promise<Dialogue[]> => {
  const [{ translation }, apiKey] = await Promise.all([getSettings(), getApiKey()]);
  const imageResponse = await fetch(source);
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
  const cached = (await chrome.storage.local.get(cacheKey))[cacheKey] as Dialogue[] | undefined;
  if (cached) return cached;

  const dialogues = await enqueue(async () =>
    requestDialogues(await encodeImage(imageBlob), translation, apiKey),
  );
  await chrome.storage.local.set({ [cacheKey]: dialogues });
  return dialogues;
};
