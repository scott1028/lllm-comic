import { getRefererRule } from '../utils/referer';

let lastRuleId = 0;

// Image hosts with hotlink protection reject requests without the page's Referer,
// and fetch() cannot set it, so add a header rule for the duration of the task.
export const runWithReferer = async <T>(
  url: string,
  pageUrl: string | undefined,
  task: () => Promise<T>,
): Promise<T> => {
  const rule = getRefererRule(++lastRuleId, url, pageUrl);
  if (!rule) return task();
  // Session rules outlive the service worker; drop one left by a killed worker with this ID.
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [rule.id], addRules: [rule] });
  try {
    return await task();
  } finally {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [rule.id] });
  }
};
