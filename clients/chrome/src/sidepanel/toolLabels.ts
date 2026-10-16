/** The person-facing name of each Rovr tool (the confirm card and the Actions view). */
import type { MessageKey } from '../i18n/t';
import { ADD_TASK_TOOL, BROWSER_TOOL } from '../tools/toolNames';

export const TOOL_LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
  [BROWSER_TOOL.read]: 'toolRead',
  [BROWSER_TOOL.find]: 'toolFind',
  [BROWSER_TOOL.click]: 'toolClick',
  [BROWSER_TOOL.type]: 'toolType',
  [BROWSER_TOOL.scroll]: 'toolScroll',
  [BROWSER_TOOL.navigate]: 'toolNavigate',
  [BROWSER_TOOL.wait]: 'toolWait',
  [BROWSER_TOOL.screenshot]: 'toolScreenshot',
  [BROWSER_TOOL.listTabs]: 'toolListTabs',
  [BROWSER_TOOL.switchTab]: 'toolSwitchTab',
  [ADD_TASK_TOOL]: 'toolAddTask',
};

export function toolLabelKey(name: string): MessageKey {
  return TOOL_LABEL_KEYS[name] ?? 'toolOther';
}
