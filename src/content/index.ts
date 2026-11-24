import {
  API_KEY_STORAGE_KEY,
  DEFAULT_SETTINGS,
  GET_FILE_SIZES,
  STORAGE_KEY,
  TRANSLATE_IMAGE,
} from '../constants';
import type {
  Box,
  FileSizes,
  GetFileSizesMessage,
  Settings,
  TranslateImageMessage,
  TranslateImageResponse,
  TranslationState,
} from '../types';
import { evaluateRules } from '../utils';
import { getBlobDataUrl } from '../utils/blob';
import { getIsTranslationRequestChanged, getSettings, mergeSettings } from '../utils/settings';
import { getRetryDelay, mapBoxToRegion } from '../utils/translation';
import { captureCanvasInOrder, CaptureNotReadyError, getIsCaptureReady } from './capture';
import { collectImages, getCanvasContent, type ImageCandidate } from './collectImages';
import {
  getClippingAncestors,
  getVisibleRect,
  overlayRoot,
  scheduleReposition,
  setMinFontSize,
  updateMarks,
} from './marker';

const SCAN_DELAY_MS = 500;
// Readers draw canvases later without any event, and tainted canvases wait to be on screen.
const RETRY_SCAN_MS = 1000;

let settings: Settings = DEFAULT_SETTINGS;
// Sizes from the service worker; null = lookup failed.
const fileSizes = new Map<string, number | null>();
const pendingUrls = new Set<string>();
// Keyed by image URL.
const translations = new Map<string, TranslationState>();
// Requests still running, by the same key; abort one to cancel it in the service worker.
const translationRequests = new Map<string, AbortController>();
// Bumped when translations are reset, so late responses for old settings are dropped.
let translationGeneration = 0;
// Failed attempts so far per URL, for retry backoff.
const retryAttempts = new Map<string, number>();
const retryTimers = new Set<ReturnType<typeof setTimeout>>();
let scanTimer: ReturnType<typeof setTimeout> | undefined;
let retryScanTimer: ReturnType<typeof setTimeout> | undefined;

// After the extension reloads, this script keeps running in open tabs but chrome.* calls fail.
const getIsExtensionContextValid = () => Boolean(chrome.runtime?.id);

// Stop the server working on images no longer shown; they are requested again if they come back.
const cancelTranslationRequestsExcept = (keptUrls: Set<string>) => {
  for (const [url, controller] of translationRequests) {
    if (keptUrls.has(url)) continue;
    controller.abort();
    translationRequests.delete(url);
    translations.delete(url);
  }
};

const scan = () => {
  if (!getIsExtensionContextValid()) {
    stopContentScript();
    return;
  }
  if (!settings.isEnabled) {
    cancelTranslationRequestsExcept(new Set());
    updateMarks([]);
    return;
  }
  const matchedCandidates: ImageCandidate[] = [];
  const unknownUrls = new Set<string>();
  // Canvases have no file, so judge them by size only.
  const canvasSettings = {
    matchMode: settings.matchMode,
    rules: settings.rules.filter((rule) => rule.metric !== 'fileSizeKB'),
  };
  for (const candidate of collectImages()) {
    const { metrics } = candidate;
    if (metrics.fileSizeBytes === undefined && fileSizes.has(metrics.url)) {
      metrics.fileSizeBytes = fileSizes.get(metrics.url);
    }
    const isCanvas = candidate.element instanceof HTMLCanvasElement;
    const ruleResult = evaluateRules(metrics, isCanvas ? canvasSettings : settings);
    if (ruleResult === true) matchedCandidates.push(candidate);
    else if (ruleResult === 'unknown' && !pendingUrls.has(metrics.url)) unknownUrls.add(metrics.url);
  }
  const isTranslationEnabled = settings.translation.isEnabled;
  let isRetryNeeded = false;
  if (isTranslationEnabled) {
    const onScreenUrls = new Set<string>();
    for (const { element, metrics } of matchedCandidates) {
      let isTainted = false;
      if (element instanceof HTMLCanvasElement) {
        const canvasContent = getCanvasContent(element);
        if (!canvasContent) {
          isRetryNeeded = true;
          continue;
        }
        metrics.url = canvasContent.key;
        isTainted = canvasContent.isTainted;
      }
      // Entirely off screen: requested once scrolled into view.
      if (!getVisibleRect(element.getBoundingClientRect(), getClippingAncestors(element))) continue;
      onScreenUrls.add(metrics.url);
      if (translations.has(metrics.url)) continue;
      // Tainted canvases are screenshotted, so they must be on screen first.
      if (isTainted && !getIsCaptureReady(element as HTMLCanvasElement)) {
        isRetryNeeded = true;
        continue;
      }
      void requestTranslation(metrics.url, element, isTainted);
    }
    // Image is gone or off screen: removed, src changed, hidden or scrolled away.
    cancelTranslationRequestsExcept(onScreenUrls);
  }
  if (isRetryNeeded) scheduleRetryScan();
  updateMarks(
    matchedCandidates.map((candidate) => ({
      ...candidate,
      translation: isTranslationEnabled ? translations.get(candidate.metrics.url) : undefined,
    })),
  );
  if (unknownUrls.size > 0) void requestFileSizes([...unknownUrls]);
};

