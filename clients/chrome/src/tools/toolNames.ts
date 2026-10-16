/** Rovr's tool names — one table, read by the catalog, the safety gate and the panel. */
export const BROWSER_TOOL = {
  read: 'browser_read_page',
  find: 'browser_find_elements',
  click: 'browser_click',
  type: 'browser_type',
  scroll: 'browser_scroll',
  navigate: 'browser_navigate',
  wait: 'browser_wait',
  screenshot: 'browser_screenshot',
  listTabs: 'browser_list_tabs',
  switchTab: 'browser_switch_tab',
} as const;

export type BrowserToolName = (typeof BROWSER_TOOL)[keyof typeof BROWSER_TOOL];

/** The task tool — a task in this chat, synced to the platform with the chat. */
export const ADD_TASK_TOOL = 'rovr_add_task';

