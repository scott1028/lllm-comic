import type { Box, Dialogue } from '../types';

const RETRY_BASE_DELAY_MS = 5_000;
const RETRY_MAX_DELAY_MS = 60_000;

const MAX_FONT_SIZE = 28;
const LINE_HEIGHT_RATIO = 1.2;

// Latin words stay whole; everything else (CJK, punctuation) wraps per character.
const TOKEN_PATTERN = /[A-Za-z0-9'’.,!?;:()-]+\s*|\s+|./gu;
// Closing punctuation should not start a line (kinsoku).
const NO_LINE_START_PATTERN = /^[、。，．,.！？!?）」』〉》】…ー~～]/u;

export type MeasureTextWidth = (text: string, fontSize: number) => number;

// width: widest line.
export type TextLayout = { fontSize: number; lineHeight: number; lines: string[]; width: number };

export const getTranslationPrompt = (targetLanguage: string): string =>
  'You are a manga translator. Find every speech bubble, thought bubble and narration box in the image. ' +
  'Ignore sound effects and background text. ' +
  `For each one, return its bounding box and its text translated into ${targetLanguage}. ` +
  'Respond with JSON only, no markdown: ' +
  '{"dialogues":[{"box":[x1,y1,x2,y2],"text":"original text","translation":"translated text"}]}. ' +
  'Box coordinates are integers from 0 to 1000, relative to the image width and height.';

// 5xx and 429 are temporary; other 4xx (bad key, unknown model) need a settings change.
export const getIsRetryableStatus = (status: number): boolean => status >= 500 || status === 429;

// 5s, 10s, 20s, 40s, then every 60s until the server is back.
export const getRetryDelay = (attempt: number): number =>
  Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);

// Extra request fields for the reasoning level.
export const getReasoningParams = (reasoningEffort: string): Record<string, unknown> => {
  const effort = reasoningEffort.trim();
  if (!effort) return {};
  if (effort === 'none') {
    // enable_thinking covers servers that ignore reasoning_effort (Qwen chat templates).
    return { reasoning_effort: 'none', chat_template_kwargs: { enable_thinking: false } };
  }
  return { reasoning_effort: effort };
};

// Boxes from a cropped region (ratios of the region) -> ratios of the whole element.
export const mapBoxToRegion = (box: Box, region: Box): Box => ({
  x: region.x + box.x * region.width,
  y: region.y + box.y * region.height,
  width: box.width * region.width,
  height: box.height * region.height,
});

// Scale down only, keeping the aspect ratio.
export const getResizedSize = (
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } => {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
};

// [x1, y1, x2, y2] in `scale` units -> ratios clamped to the image.
export const normalizeBox = (
  [x1, y1, x2, y2]: number[],
  scaleX: number,
  scaleY: number,
): Box | undefined => {
  const clamp = (ratio: number) => Math.min(1, Math.max(0, ratio));
  const left = clamp(Math.min(x1, x2) / scaleX);
  const top = clamp(Math.min(y1, y2) / scaleY);
  const right = clamp(Math.max(x1, x2) / scaleX);
  const bottom = clamp(Math.max(y1, y2) / scaleY);
  if (right <= left || bottom <= top) return undefined;
  return { x: left, y: top, width: right - left, height: bottom - top };
};

type RawDialogue = { box?: unknown; text?: unknown; translation?: unknown };

const getIsValidBox = (box: unknown): box is number[] =>
  Array.isArray(box) && box.length === 4 && box.every((n) => typeof n === 'number' && Number.isFinite(n));

