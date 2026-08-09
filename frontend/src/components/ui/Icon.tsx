import { isValidElement, type ReactNode, type SVGProps } from 'react';

export type IconName =
  | 'activity' | 'admin' | 'alert' | 'apps' | 'arrow-up-right' | 'automation'
  | 'attachment' | 'billing' | 'brain' | 'briefcase' | 'calendar' | 'camera' | 'canvas'
  | 'check' | 'chevron-down' | 'chevron-left' | 'chevron-right' | 'clock' | 'close' | 'code' | 'document' | 'edit' | 'external-link'
  | 'download' | 'flag' | 'folder' | 'growth' | 'heart' | 'home' | 'image' | 'info' | 'insights' | 'key' | 'knowledge'
  | 'link' | 'lock' | 'mail' | 'megaphone' | 'menu' | 'message' | 'mic' | 'mobile'
  | 'monitor' | 'pause' | 'people' | 'person' | 'play' | 'plus' | 'project' | 'quality' | 'search'
  | 'settings' | 'shield' | 'sparkles' | 'target' | 'template' | 'tools' | 'trash'
  | 'video' | 'volume' | 'warning' | 'workflow' | 'workspace';

/**
 * Legacy icon values are data, not presentation. Keeping the translation here
 * lets existing API/config contracts remain stable while every product surface
 * renders the same theme-aware SVG language. Unknown values intentionally fall
 * back to `apps`; they never fall back to an OS-dependent emoji glyph.
 */
const LEGACY_ICON: Record<string, IconName> = {
  '🏠': 'home', '⌂': 'home', '✦': 'sparkles', '✨': 'sparkles', '🚀': 'sparkles',
  '📁': 'folder', '🗂': 'folder', '🗂️': 'folder', '▦': 'project', '▥': 'project', '▤': 'document',
  '□': 'template', '◇': 'apps', '◆': 'apps', '▣': 'apps', '🧩': 'apps', '⌗': 'apps',
  '✓': 'check', '✅': 'check', '●': 'activity', '!': 'warning', '🚧': 'warning',
  'ℹ': 'info', '⚠': 'warning', '✕': 'close', '+': 'plus',
  '★': 'sparkles', '↑': 'arrow-up-right', '📥': 'document',
  '⚡': 'automation', '👀': 'search', '👁': 'search', '👁️': 'search', '📦': 'apps',
  '🔬': 'search', '🧬': 'brain', '🤖': 'brain', '🐍': 'code', '🎓': 'knowledge',
  '🏪': 'apps', '▶': 'play', '⭐': 'sparkles',
  '♥': 'heart', '❤️': 'heart', '🤍': 'heart', '♡': 'heart', '👍': 'check', '👎': 'close',
  '📎': 'attachment', '🎤': 'mic', '📷': 'camera', '🖥': 'monitor', '🗑': 'trash',
  '💡': 'info', '🚫': 'close', '⛔': 'close', '❌': 'close', '⏳': 'clock',
  '⏸️': 'pause', '⏹': 'close', '🔊': 'volume', '👋': 'people', '⚑': 'flag',
  '🚩': 'flag', '📡': 'activity', '🕑': 'clock', '🎉': 'sparkles', '🔄': 'workflow',
  '⬇️': 'download', '⬇': 'download',
  '☆': 'sparkles', '✔': 'check', '✖': 'close', '×': 'close',
  '◀': 'chevron-left', '◻': 'template', '☷': 'menu',
  '👤': 'person', '👥': 'people', '🧑‍🤝‍🧑': 'people', '🤝': 'people', '🧑‍🏭': 'people',
  '💼': 'briefcase', '🎭': 'person', '🕵️': 'person',
  '📈': 'insights', '📊': 'insights', '↗': 'arrow-up-right',
  '🎯': 'target', '🧭': 'target', '🗺': 'target', '🗺️': 'target',
  '📣': 'megaphone', '📢': 'megaphone',
  '🐞': 'quality', '🧪': 'quality', '🩺': 'activity', '🚨': 'alert', '🔔': 'alert',
  '📖': 'knowledge', '📚': 'knowledge', '🧠': 'brain', '🌱': 'brain',
  '⚙': 'settings', '⚙️': 'settings', '🛠': 'tools', '🛠️': 'tools', '🔧': 'tools',
  '🛡': 'shield', '🛡️': 'shield', '🔒': 'lock', '🔐': 'lock',
  '🔑': 'key', '🎟': 'key', '💳': 'billing', '％': 'billing', '🧮': 'billing',
  '📄': 'document', '📋': 'document', '📝': 'edit', '✎': 'edit', '✏️': 'edit',
  '✉️': 'mail', '📬': 'mail', '💬': 'message', '🌐': 'workspace', '🏢': 'workspace',
  '🔗': 'link', '🔌': 'link', '🔀': 'workflow', '🔁': 'workflow', '🕸️': 'workflow',
  '⏱': 'clock', '⏱️': 'clock', '📅': 'calendar', '🗓': 'calendar',
  '🎬': 'video', '📹': 'video', '🎙': 'video', '🎙️': 'video', '📱': 'mobile',
  '🖥️': 'monitor', '💻': 'monitor', '🖼': 'image', '🎨': 'image', '📌': 'apps',
  '🔎': 'search', '⌕': 'search', '＋': 'plus', '◧': 'apps', '◎': 'activity', '◌': 'activity',
  dashboard: 'home', seat: 'target', create: 'sparkles', challenges: 'target', projects: 'project',
  workforce: 'people', insights: 'insights', growth: 'growth', quality: 'quality', reliability: 'alert',
  knowledge: 'knowledge', settings: 'settings', admin: 'admin', sales: 'insights', 'sales-admin': 'admin',
  'freelancer-dashboard': 'home', 'freelancer-profile': 'person', 'freelancer-gigs': 'search',
  'freelancer-workspace': 'tools', 'freelancer-timecard': 'clock',
};

