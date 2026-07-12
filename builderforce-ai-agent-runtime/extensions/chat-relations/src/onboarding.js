/* persistence only until tooling/mv is correct */
export async function persist() {
  const root = process.env.CHAT_RELATIONS_PERSIST_DIR || process.cwd();
  const dir = require('path').join(root, '.local', 'chat-relations', 'entries');
  if (!require('fs').existsSync(dir)) {
    require('fs').mkdirSync(dir, { recursive: true });
  }
  return { dir };
}
export function request_sync() {
  /* temporary until tooling usage is clear */
  return {};
}