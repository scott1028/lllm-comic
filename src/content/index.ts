import { DEFAULT_SETTINGS, GET_FILE_SIZES, STORAGE_KEY } from '../constants';
import type { FileSizes, GetFileSizesMessage, Settings } from '../types';
import { evaluateRules } from '../utils';
import { getSettings } from '../utils/settings';
import { collectImages, type ImageCandidate } from './collectImages';
import { overlayRoot, scheduleReposition, updateMarks } from './marker';

const SCAN_DELAY_MS = 500;

let settings: Settings = DEFAULT_SETTINGS;
// Sizes from the service worker; null = lookup failed.
const fileSizes = new Map<string, number | null>();
const pendingUrls = new Set<string>();
let scanTimer: ReturnType<typeof setTimeout> | undefined;

const scan = () => {
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
  updateMarks(matchedCandidates);
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

const requestFileSizes = async (urls: string[]) => {
  urls.forEach((url) => pendingUrls.add(url));
  try {
    const message: GetFileSizesMessage = { type: GET_FILE_SIZES, urls };
    const sizes: FileSizes = await chrome.runtime.sendMessage(message);
    urls.forEach((url) => fileSizes.set(url, sizes[url] ?? null));
  } catch {
    // Extension was reloaded; this content script is orphaned.
    return;
  } finally {
    urls.forEach((url) => pendingUrls.delete(url));
  }
  scheduleScan();
};

// Ignore DOM changes made by our own overlay to avoid a scan loop.
const getIsOwnMutation = (mutation: MutationRecord) =>
  overlayRoot.contains(mutation.target) ||
  [...mutation.addedNodes, ...mutation.removedNodes].every((node) => node === overlayRoot);

const init = async () => {
  settings = await getSettings();
  scan();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !changes[STORAGE_KEY]) return;
    settings = (changes[STORAGE_KEY].newValue as Settings | undefined) ?? DEFAULT_SETTINGS;
    scan();
  });
  new MutationObserver((mutations) => {
    if (!mutations.every(getIsOwnMutation)) scheduleScan();
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'srcset'],
  });
  // img load events do not bubble; listen in the capture phase.
  document.addEventListener(
    'load',
    (event) => {
      if (event.target instanceof HTMLImageElement) scheduleScan();
    },
    true,
  );
  // Display size changes the oversize ratio.
  window.addEventListener('resize', scheduleScan);
  document.addEventListener('scroll', scheduleReposition, { capture: true, passive: true });
};

void init();