// Throttle (not debounce) so constant DOM churn cannot starve scans.
const scheduleScan = () => {
  if (scanTimer !== undefined) return;
  scanTimer = setTimeout(() => {
    scanTimer = undefined;
    scan();
  }, SCAN_DELAY_MS);
};

// blob: URLs exist only in this page, so read them here (from memory, no download).
const getBlobFileSize = async (url: string): Promise<number | null> => {
  try {
    return (await (await fetch(url)).blob()).size;
  } catch {
    // Page already revoked the blob URL.
    return null;
  }
};

const requestFileSizes = async (urls: string[]) => {
  urls.forEach((url) => pendingUrls.add(url));
  const blobUrls = urls.filter((url) => url.startsWith('blob:'));
  const remoteUrls = urls.filter((url) => !url.startsWith('blob:'));
  try {
    const message: GetFileSizesMessage = { type: GET_FILE_SIZES, urls: remoteUrls };
    const [blobSizes, remoteSizes] = await Promise.all([
      Promise.all(blobUrls.map(getBlobFileSize)),
      remoteUrls.length > 0
        ? (chrome.runtime.sendMessage(message) as Promise<FileSizes>)
        : ({} as FileSizes),
    ]);
    blobUrls.forEach((url, index) => fileSizes.set(url, blobSizes[index]));
    remoteUrls.forEach((url) => fileSizes.set(url, remoteSizes[url] ?? null));
  } catch {
    if (!getIsExtensionContextValid()) stopContentScript();
    return;
  } finally {
    urls.forEach((url) => pendingUrls.delete(url));
  }
  scheduleScan();
};

const scheduleRetryScan = () => {
  if (retryScanTimer !== undefined) return;
  retryScanTimer = setTimeout(() => {
    retryScanTimer = undefined;
    scheduleScan();
  }, RETRY_SCAN_MS);
};

const scheduleTranslationRetry = (url: string, attempt: number) => {
  retryAttempts.set(url, attempt + 1);
  const generation = translationGeneration;
  const timer = setTimeout(() => {
    retryTimers.delete(timer);
    if (generation !== translationGeneration) return;
    // Dropping the failed state lets the next scan request it again.
    translations.delete(url);
    scheduleScan();
  }, getRetryDelay(attempt));
  retryTimers.add(timer);
};

const clearTranslationRetries = () => {
  retryTimers.forEach(clearTimeout);
  retryTimers.clear();
  retryAttempts.clear();
};

// region: set when only part of a canvas was captured; boxes are relative to it.
type TranslationSource = { source: string; region?: Box };

const getTranslationSource = async (
  url: string,
  element: Element,
  isTainted: boolean,
): Promise<TranslationSource> => {
  if (element instanceof HTMLCanvasElement) {
    // Cross-origin pixels cannot be read, so screenshot the canvas instead.
    if (isTainted) {
      const { dataUrl, region } = await captureCanvasInOrder(element);
      return { source: dataUrl, region };
    }
    return { source: element.toDataURL('image/jpeg', 0.92) };
  }
  // blob: URLs only resolve inside this page, so send their bytes instead.
  if (url.startsWith('blob:')) return { source: await getBlobDataUrl(await (await fetch(url)).blob()) };
  return { source: url };
};

// One port per request: disconnecting it cancels the request in the service worker.
const sendTranslateMessage = (message: TranslateImageMessage, signal: AbortSignal) =>
  new Promise<TranslateImageResponse>((resolve, reject) => {
    // Cancelled while the source was being prepared.
    signal.throwIfAborted();
    const port = chrome.runtime.connect({ name: TRANSLATE_IMAGE });
    port.onMessage.addListener((response: TranslateImageResponse) => {
      port.disconnect();
      resolve(response);
    });
    // Only fires when the service worker side closes, e.g. it was restarted.
    port.onDisconnect.addListener(() =>
      reject(new Error(chrome.runtime.lastError?.message ?? 'Service worker disconnected')),
    );
    signal.addEventListener(
      'abort',
      () => {
        port.disconnect();
        reject(signal.reason);
      },
      { once: true },
    );
    port.postMessage(message);
  });