const PATHS: Record<IconName, ReactNode> = {
  attachment: <path d="m8.5 12.5 6-6a3 3 0 0 1 4.2 4.2l-8 8a5 5 0 0 1-7.1-7.1l8-8a2 2 0 0 1 2.8 2.8l-8 8"/>,
  activity: <><path d="M3 12h4l2-6 4 12 2-6h6"/></>,
  admin: <><path d="M12 3 4.5 6v5c0 4.7 3.2 8.2 7.5 10 4.3-1.8 7.5-5.3 7.5-10V6L12 3Z"/><path d="M9.5 12 11 13.5l3.5-3.5"/></>,
  alert: <><path d="M6 16.5h12l-1.6-2.1V10a4.4 4.4 0 0 0-8.8 0v4.4L6 16.5Z"/><path d="M10 19a2.2 2.2 0 0 0 4 0"/></>,
  apps: <><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></>,
  'arrow-up-right': <><path d="M7 17 17 7M9 7h8v8"/></>,
  automation: <><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 11 15.5 7M8.5 13l7 4"/></>,
  billing: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/></>,
  brain: <><path d="M12 5.5A4 4 0 0 0 5.5 9a4 4 0 0 0 2 7.5A4 4 0 0 0 12 19M12 5.5A4 4 0 0 1 18.5 9a4 4 0 0 1-2 7.5A4 4 0 0 1 12 19M12 5.5V19M8 9.5h4M12 14.5h4"/></>,
  briefcase: <><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V4h8v3M3 12h18M10 12v2h4v-2"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></>,
  camera: <><path d="M4 7h3l1.5-2h7L17 7h3v12H4V7Z"/><circle cx="12" cy="13" r="3.5"/></>,
  canvas: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 3v18M8 9h13"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  'chevron-down': <path d="m6 9 6 6 6-6"/>,
  'chevron-left': <path d="m15 6-6 6 6 6"/>,
  'chevron-right': <path d="m9 6 6 6-6 6"/>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  code: <><path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 5l-4 14"/></>,
  document: <><path d="M6 2h8l4 4v16H6V2Z"/><path d="M14 2v5h5M9 12h6M9 16h6"/></>,
  download: <><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 20h16"/></>,
  edit: <><path d="m14.5 5.5 4 4L8 20H4v-4L14.5 5.5ZM12.5 7.5l4 4"/></>,
  'external-link': <><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6H5V6h6"/></>,
  flag: <><path d="M5 21V4M5 5h12l-2 4 2 4H5"/></>,
  folder: <path d="M3 6h7l2 2h9v11H3V6Z"/>,
  growth: <><path d="M4 13.5v-3l14-5v13l-14-5Z"/><path d="M8 15v4h4v-2.5M18 10a3 3 0 0 1 0 4"/></>,
  heart: <path d="M20.8 5.8a5 5 0 0 0-7.1 0L12 7.5l-1.7-1.7a5 5 0 0 0-7.1 7.1L12 21l8.8-8.1a5 5 0 0 0 0-7.1Z"/>,
  home: <><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9h13v-9M9.5 19v-5h5v5"/></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m4 17 5-5 3 3 2-2 6 6"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
  insights: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
  key: <><circle cx="8" cy="12" r="4"/><path d="M12 12h9M17 12v3M20 12v2"/></>,
  knowledge: <><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v18H7.5A3.5 3.5 0 0 0 4 23V5.5ZM20 5.5A3.5 3.5 0 0 0 16.5 2H13v18h3.5A3.5 3.5 0 0 1 20 23V5.5Z"/></>,
  link: <><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></>,
  megaphone: <><path d="M4 13.5v-3l14-5v13l-14-5Z"/><path d="M8 15v4h4v-2.5M18 10a3 3 0 0 1 0 4"/></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
  message: <><path d="M4 5h16v12H9l-5 4V5Z"/></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/></>,
  mobile: <><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></>,
  monitor: <><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 22h8M12 18v4"/></>,
  pause: <><path d="M9 5v14M15 5v14"/></>,
  people: <><path d="M16 20v-1.8a3.7 3.7 0 0 0-3.7-3.7H7.7A3.7 3.7 0 0 0 4 18.2V20"/><circle cx="10" cy="8" r="3.2"/><path d="M16 5.2a3.2 3.2 0 0 1 0 6.2M20 20v-1.8a3.7 3.7 0 0 0-2.8-3.6"/></>,
  person: <><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></>,
  play: <path d="m8 5 11 7-11 7V5Z"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  project: <><rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M8 4v16M8 9h12M8 14h12"/></>,
  quality: <><rect x="6" y="6" width="12" height="13" rx="6"/><path d="M8 9h8M12 10v9M6 13H3M21 13h-3M9 4l1 2M15 4l-1 2"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3A1.7 1.7 0 0 0 14 21v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14h-.2v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9A1.7 1.7 0 0 0 21 10h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  shield: <><path d="M12 3 4.5 6v5c0 4.7 3.2 8.2 7.5 10 4.3-1.8 7.5-5.3 7.5-10V6L12 3Z"/><path d="M9.5 12 11 13.5l3.5-3.5"/></>,
  sparkles: <><path d="M12 3 9.8 9.8 3 12l6.8 2.2L12 21l2.2-6.8L21 12l-6.8-2.2L12 3Z"/></>,
  target: <><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="m15.2 8.8 4-4M16.8 4.8h2.4v2.4"/></>,
  template: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/></>,
  tools: <><path d="m14.5 6.5 3-3 3 3-3 3M13 8l-9.5 9.5V21H7l9.5-9.5"/></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/></>,
  video: <><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></>,
  volume: <><path d="M5 10v4h4l5 4V6L9 10H5Z"/><path d="M17 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/></>,
  warning: <><path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5M12 18h.01"/></>,
  workflow: <><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6H14a4 4 0 0 1 4 4v5.5M15 13l3 3 3-3M15.5 18H10a4 4 0 0 1-4-4V8.5"/></>,
  workspace: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 9v11"/></>,
};

export function iconName(source: string): IconName {
  return LEGACY_ICON[source] ?? (source in PATHS ? source as IconName : 'apps');
}

export function Icon({ name, source, size = 20, ...props }: {
  name?: IconName;
  source?: ReactNode;
  size?: number | string;
} & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  if (isValidElement(source)) return <span className="ui-icon ui-icon--custom" aria-hidden="true">{source}</span>;
  const resolved = name ?? iconName(typeof source === 'string' ? source : '');
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="ui-icon"
      {...props}
    >
      {PATHS[resolved]}
    </svg>
  );
}
