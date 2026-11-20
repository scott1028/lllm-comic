import { getBadgeText } from '../utils';
import type { ImageCandidate } from './collectImages';

const MARK_ATTRIBUTE = 'data-lis-marked';

// Custom tag names avoid page rules like `div { ... }`.
export const overlayRoot = document.createElement('lis-overlay');

const badges = new Map<Element, HTMLElement>();
let isRepositionScheduled = false;

const positionBadges = () => {
  isRepositionScheduled = false;
  for (const [element, badge] of badges) {
    const rect = element.getBoundingClientRect();
    badge.style.transform = `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`;
  }
};

export const scheduleReposition = () => {
  if (isRepositionScheduled) return;
  isRepositionScheduled = true;
  requestAnimationFrame(positionBadges);
};

// Diff against current marks so unchanged badges are not recreated.
export const updateMarks = (candidates: ImageCandidate[]) => {
  const nextElements = new Set(candidates.map((candidate) => candidate.element));
  for (const [element, badge] of badges) {
    if (nextElements.has(element)) continue;
    element.removeAttribute(MARK_ATTRIBUTE);
    badge.remove();
    badges.delete(element);
  }
  for (const { element, metrics } of candidates) {
    let badge = badges.get(element);
    if (!badge) {
      badge = document.createElement('lis-badge');
      overlayRoot.append(badge);
      badges.set(element, badge);
      element.setAttribute(MARK_ATTRIBUTE, '');
    }
    const badgeText = getBadgeText(metrics);
    if (badge.textContent !== badgeText) badge.textContent = badgeText;
  }
  if (badges.size > 0 && !overlayRoot.isConnected) document.documentElement.append(overlayRoot);
  positionBadges();
};
