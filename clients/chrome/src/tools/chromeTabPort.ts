/**
 * The Chrome adapter behind {@link TabPort} — the only module the browser tools reach
 * `chrome.tabs` / `chrome.scripting` through.
 *
 * The page agent is injected ON DEMAND into the tab being worked on (and only if the
 * person allowed that site: injection needs the site's host permission, which is exactly
 * what the allow list grants). A second injection is a no-op — the agent guards itself.
 */
import { PAGE_CHANNEL, type PageEnvelope, type PageRequest, type PageResponse } from '../page/pageProtocol';
import type { TabInfo, TabPort } from './tabPort';

const CONTENT_SCRIPT = 'content.js';

const info = (tab: chrome.tabs.Tab): TabInfo => ({ id: tab.id ?? -1, url: tab.url ?? '', title: tab.title ?? '', active: !!tab.active });

function waitForComplete(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }
    function onUpdated(id: number, change: { status?: string }) {
      if (id === tabId && change.status === 'complete') done();
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

export function createChromeTabPort(): TabPort {
  const send = async (tabId: number, request: PageRequest): Promise<PageResponse> => {
    const envelope: PageEnvelope = { channel: PAGE_CHANNEL, request };
    try {
      return (await chrome.tabs.sendMessage(tabId, envelope)) as PageResponse;
    } catch {
      // No agent in the page yet (or the page navigated since) — inject, then ask once more.
      await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT] });
      const answer = (await chrome.tabs.sendMessage(tabId, envelope)) as PageResponse | undefined;
      return answer ?? { ok: false, error: 'The page did not answer.' };
    }
  };

  return {
    async listTabs() {
      return (await chrome.tabs.query({ currentWindow: true })).filter((t) => t.id !== undefined).map(info);
    },
    async getTab(tabId) {
      try {
        return info(await chrome.tabs.get(tabId));
      } catch {
        return null;
      }
    },
    async activate(tabId) {
      await chrome.tabs.update(tabId, { active: true });
    },
    async navigate(tabId, url, timeoutMs) {
      const tab = tabId === null ? await chrome.tabs.create({ url, active: true }) : await chrome.tabs.update(tabId, { url, active: true });
      if (!tab?.id) throw new Error('The tab could not be opened.');
      await waitForComplete(tab.id, timeoutMs);
      return info(await chrome.tabs.get(tab.id));
    },
    async send(tabId, request) {
      try {
        return await send(tabId, request);
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    async screenshot(tabId) {
      const tab = await chrome.tabs.get(tabId);
      return chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    },
  };
}
