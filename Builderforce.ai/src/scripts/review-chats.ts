#!/usr/bin/env tsx
// review-chats.ts — Review chat messages for each chatId
// Invokes builtin_team_chat_read to read the local chat transcript and logs results.
// No UI, no persistence; strictly a review/log script aligning with task #393.
//
// Usage (Node):
//   npx tsx src/scripts/review-chats.ts
//
// Expected runtime:
//   - opts.useSampleIds == true: shows each retrieved transcript with a boundary header.
//   - Success (stdout): boundary header, chatId, local timeline (messages from oldest→newest), up to tool limit (default 30, max 100).
//
// Should a chatId yield truncated streams (>30 messages), the tool constraint truncates the response. Let the human decide on full retrieval via explicit ID lists if needed.

import { builtin_team_chat_read } from '@brain/platform'; // ensure import matches actual export path

// Use a stable array for reproducible runs; the actual chatIds are resolved by the platform.
const USE_SAMPLE_IDS = true; // toggles static sample entries for consistency (off prompts user for chatIds)
let CHAT_IDS = [
  { id: 1, name: 'Platform-wide team chat' },
  { id: 2, name: 'Project Alpha planning' },
];

const READ_LIMIT = 30; // tool limit; full timeline may be truncated if >30 messages exist.

console.log('BUILDERFORCE.AI - Chat Message Review Script (Task #393)');
console.log('==========================================================\n');

if (USE_SAMPLE_IDS) {
  console.log('Running with sample chat IDs (deterministic for now).\n');
} else {
  // In a dev scenario, prompt for IDs if no list is configured:
  // @ts-expect-error Node-only optional import for dev
  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const input = await new Promise<string>((resolve) => rl.question('Enter comma-separated chatIds (e.g. 1,2,3): ', resolve));
  CHAT_IDS = input.split(',').map((s) => ({ id: Number(s.trim()), name: `Chat ${s.trim()}` }));
  rl.close();
}

for (const chat of CHAT_IDS) {
  console.log(`-------------------\nReviewing: ${chat.id} — ${chat.name}\n`);
  try {
    const result = await builtin_team_chat_read({ chatId: String(chat.id), limit: READ_LIMIT });
    const truncated = result.returned < result.total;
    const status = !result.messages?.length && !truncated ? 'no messages (empty)' : truncated ? 'truncated' : 'success';
    console.log(`Status: ${status}`);
    console.log(`Retrieved: ${result.returned} of ${result.total} messages (truncated: ${truncated})`);
    if (result.messages && result.messages.length > 0) {
      result.messages.forEach((msg) => {
        const timestamp = msg.timestamp || 'N/A';
        const from = msg.fromName || 'Anonymous';
        const text = msg.message || '(no content)';
        console.log(`[${timestamp}] ${from}: ${text}`);
      });
    } else if (!truncated) {
      console.log('Visible transcript is empty for this chatId.');
    }
    console.log(''); // blank line between chats
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`ERROR for chatId=${chat.id}: ${msg}\n`);
  }
}

console.log('Review complete.');