// url: image URL or canvas content key.
const requestTranslation = async (url: string, element: Element, isTainted: boolean) => {
  const generation = translationGeneration;
  // Set synchronously so the same scan does not request it twice.
  translations.set(url, { status: 'pending' });
  const controller = new AbortController();
  translationRequests.set(url, controller);
  let nextState: TranslationState;
  try {
    const { source, region } = await getTranslationSource(url, element, isTainted);
    const message: TranslateImageMessage = { type: TRANSLATE_IMAGE, source };
    let response: TranslateImageResponse;
    try {
      response = await sendTranslateMessage(message, controller.signal);
    } catch (error) {
      if (!getIsExtensionContextValid() || controller.signal.aborted) throw error;
      // Service worker went away mid-request (e.g. restarted): try again later.
      response = { error: error instanceof Error ? error.message : String(error), isRetryable: true };
    }
    nextState =
      'error' in response
        ? { status: 'error', message: response.error, willRetry: response.isRetryable }
        : {
            status: 'done',
            dialogues: region
              ? response.dialogues.map((dialogue) => ({ ...dialogue, box: mapBoxToRegion(dialogue.box, region) }))
              : response.dialogues,
          };
  } catch (error) {
    // Orphaned by an extension reload: stop quietly; the refreshed page gets a new script.
    if (!getIsExtensionContextValid()) {
      stopContentScript();
      return;
    }
    // Cancelled by scan or reset, which already cleared its state.
    if (controller.signal.aborted) return;
    // Tab went to the background or the page moved: not a failure, retry later.
    if (error instanceof CaptureNotReadyError) {
      if (generation === translationGeneration) translations.delete(url);
      scheduleRetryScan();
      return;
    }
    nextState = {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
      willRetry: false,
    };
  } finally {
    // A newer request for the same key may have taken this slot.
    if (translationRequests.get(url) === controller) translationRequests.delete(url);
  }
  if (generation !== translationGeneration) return;
  if (nextState.status === 'error') {
    const attempt = retryAttempts.get(url) ?? 0;
    // Warn once per image, not on every retry while the server is down.
    if (attempt === 0) console.warn('[LIS] translation failed:', nextState.message, url.slice(0, 120));
    if (nextState.willRetry) scheduleTranslationRetry(url, attempt);
  } else {
    retryAttempts.delete(url);
  }
  translations.set(url, nextState);
  scheduleScan();
};

const resetTranslations = () => {
  // Their results would be dropped anyway, so stop the server working on them.
  translationRequests.forEach((controller) => controller.abort());
  translationRequests.clear();
  translations.clear();
  clearTranslationRetries();
  translationGeneration++;
};

// Ignore DOM changes made by our own overlay to avoid a scan loop.
const getIsOwnMutation = (mutation: MutationRecord) =>
  overlayRoot.contains(mutation.target) ||
  [...mutation.addedNodes, ...mutation.removedNodes].every((node) => node === overlayRoot);

const mutationObserver = new MutationObserver((mutations) => {
  if (mutations.every(getIsOwnMutation)) return;
  // Style/class changes (e.g. page flips by CSS transform) move marks without scrolling.
  scheduleReposition();
  scheduleScan();
});

// img load events do not bubble; listen in the capture phase.
const handleImageLoad = (event: Event) => {
  if (event.target instanceof HTMLImageElement) scheduleScan();
};

const stopContentScript = () => {
  mutationObserver.disconnect();
  document.removeEventListener('load', handleImageLoad, true);
  window.removeEventListener('resize', scheduleScan);
  document.removeEventListener('scroll', scheduleReposition, { capture: true });
  document.removeEventListener('transitionend', scheduleReposition, true);
  document.removeEventListener('animationend', scheduleReposition, true);
  document.removeEventListener('scroll', scheduleScan, { capture: true });
  document.removeEventListener('transitionend', scheduleScan, true);
  document.removeEventListener('animationend', scheduleScan, true);
  document.removeEventListener('visibilitychange', scheduleScan);
  clearTimeout(scanTimer);
  clearTimeout(retryScanTimer);
  clearTranslationRetries();
  // Stale marks would no longer follow the page.
  updateMarks([]);
  overlayRoot.remove();
};

const init = async () => {
  settings = await getSettings();
  setMinFontSize(settings.translation.minFontSize);
  scan();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    // A new API key may fix failed translations.
    if (areaName === 'local' && changes[API_KEY_STORAGE_KEY]) {
      resetTranslations();
      scan();
      return;
    }
    if (areaName !== 'sync' || !changes[STORAGE_KEY]) return;
    const nextSettings = mergeSettings(changes[STORAGE_KEY].newValue as Partial<Settings> | undefined);
    if (getIsTranslationRequestChanged(settings.translation, nextSettings.translation)) {
      resetTranslations();
    }
    settings = nextSettings;
    setMinFontSize(settings.translation.minFontSize);
    scan();
  });
  mutationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'srcset', 'width', 'height', 'style', 'class'],
  });
  document.addEventListener('load', handleImageLoad, true);
  // Display size changes the oversize ratio.
  window.addEventListener('resize', scheduleScan);
  document.addEventListener('scroll', scheduleReposition, { capture: true, passive: true });
  // CSS transitions end without a mutation; settle marks at the final position.
  document.addEventListener('transitionend', scheduleReposition, true);
  document.addEventListener('animationend', scheduleReposition, true);
  // Scrolls and page flips move images on or off screen, which starts or cancels requests.
  document.addEventListener('scroll', scheduleScan, { capture: true, passive: true });
  document.addEventListener('transitionend', scheduleScan, true);
  document.addEventListener('animationend', scheduleScan, true);
  // Tainted canvases can only be screenshotted while the tab is in front.
  document.addEventListener('visibilitychange', scheduleScan);
};

void init();
