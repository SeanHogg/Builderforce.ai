-- 1366 · Release note: the agents in your app now appear in the Room, and you can watch, steer
-- and cancel them there.
--
-- `new`: W12 phase 5. Each declared agent is a Room item (`agentStation.tsx`). Its state (idle,
-- thinking, executing, waiting, failed, recovering) is derived from the agent's run events, not
-- animated for show. Its SlideOutPanel shows status, the declaration (role, workload,
-- instructions, memory), tools and run history, with steer and cancel; "Ask Brain about this
-- agent" routes into the one composer. After a recovery the Room rebuilds from restored state.
-- `roomAgents.*` is in all five catalogs. Blog: /blog/your-agents-join-the-room.
--
-- Marketing copy, framed on what a person can now DO (see the header of 1105). Fixed id so the
-- migration is safe to replay; `emailed_at` left NULL so the product-updates digest announces it
-- exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0025-4000-8000-000000001366',
    '2026.11.24',
    'Your agents join the Room',
    'Agents that work inside your app used to be invisible while they ran: you saw what they had changed only after they finished. Now each agent you declare appears in the Room beside the rest of your project. Its avatar shows what it is really doing, idle, thinking, executing, waiting, failed or recovering, because the state comes from the agent''s own run events, not from an animation. Open an agent to see its role, its instructions, the tools it may use and the history of its run, step by step. If it is heading the wrong way, type a direction and steer it, or cancel the run. Ask Brain about this agent opens the chat you already use, with the agent''s name and role filled in. If the tab closes mid-run, the Room rebuilds from the recovered state when you come back, so you see where each agent stopped. The panel works in light and dark mode, on a phone-sized screen, and in all five languages.',
    'new',
    'live',
    '2026-11-24 12:00:00'
  )
ON CONFLICT (id) DO NOTHING;
