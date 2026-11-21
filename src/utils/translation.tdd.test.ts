import { describe, expect, it } from 'vitest';
import { layoutText, separateRects, type MeasureTextWidth } from './translation';

// One unit per character at the given font size.
const measureTextWidth: MeasureTextWidth = (text, fontSize) => [...text].length * fontSize;

describe('layoutText width', () => {
  it('is the text width when it fits on one line', () => {
    expect(layoutText('你好', 1000, 1000, measureTextWidth, 18).width).toBe(56);
  });

  it('is the widest wrapped line, within the available width', () => {
    const layout = layoutText('今天天氣真好啊', 30, 200, measureTextWidth, 18);
    const widestLine = Math.max(...layout.lines.map((line) => measureTextWidth(line, layout.fontSize)));
    expect(layout.width).toBe(widestLine);
    expect(layout.width).toBeLessThanOrEqual(30);
  });

  it('is measured at the minimum font size when nothing fits', () => {
    const layout = layoutText('這段文字太長了放不下', 10, 10, measureTextWidth, 18);
    const widestLine = Math.max(...layout.lines.map((line) => measureTextWidth(line, 18)));
    expect(layout.width).toBe(widestLine);
  });
});

describe('separateRects', () => {
  it('keeps rects that are already apart', () => {
    const rects = [
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 0, y: 20, width: 10, height: 10 },
    ];
    expect(separateRects(rects, 4)).toEqual(rects);
  });

  it('keeps side-by-side rects in place', () => {
    const rects = [
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 20, y: 5, width: 10, height: 10 },
    ];
    expect(separateRects(rects, 4)).toEqual(rects);
  });

  it('moves the lower of two overlapping rects below the upper one, keeping input order', () => {
    const upper = { x: 0, y: 0, width: 10, height: 10 };
    const lower = { x: 5, y: 6, width: 10, height: 10 };
    expect(separateRects([lower, upper], 4)).toEqual([{ ...lower, y: 14 }, upper]);
  });

  it('moves a rect that is closer than the gap', () => {
    const rects = [
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 0, y: 12, width: 10, height: 10 },
    ];
    expect(separateRects(rects, 4)[1].y).toBe(14);
  });

  it('pushes a stack of overlapping rects down one after another', () => {
    const rects = [0, 2, 4].map((y) => ({ x: 0, y, width: 10, height: 10 }));
    expect(separateRects(rects, 4).map((rect) => rect.y)).toEqual([0, 14, 28]);
  });
});

describe('layoutText minFontSize', () => {
  it('falls back to the given minimum when nothing fits', () => {
    expect(layoutText('這段文字太長了放不下', 10, 10, measureTextWidth, 12).fontSize).toBe(12);
  });

  it('still grows text in large boxes up to 28px', () => {
    expect(layoutText('你好', 1000, 1000, measureTextWidth, 12).fontSize).toBe(28);
  });

  it('uses the minimum as a fixed size when it is above 28px', () => {
    expect(layoutText('你好', 1000, 1000, measureTextWidth, 36).fontSize).toBe(36);
  });
});
