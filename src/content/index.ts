import {
  API_KEY_STORAGE_KEY,
  DEFAULT_SETTINGS,
  GET_FILE_SIZES,
  STORAGE_KEY,
  TRANSLATE_IMAGE,
} from '../constants';
import type {
  FileSizes,
  GetFileSizesMessage,
  Settings,
  TranslateImageMessage,
  TranslateImageResponse,
  TranslationState,
} from '../types';
import { evaluateRules } from '../utils';
import { getBlobDataUrl } from '../utils/blob';
import { getSettings, mergeSettings } from '../utils/settings';
import { collectImages, type ImageCandidate } from './collectImages';
import { overlayRoot, scheduleReposition, updateMarks } from './marker';

const SCAN_DELAY_MS = 500;

let settings: Settings = DEFAULT_SETTINGS;
// Sizes from the service worker; null = lookup failed.
const fileSizes = new Map<string, number | null>();
const pendingUrls = new Set<string>();
// Keyed by image URL.
const translations = new Map<string, TranslationState>();
// Bumped when translations are reset, so late responses for old settings are dropped.
let translationGeneration = 0;
let scanTimer: ReturnType<typeof setTimeout> | undefined;

// After the extension reloads, this script keeps running in open tabs but chrome.* calls fail.
const getIsExtensionContextValid = () => Boolean(chrome.runtime?.id);

const scan = () => {
  if (!getIsExtensionContextValid()) {
    stopContentScript();
    return;
  }
  if (!settings.isEnabled) {
    updateMarks([]);
    return;
  }
  const matchedCandidates: ImageCandidate[] = [];
  const unknownUrls = new Set<string>();
  for (const candidate of collectImages()) {
    const { metrics } = candidate;
    if (metrics.fileSizeBytes === undefined && fileSizes.has(metrics.url)) {
      metrics.fileSizeBytes = fileSizes.get(metrics.url);
    }
    const ruleResult = evaluateRules(metrics, settings);
    if (ruleResult === true) matchedCandidates.push(candidate);
    else if (ruleResult === 'unknown' && !pendingUrls.has(metrics.url)) unknownUrls.add(metrics.url);
  }
  const isTranslationEnabled = settings.translation.isEnabled;
  if (isTranslationEnabled) {
    for (const { metrics } of matchedCandidates) {
      if (!translations.has(metrics.url)) void requestTranslation(metrics.url);
    }
  }
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

const requestTranslation = async (url: string) => {
  const generation = translationGeneration;
  // Set synchronously so the same scan does not request it twice.
  translations.set(url, { status: 'pending' });
  let nextState: TranslationState;
  try {
    // blob: URLs only resolve inside this page, so send their bytes instead.
    const source = url.startsWith('blob:') ? await getBlobDataUrl(await (await fetch(url)).blob()) : url;
    const message: TranslateImageMessage = { type: TRANSLATE_IMAGE, source };
    const response: TranslateImageResponse = await chrome.runtime.sendMessage(message);
    nextState =
      'error' in response
        ? { status: 'error', message: response.error }
        : { status: 'done', dialogues: response.dialogues };
  } catch (error) {
    // Orphaned by an extension reload: stop quietly; the refreshed page gets a new script.
    if (!getIsExtensionContextValid()) {
      stopContentScript();
      return;
    }
    nextState = { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
  if (generation !== translationGeneration) return;
  if (nextState.status === 'error') console.warn('[LIS] translation failed:', nextState.message, url.slice(0, 120));
  translations.set(url, nextState);
  scheduleScan();
};

const resetTranslations = () => {
  translations.clear();
  translationGeneration++;
};

// Ignore DOM changes made by our own overlay to avoid a scan loop.
const getIsOwnMutation = (mutation: MutationRecord) =>
  overlayRoot.contains(mutation.target) ||
  [...mutation.addedNodes, ...mutation.removedNodes].every((node) => node === overlayRoot);

const mutationObserver = new MutationObserver((mutations) => {
  if (!mutations.every(getIsOwnMutation)) scheduleScan();
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
  clearTimeout(scanTimer);
  // Stale marks would no longer follow the page.
  updateMarks([]);
  overlayRoot.remove();
};

const init = async () => {
  settings = await getSettings();
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
    if (JSON.stringify(nextSettings.translation) !== JSON.stringify(settings.translation)) {
      resetTranslations();
    }
    settings = nextSettings;
    scan();
  });
  mutationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'srcset'],
  });
  document.addEventListener('load', handleImageLoad, true);
  // Display size changes the oversize ratio.
  window.addEventListener('resize', scheduleScan);
  document.addEventListener('scroll', scheduleReposition, { capture: true, passive: true });
};

void init();
