import { describe, expect, it } from 'vitest';
import type { Box } from '../types';
import {
  getIsRetryableStatus,
  getReasoningParams,
  getRetryDelay,
  getResizedSize,
  layoutText,
  mapBoxToRegion,
  normalizeBox,
  parseDialogues,
  type MeasureTextWidth,
} from './translation';

// Every character is one font-size wide.
const measureTextWidth: MeasureTextWidth = (text, fontSize) => [...text].length * fontSize;

const expectBoxCloseTo = (box: Box | undefined, expected: Box) => {
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(box?.[key]).toBeCloseTo(expected[key]);
  }
};

describe('getResizedSize', () => {
  it('scales the long edge down to maxEdge', () => {
    expect(getResizedSize(3200, 1600, 1600)).toEqual({ width: 1600, height: 800 });
    expect(getResizedSize(849, 1200, 1000)).toEqual({ width: 708, height: 1000 });
  });

  it('never scales up', () => {
    expect(getResizedSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
});

describe('normalizeBox', () => {
  it('converts to ratios', () => {
    expectBoxCloseTo(normalizeBox([100, 200, 300, 600], 1000, 1000), { x: 0.1, y: 0.2, width: 0.2, height: 0.4 });
  });

  it('fixes swapped corners and clamps to the image', () => {
    expectBoxCloseTo(normalizeBox([300, 600, -50, 200], 1000, 1000), { x: 0, y: 0.2, width: 0.3, height: 0.4 });
  });

  it('drops empty boxes', () => {
    expect(normalizeBox([100, 100, 100, 300], 1000, 1000)).toBeUndefined();
  });
});

describe('parseDialogues', () => {
  const content = JSON.stringify({
    dialogues: [{ box: [75, 50, 475, 183], text: 'こんにちは', translation: '你好' }],
  });

  it('parses 0-1000 boxes into ratios', () => {
    const [dialogue] = parseDialogues(content, 800, 1200);
    expect(dialogue.translation).toBe('你好');
    expect(dialogue.box.x).toBeCloseTo(0.075);
    expect(dialogue.box.height).toBeCloseTo(0.133);
  });

  it('accepts markdown fences around the JSON', () => {
    expect(parseDialogues('```json\n' + content + '\n```', 800, 1200)).toHaveLength(1);
  });

  it('treats coordinates above 1000 as pixels of the sent image', () => {
    const pixelContent = JSON.stringify({ dialogues: [{ box: [80, 600, 400, 1200], translation: '等等' }] });
    const [dialogue] = parseDialogues(pixelContent, 800, 1200);
    expectBoxCloseTo(dialogue.box, { x: 0.1, y: 0.5, width: 0.4, height: 0.5 });
    expect(dialogue.text).toBe('');
  });

  it('drops items with invalid boxes or empty translations', () => {
    const messyContent = JSON.stringify({
      dialogues: [
        { box: [1, 2, 3], translation: 'a' },
        { box: [0, 0, 100, 100], translation: '  ' },
        { box: [0, 0, 100, 'x'], translation: 'b' },
        null,
        { box: [0, 0, 100, 100], translation: 'ok' },
      ],
    });
    expect(parseDialogues(messyContent, 800, 1200).map((dialogue) => dialogue.translation)).toEqual(['ok']);
  });

  it('returns no dialogues when the list is missing', () => {
    expect(parseDialogues('{}', 800, 1200)).toEqual([]);
  });

  it('throws when the response is not JSON', () => {
    expect(() => parseDialogues('Sorry, I cannot help.', 800, 1200)).toThrow('not JSON');
  });
});

describe('layoutText', () => {
  it('wraps CJK text per character', () => {
    const layout = layoutText('今天天氣真好', 30, 200, measureTextWidth, 18);
    expect(layout.lines.join('')).toBe('今天天氣真好');
    expect(layout.lines.every((line) => line.length * layout.fontSize <= 30)).toBe(true);
  });

  it('keeps explicit line breaks', () => {
    expect(layoutText('你好！\n天氣真好', 200, 200, measureTextWidth, 18).lines).toEqual(['你好！', '天氣真好']);
  });

  it('wraps Latin text by words', () => {
    const layout = layoutText('hello big world', 60, 100, measureTextWidth, 18);
    expect(layout.lines).toEqual(['hello', 'big', 'world']);
  });

  it('uses the largest font size that fits, capped at 28', () => {
    expect(layoutText('你好', 1000, 1000, measureTextWidth, 18).fontSize).toBe(28);
    // 4 chars in a 40x48 box: 2 lines of 2 chars at 20px fit (height 48).
    expect(layoutText('今天天氣', 40, 48, measureTextWidth, 18).fontSize).toBe(20);
  });

  it('does not start a line with closing punctuation', () => {
    const layout = layoutText('等等！', 20, 1000, measureTextWidth, 18);
    expect(layout.lines.some((line) => line.startsWith('！'))).toBe(false);
  });

  it('falls back to the minimum font size when nothing fits', () => {
    expect(layoutText('這段文字太長了放不下', 10, 10, measureTextWidth, 18).fontSize).toBe(18);
  });
});

describe('getReasoningParams', () => {
  it('sends nothing when empty so the server decides', () => {
    expect(getReasoningParams('  ')).toEqual({});
  });

  it('turns thinking off for none, also via chat_template_kwargs', () => {
    expect(getReasoningParams('none')).toEqual({
      reasoning_effort: 'none',
      chat_template_kwargs: { enable_thinking: false },
    });
  });

  it('passes any other value through, including custom ones', () => {
    expect(getReasoningParams('high')).toEqual({ reasoning_effort: 'high' });
    expect(getReasoningParams(' max ')).toEqual({ reasoning_effort: 'max' });
  });
});

describe('mapBoxToRegion', () => {
  it('maps a box inside a cropped region back to the whole element', () => {
    // Region: right half, top 80% of the element.
    const region = { x: 0.5, y: 0, width: 0.5, height: 0.8 };
    expectBoxCloseTo(mapBoxToRegion({ x: 0.2, y: 0.5, width: 0.4, height: 0.25 }, region), {
      x: 0.6,
      y: 0.4,
      width: 0.2,
      height: 0.2,
    });
  });

  it('keeps boxes unchanged for a full region', () => {
    const box = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
    expect(mapBoxToRegion(box, { x: 0, y: 0, width: 1, height: 1 })).toEqual(box);
  });
});

describe('getIsRetryableStatus', () => {
  it('retries server errors and rate limits', () => {
    expect([500, 502, 503, 504, 429].map(getIsRetryableStatus)).toEqual([true, true, true, true, true]);
  });

  it('does not retry client errors that need a settings change', () => {
    expect([400, 401, 403, 404].map(getIsRetryableStatus)).toEqual([false, false, false, false]);
  });
});

describe('getRetryDelay', () => {
  it('doubles from 5s and caps at 60s', () => {
    expect([0, 1, 2, 3, 4, 10].map(getRetryDelay)).toEqual([5000, 10000, 20000, 40000, 60000, 60000]);
  });
});
