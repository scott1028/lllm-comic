// chrome.tabs.TAB_ID_NONE: requests not from a tab, i.e. made by the extension itself.
const TAB_ID_NONE = -1;

// Origin only, like the browser default policy (strict-origin-when-cross-origin).
export const getRefererRule = (
  ruleId: number,
  url: string,
  pageUrl: string | undefined,
): chrome.declarativeNetRequest.Rule | undefined => {
  if (!pageUrl || !/^https?:/.test(url)) return undefined;
  return {
    id: ruleId,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'Referer', operation: 'set', value: `${new URL(pageUrl).origin}/` }],
    },
    condition: { urlFilter: `|${url}|`, tabIds: [TAB_ID_NONE] },
  };
};