// sentWidth/sentHeight: size of the image sent to the model, used when it answers in pixels.
export const parseDialogues = (content: string, sentWidth: number, sentHeight: number): Dialogue[] => {
  // Tolerate ```json fences or text around the JSON object.
  const jsonText = content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1);
  let parsed: { dialogues?: unknown };
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(`Model response is not JSON: ${content.slice(0, 200)}`);
  }
  if (!Array.isArray(parsed.dialogues)) return [];

  const rawDialogues = (parsed.dialogues as RawDialogue[]).filter(
    (raw): raw is RawDialogue & { box: number[]; translation: string } =>
      getIsValidBox(raw?.box) && typeof raw.translation === 'string' && raw.translation.trim() !== '',
  );
  // Models are asked for 0-1000; any larger value means they answered in pixels.
  const isPixelScale = rawDialogues.some((raw) => raw.box.some((n) => n > 1000));
  const scaleX = isPixelScale ? sentWidth : 1000;
  const scaleY = isPixelScale ? sentHeight : 1000;

  return rawDialogues.flatMap((raw) => {
    const box = normalizeBox(raw.box, scaleX, scaleY);
    if (!box) return [];
    return [{ box, text: typeof raw.text === 'string' ? raw.text : '', translation: raw.translation.trim() }];
  });
};

const wrapText = (
  text: string,
  maxWidth: number,
  fontSize: number,
  measureTextWidth: MeasureTextWidth,
): string[] => {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const token of paragraph.match(TOKEN_PATTERN) ?? []) {
      const candidate = line + token;
      const isOverflow = measureTextWidth(candidate.trimEnd(), fontSize) > maxWidth;
      if (line === '' || !isOverflow || NO_LINE_START_PATTERN.test(token)) {
        line = candidate;
        continue;
      }
      lines.push(line.trimEnd());
      line = token.trimStart();
    }
    lines.push(line.trimEnd());
  }
  return lines;
};

// Rectangle in canvas pixels.
export type PixelRect = { x: number; y: number; width: number; height: number };

// Closer than `gap` on both axes counts as overlapping.
const getIsOverlapping = (a: PixelRect, b: PixelRect, gap: number): boolean =>
  a.x < b.x + b.width + gap &&
  b.x < a.x + a.width + gap &&
  a.y < b.y + b.height + gap &&
  b.y < a.y + a.height + gap;

// Top rect first, push each overlapping rect down below the one it hits. Output keeps input order.
export const separateRects = (rects: PixelRect[], gap: number): PixelRect[] => {
  const separatedRects = [...rects];
  const placedRects: PixelRect[] = [];
  const topFirstIndexes = rects.map((_, index) => index).sort((a, b) => rects[a].y - rects[b].y);
  for (const index of topFirstIndexes) {
    let rect = rects[index];
    let blockingRect = placedRects.find((placed) => getIsOverlapping(rect, placed, gap));
    while (blockingRect) {
      rect = { ...rect, y: blockingRect.y + blockingRect.height + gap };
      blockingRect = placedRects.find((placed) => getIsOverlapping(rect, placed, gap));
    }
    placedRects.push(rect);
    separatedRects[index] = rect;
  }
  return separatedRects;
};

// Largest font size whose wrapped lines fit the box; overflows at minFontSize.
// A minFontSize above MAX_FONT_SIZE is used as a fixed size.
export const layoutText = (
  text: string,
  boxWidth: number,
  boxHeight: number,
  measureTextWidth: MeasureTextWidth,
  minFontSize: number,
): TextLayout => {
  const startFontSize = Math.min(MAX_FONT_SIZE, Math.floor(boxHeight / LINE_HEIGHT_RATIO));
  for (let fontSize = startFontSize; fontSize > minFontSize; fontSize--) {
    const lines = wrapText(text, boxWidth, fontSize, measureTextWidth);
    const lineHeight = fontSize * LINE_HEIGHT_RATIO;
    const width = Math.max(...lines.map((line) => measureTextWidth(line, fontSize)));
    const isFit = lines.length * lineHeight <= boxHeight && width <= boxWidth;
    if (isFit) return { fontSize, lineHeight, lines, width };
  }
  const lines = wrapText(text, boxWidth, minFontSize, measureTextWidth);
  return {
    fontSize: minFontSize,
    lineHeight: minFontSize * LINE_HEIGHT_RATIO,
    lines,
    width: Math.max(...lines.map((line) => measureTextWidth(line, minFontSize))),
  };
};
