// Byte size of the payload in a data: URL.
export const getDataUrlByteSize = (url: string): number => {
  const commaIndex = url.indexOf(',');
  const header = url.slice(0, commaIndex);
  const body = url.slice(commaIndex + 1);
  if (header.endsWith(';base64')) {
    const padding = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
    return Math.floor((body.length * 3) / 4) - padding;
  }
  try {
    return new TextEncoder().encode(decodeURIComponent(body)).length;
  } catch {
    // Malformed percent-encoding: fall back to raw length.
    return body.length;
  }
};

// "bytes 0-0/12345" or "bytes */12345" -> 12345; unknown total "/*" -> null.
export const getContentRangeTotal = (contentRange: string | null): number | null => {
  const match = contentRange?.match(/\/(\d+)\s*$/);
  return match ? Number(match[1]) : null;
};
