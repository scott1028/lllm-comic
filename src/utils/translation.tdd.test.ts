import { describe, expect, it } from 'vitest';
import { layoutText, type MeasureTextWidth } from './translation';

// One unit per character at the given font size.
const measureTextWidth: MeasureTextWidth = (text, fontSize) => [...text].length * fontSize;

describe('layoutText width', () => {
  it('is the text width when it fits on one line', () => {
    expect(layoutText('你好', 1000, 1000, measureTextWidth).width).toBe(56);
  });

  it('is the widest wrapped line, within the available width', () => {
    const layout = layoutText('今天天氣真好啊', 30, 200, measureTextWidth);
    const widestLine = Math.max(...layout.lines.map((line) => measureTextWidth(line, layout.fontSize)));
    expect(layout.width).toBe(widestLine);
    expect(layout.width).toBeLessThanOrEqual(30);
  });

  it('is measured at the minimum font size when nothing fits', () => {
    const layout = layoutText('這段文字太長了放不下', 10, 10, measureTextWidth);
    const widestLine = Math.max(...layout.lines.map((line) => measureTextWidth(line, 8)));
    expect(layout.width).toBe(widestLine);
  });
});
