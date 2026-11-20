import type { Dialogue } from '../types';
import { layoutText, type MeasureTextWidth } from '../utils/translation';

const FONT_FAMILY = '"Noto Sans CJK TC", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
// Bubbles are often ellipses: round the corners and keep text away from them.
const CORNER_RADIUS_RATIO = 0.3;
const TEXT_PADDING_RATIO = 0.1;

// Draw translated text over each dialogue box; everything else stays transparent.
export const drawDialogues = (
  canvas: HTMLCanvasElement,
  dialogues: Dialogue[],
  width: number,
  height: number,
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

  for (const { box, translation } of dialogues) {
    const boxX = box.x * width;
    const boxY = box.y * height;
    const boxWidth = box.width * width;
    const boxHeight = box.height * height;

    context.fillStyle = 'rgba(255, 255, 255, 0.96)';
    context.beginPath();
    context.roundRect(boxX, boxY, boxWidth, boxHeight, Math.min(boxWidth, boxHeight) * CORNER_RADIUS_RATIO);
    context.fill();

    const layout = layoutText(
      translation,
      boxWidth * (1 - TEXT_PADDING_RATIO * 2),
      boxHeight * (1 - TEXT_PADDING_RATIO * 2),
      measureTextWidth,
    );
    context.font = `bold ${layout.fontSize}px ${FONT_FAMILY}`;
    context.fillStyle = '#111';
    const firstLineY = boxY + boxHeight / 2 - ((layout.lines.length - 1) * layout.lineHeight) / 2;
    layout.lines.forEach((line, index) => {
      context.fillText(line, boxX + boxWidth / 2, firstLineY + index * layout.lineHeight);
    });
  }
};
