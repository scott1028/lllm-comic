import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRANSLATE_IMAGE } from '../constants';

// DEFAULT_SETTINGS apiBaseUrl + /chat/completions
const API_URL = 'http://127.0.0.1:8888/v1/chat/completions';
const IMAGE_A = 'data:image/png;base64,AQID';
const IMAGE_B = 'data:image/png;base64,BAUG';

const realFetch = globalThis.fetch;

let apiSignals: (AbortSignal | null | undefined)[];
let cacheReads: number;
let platformInfoCalls: number;
let connectListeners: ((port: chrome.runtime.Port) => void)[];
// The first API call waits for this, so later requests queue up behind it.
let releaseFirstApiCall: () => void;

// A content script's end of a translation port.
const connectPort = () => {
  const messageListeners: ((message: unknown) => void)[] = [];
  const disconnectListeners: (() => void)[] = [];
  const postedMessages: unknown[] = [];
  const port = {
    name: TRANSLATE_IMAGE,
    sender: {},
    onMessage: { addListener: (listener: (message: unknown) => void) => messageListeners.push(listener) },
    onDisconnect: { addListener: (listener: () => void) => disconnectListeners.push(listener) },
    postMessage: (message: unknown) => postedMessages.push(message),
  };
  connectListeners.forEach((listener) => listener(port as unknown as chrome.runtime.Port));
  return {
    postedMessages,
    send: (message: unknown) => messageListeners.forEach((listener) => listener(message)),
    disconnect: () => disconnectListeners.forEach((listener) => listener()),
  };
};

describe('background translation', () => {
  beforeEach(() => {
    vi.resetModules();
    apiSignals = [];
    cacheReads = 0;
    platformInfoCalls = 0;
    connectListeners = [];
    const firstApiGate = new Promise<void>((resolve) => {
      releaseFirstApiCall = resolve;
    });
    const storage = new Map<string, unknown>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url !== API_URL) return realFetch(url);
        apiSignals.push(init?.signal);
        if (apiSignals.length === 1) await firstApiGate;
        // Real fetch rejects once its signal is aborted.
        init?.signal?.throwIfAborted();
        return Response.json({ choices: [{ message: { content: '{"dialogues":[]}' } }] });
      }),
    );
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: { addListener: () => {} },
        onConnect: { addListener: (listener: (port: chrome.runtime.Port) => void) => connectListeners.push(listener) },
        getPlatformInfo: async () => {
          platformInfoCalls++;
          return {};
        },
      },
      storage: {
        sync: { get: async () => ({}) },
        local: {
          get: async (key: string) => {
            if (key.startsWith('translation:')) cacheReads++;
            return storage.has(key) ? { [key]: storage.get(key) } : {};
          },
          set: async (items: Record<string, unknown>) => {
            Object.entries(items).forEach(([key, value]) => storage.set(key, value));
          },
        },
      },
    });
    vi.stubGlobal('createImageBitmap', async () => ({ width: 100, height: 100, close: () => {} }));
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext = () => ({ drawImage: () => {} });
        convertToBlob = async () => new Blob([new Uint8Array([4])], { type: 'image/jpeg' });
      },
    );
  });

  afterEach(() => {
    releaseFirstApiCall();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('skips the API call when cancelled while waiting in the queue', async () => {
    const { translateImage } = await import('./translate');
    const first = translateImage(IMAGE_A, undefined, new AbortController().signal);
    await vi.waitFor(() => expect(apiSignals).toHaveLength(1));
    const cacheReadsBeforeQueued = cacheReads;
    const controller = new AbortController();
    const queued = translateImage(IMAGE_B, undefined, controller.signal);
    // Cache missed, so it is now waiting behind the first request.
    await vi.waitFor(() => expect(cacheReads).toBeGreaterThan(cacheReadsBeforeQueued));

    controller.abort();
    releaseFirstApiCall();

    await first;
    await expect(queued).rejects.toThrow();
    expect(apiSignals).toHaveLength(1);
  });

  it('aborts the running API request when cancelled', async () => {
    const { translateImage } = await import('./translate');
    const controller = new AbortController();
    const request = translateImage(IMAGE_A, undefined, controller.signal);
    await vi.waitFor(() => expect(apiSignals).toHaveLength(1));

    controller.abort();

    expect(apiSignals[0]?.aborted).toBe(true);
    releaseFirstApiCall();
    await expect(request).rejects.toThrow();
  });

  it('reuses the cached result when the same image waited in the queue', async () => {
    const { translateImage } = await import('./translate');
    const first = translateImage(IMAGE_A, undefined, new AbortController().signal);
    await vi.waitFor(() => expect(apiSignals).toHaveLength(1));
    const cacheReadsBeforeDuplicate = cacheReads;
    // Same image from another tab, before the first one is cached.
    const duplicate = translateImage(IMAGE_A, undefined, new AbortController().signal);
    await vi.waitFor(() => expect(cacheReads).toBeGreaterThan(cacheReadsBeforeDuplicate));

    releaseFirstApiCall();

    await Promise.all([first, duplicate]);
    expect(apiSignals).toHaveLength(1);
  });

  it('posts the dialogues back on the translation port', async () => {
    await import('./index');
    expect(connectListeners).toHaveLength(1);
    const contentPort = connectPort();

    contentPort.send({ type: TRANSLATE_IMAGE, source: IMAGE_A });
    releaseFirstApiCall();

    await vi.waitFor(() => expect(contentPort.postedMessages).toEqual([{ dialogues: [] }]));
  });

  // Chrome stops the service worker 30 s into a fetch unless an extension API call resets its timer.
  it('calls an extension API at least every 30 s while a translation runs, and stops after', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await import('./index');
    const contentPort = connectPort();
    contentPort.send({ type: TRANSLATE_IMAGE, source: IMAGE_A });
    await vi.waitFor(() => expect(apiSignals).toHaveLength(1));

    vi.advanceTimersByTime(60_000);
    expect(platformInfoCalls).toBeGreaterThanOrEqual(2);

    releaseFirstApiCall();
    await vi.waitFor(() => expect(contentPort.postedMessages).toHaveLength(1));
    const callsWhenDone = platformInfoCalls;
    vi.advanceTimersByTime(60_000);
    expect(platformInfoCalls).toBe(callsWhenDone);
  });

  it('aborts the API request and posts nothing when the translation port disconnects', async () => {
    await import('./index');
    const contentPort = connectPort();
    contentPort.send({ type: TRANSLATE_IMAGE, source: IMAGE_A });
    await vi.waitFor(() => expect(apiSignals).toHaveLength(1));

    contentPort.disconnect();
    releaseFirstApiCall();
    // Let the cancelled request settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(apiSignals[0]?.aborted).toBe(true);
    // Chrome throws when posting to a closed port.
    expect(contentPort.postedMessages).toEqual([]);
  });
});
