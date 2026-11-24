import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEY } from '../constants';

const IMAGE_HEIGHT = 1400;
// Scans are throttled to one per 500 ms.
const SCAN_WAIT_MS = 600;

type FakeImage = { top: number };
type FakePort = { isDisconnected: boolean };

let images: FakeImage[];
let ports: FakePort[];

// Enough of an element for the marker overlay and badges.
const createFakeElement = () => ({
  style: {},
  textContent: '',
  isConnected: false,
  append: () => {},
  appendChild: <T>(child: T) => child,
  remove: () => {},
  contains: () => false,
  setAttribute: () => {},
  removeAttribute: () => {},
});

// A 1000 x 1400 page image; move it by changing top.
const createImage = (top: number) => {
  const image = {
    top,
    currentSrc: `https://example.com/page-${images.length}.jpg`,
    complete: true,
    naturalWidth: 1000,
    naturalHeight: IMAGE_HEIGHT,
    parentElement: null,
    getBoundingClientRect: () => ({
      left: 0,
      right: 1000,
      top: image.top,
      bottom: image.top + IMAGE_HEIGHT,
      width: 1000,
      height: IMAGE_HEIGHT,
    }),
    setAttribute: () => {},
    removeAttribute: () => {},
  };
  images.push(image);
  return image;
};

const startContentScript = async () => {
  await import('./index');
  await vi.advanceTimersByTimeAsync(0);
};

const dispatchDocumentEvent = async (type: string) => {
  document.dispatchEvent(new Event(type));
  await vi.advanceTimersByTimeAsync(SCAN_WAIT_MS);
};

describe('content script translation requests', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    images = [];
    ports = [];
    vi.stubGlobal(
      'document',
      Object.assign(new EventTarget(), {
        images,
        visibilityState: 'visible',
        documentElement: createFakeElement(),
        createElement: createFakeElement,
        querySelectorAll: () => [],
      }),
    );
    vi.stubGlobal('window', Object.assign(new EventTarget(), { innerWidth: 1000, innerHeight: 800, devicePixelRatio: 1 }));
    vi.stubGlobal('HTMLImageElement', class {});
    vi.stubGlobal('HTMLCanvasElement', class {});
    vi.stubGlobal('MutationObserver', class { observe = () => {}; disconnect = () => {}; });
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 0));
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'extension-id',
        connect: () => {
          const port = {
            isDisconnected: false,
            onMessage: { addListener: () => {} },
            onDisconnect: { addListener: () => {} },
            postMessage: () => {},
            disconnect: () => {
              port.isDisconnected = true;
            },
          };
          ports.push(port);
          return port;
        },
      },
      storage: {
        sync: {
          get: async () => ({
            [STORAGE_KEY]: {
              matchMode: 'all',
              rules: [{ metric: 'width', operator: '>=', value: 800 }],
              translation: { isEnabled: true },
            },
          }),
        },
        onChanged: { addListener: () => {} },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('requests a translation for an image on screen', async () => {
    createImage(0);

    await startContentScript();

    expect(ports).toHaveLength(1);
  });

  it('does not request a translation for an image entirely off screen', async () => {
    createImage(2000);

    await startContentScript();

    expect(ports).toHaveLength(0);
  });

  it('cancels the request when the image is scrolled entirely off screen', async () => {
    const image = createImage(0);
    await startContentScript();
    expect(ports).toHaveLength(1);

    image.top = -IMAGE_HEIGHT - 100;
    await dispatchDocumentEvent('scroll');

    expect(ports[0].isDisconnected).toBe(true);
  });

  it('keeps the request while part of the image is still on screen', async () => {
    const image = createImage(0);
    await startContentScript();

    image.top = -IMAGE_HEIGHT + 100;
    await dispatchDocumentEvent('scroll');

    expect(ports).toHaveLength(1);
    expect(ports[0].isDisconnected).toBe(false);
  });

  it('requests a translation when the image is scrolled into view', async () => {
    const image = createImage(2000);
    await startContentScript();
    expect(ports).toHaveLength(0);

    image.top = 700;
    await dispatchDocumentEvent('scroll');

    expect(ports).toHaveLength(1);
  });

  it('requests a translation when a CSS transition moves the image into view', async () => {
    const image = createImage(2000);
    await startContentScript();
    expect(ports).toHaveLength(0);

    image.top = 0;
    await dispatchDocumentEvent('transitionend');

    expect(ports).toHaveLength(1);
  });
});
