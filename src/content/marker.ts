import type { Dialogue, TranslationState } from '../types';
import { getBadgeText } from '../utils';
import type { ImageCandidate } from './collectImages';
import { drawDialogues } from './translationLayer';

const MARK_ATTRIBUTE = 'data-lis-marked';

export type Mark = ImageCandidate & { translation?: TranslationState };

type MarkView = {
  badge: HTMLElement;
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

const positionMarks = () => {
  isRepositionScheduled = false;
  for (const [element, view] of views) {
    const rect = element.getBoundingClientRect();
    view.badge.style.transform = `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`;
    if (!view.canvas || !view.dialogues) continue;
    // Not rounded: the canvas must line up with the image exactly.
    view.canvas.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
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
  const nextElements = new Set(marks.map((mark) => mark.element));
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
      view = { badge: document.createElement('lis-badge') };
      overlayRoot.append(view.badge);
      views.set(element, view);
      element.setAttribute(MARK_ATTRIBUTE, '');
    }
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
