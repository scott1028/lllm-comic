import type { Dialogue, TranslationState } from '../types';
import { getBadgeText, getIntersection } from '../utils';
import type { ImageCandidate } from './collectImages';
import { drawDialogues } from './translationLayer';

const MARK_ATTRIBUTE = 'data-lis-marked';

export type Mark = ImageCandidate & { translation?: TranslationState };

type MarkView = {
  badge: HTMLElement;
  // Ancestors with overflow other than visible; marks are cut to their boxes.
  clippingAncestors: Element[];
  canvas?: HTMLCanvasElement;
  dialogues?: Dialogue[];
  // Size the canvas was last drawn at; redraw when it changes.
  drawnSizeKey?: string;
};

// Custom tag names avoid page rules like `div { ... }`.
export const overlayRoot = document.createElement('lis-overlay');

const views = new Map<Element, MarkView>();
let isRepositionScheduled = false;

const getStatusText = (translation: TranslationState | undefined): string => {
  if (!translation) return '';
  if (translation.status === 'pending') return ' · 翻譯中…';
  if (translation.status === 'error') return ' · 翻譯失敗';
  return ` · 已翻譯 ${translation.dialogues.length} 段`;
};

// Readers clip neighbor pages with overflow: hidden; our fixed overlay must do the same.
const getClippingAncestors = (element: Element): Element[] => {
  const ancestors: Element[] = [];
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(node);
    if (overflowX !== 'visible' || overflowY !== 'visible') ancestors.push(node);
  }
  return ancestors;
};

const releaseCanvas = (view: MarkView) => {
  if (!view.canvas || view.drawnSizeKey === undefined) return;
  // A full-page layer can be ~8 MB; whole books have dozens.
  view.canvas.width = 0;
  view.canvas.height = 0;
  view.drawnSizeKey = undefined;
};

const positionMarks = () => {
  isRepositionScheduled = false;
  const viewport = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  for (const [element, view] of views) {
    const rect = element.getBoundingClientRect();
    const visibleRect = getIntersection([
      rect,
      viewport,
      ...view.clippingAncestors.map((ancestor) => ancestor.getBoundingClientRect()),
    ]);
    // Inline style: `all: initial` in content.css would override the hidden attribute.
    view.badge.style.display = visibleRect ? '' : 'none';
    if (!visibleRect) {
      releaseCanvas(view);
      continue;
    }
    view.badge.style.transform = `translate(${Math.round(visibleRect.left)}px, ${Math.round(visibleRect.top)}px)`;
    if (!view.canvas || !view.dialogues) continue;
    // Not rounded: the canvas must line up with the image exactly.
    view.canvas.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
    view.canvas.style.clipPath = `inset(${visibleRect.top - rect.top}px ${rect.right - visibleRect.right}px ${
      rect.bottom - visibleRect.bottom
    }px ${visibleRect.left - rect.left}px)`;
    const sizeKey = `${rect.width}x${rect.height}@${window.devicePixelRatio}`;
    if (view.drawnSizeKey !== sizeKey) {
      drawDialogues(view.canvas, view.dialogues, rect.width, rect.height);
      view.drawnSizeKey = sizeKey;
    }
  }
};

export const scheduleReposition = () => {
  if (isRepositionScheduled) return;
  isRepositionScheduled = true;
  requestAnimationFrame(positionMarks);
};

// Diff against current marks so unchanged badges and canvases are not recreated.
export const updateMarks = (marks: Mark[]) => {
  const nextElements = new Set<Element>(marks.map((mark) => mark.element));
  for (const [element, view] of views) {
    if (nextElements.has(element)) continue;
    element.removeAttribute(MARK_ATTRIBUTE);
    view.badge.remove();
    view.canvas?.remove();
    views.delete(element);
  }
  for (const { element, metrics, translation } of marks) {
    let view = views.get(element);
    if (!view) {
      view = { badge: document.createElement('lis-badge'), clippingAncestors: [] };
      overlayRoot.append(view.badge);
      views.set(element, view);
      element.setAttribute(MARK_ATTRIBUTE, '');
    }
    view.clippingAncestors = getClippingAncestors(element);
    const badgeText = getBadgeText(metrics) + getStatusText(translation);
    if (view.badge.textContent !== badgeText) view.badge.textContent = badgeText;

    const dialogues =
      translation?.status === 'done' && translation.dialogues.length > 0 ? translation.dialogues : undefined;
    if (dialogues && view.dialogues !== dialogues) {
      view.canvas ??= overlayRoot.appendChild(document.createElement('canvas'));
      view.dialogues = dialogues;
      view.drawnSizeKey = undefined;
    } else if (!dialogues && view.canvas) {
      view.canvas.remove();
      view.canvas = undefined;
      view.dialogues = undefined;
    }
  }
  if (views.size > 0 && !overlayRoot.isConnected) document.documentElement.append(overlayRoot);
  positionMarks();
};
