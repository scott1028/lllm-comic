import { describe, expect, it } from 'vitest';
import { getRefererRule } from './referer';

const imageUrl = 'https://eu.hamreus.com/ps4/a/001.jpg.webp?e=1&m=abc';
const pageUrl = 'https://www.manhuagui.com/comic/52083/924542.html';

describe('getRefererRule', () => {
  it('sets Referer to the page origin for this exact URL, only on extension requests', () => {
    expect(getRefererRule(7, imageUrl, pageUrl)).toEqual({
      id: 7,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'Referer', operation: 'set', value: 'https://www.manhuagui.com/' }],
      },
      condition: { urlFilter: `|${imageUrl}|`, tabIds: [-1] },
    });
  });

  it('returns undefined for a data: URL, which makes no network request', () => {
    expect(getRefererRule(1, 'data:image/jpeg;base64,AAAA', pageUrl)).toBeUndefined();
  });

  it('returns undefined when the page URL is unknown', () => {
    expect(getRefererRule(1, imageUrl, undefined)).toBeUndefined();
  });
});
