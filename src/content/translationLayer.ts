import type { Dialogue } from '../types';
import { layoutText, separateRects, type MeasureTextWidth, type PixelRect } from '../utils/translation';

const FONT_FAMILY = '"Noto Sans CJK TC", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
// Bubbles are often ellipses: round the corners and keep text away from them.
const CORNER_RADIUS_RATIO = 0.3;
const TEXT_PADDING_RATIO = 0.1;
// White background hugs the text (padding = font size x ratio), so loose boxes do not hide the art.
// Not capped to the box: text overflowing at the minimum font size must stay readable.
const TEXT_BACKGROUND_PADDING_RATIO = 0.5;
// Overlapping blocks are pushed apart, leaving this gap so each border stays visible.
const BLOCK_GAP = 4;
const BORDER_WIDTH = 2;

// Draw translated text over each dialogue box; everything else stays transparent.
export const drawDialogues = (
  canvas: HTMLCanvasElement,
  dialogues: Dialogue[],
  width: number,
  height: number,
  minFontSize: number,
) => {
  const pixelRatio = window.devicePixelRatio;
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext('2d')!;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);

  const measureTextWidth: MeasureTextWidth = (text, fontSize) => {
    context.font = `bold ${fontSize}px ${FONT_FAMILY}`;
    return context.measureText(text).width;
  };
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  const blocks = dialogues.map(({ box, translation }) => {
    const boxWidth = box.width * width;
    const boxHeight = box.height * height;
    const layout = layoutText(
      translation,
      boxWidth * (1 - TEXT_PADDING_RATIO * 2),
      boxHeight * (1 - TEXT_PADDING_RATIO * 2),
      measureTextWidth,
      minFontSize,
    );
    const backgroundPadding = layout.fontSize * TEXT_BACKGROUND_PADDING_RATIO;
    const backgroundWidth = layout.width + backgroundPadding * 2;
    const backgroundHeight = layout.lines.length * layout.lineHeight + backgroundPadding * 2;
    // Centered on the dialogue box.
    const backgroundRect: PixelRect = {
      x: box.x * width + (boxWidth - backgroundWidth) / 2,
      y: box.y * height + (boxHeight - backgroundHeight) / 2,
      width: backgroundWidth,
      height: backgroundHeight,
    };
    return { layout, backgroundRect };
  });
  const separatedRects = separateRects(
    blocks.map(({ backgroundRect }) => backgroundRect),
    BLOCK_GAP,
  );

  blocks.forEach(({ layout }, index) => {
    const rect = separatedRects[index];
    context.beginPath();
    const cornerRadius = Math.min(rect.width, rect.height) * CORNER_RADIUS_RATIO;
    context.roundRect(rect.x, rect.y, rect.width, rect.height, cornerRadius);
    context.fillStyle = 'rgba(255, 255, 255, 0.96)';
    context.fill();
    context.lineWidth = BORDER_WIDTH;
    context.strokeStyle = '#111';
    context.stroke();

    context.font = `bold ${layout.fontSize}px ${FONT_FAMILY}`;
    context.fillStyle = '#111';
    const firstLineY = rect.y + rect.height / 2 - ((layout.lines.length - 1) * layout.lineHeight) / 2;
    layout.lines.forEach((line, lineIndex) => {
      context.fillText(line, rect.x + rect.width / 2, firstLineY + lineIndex * layout.lineHeight);
    });
  });
};
