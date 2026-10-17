-- 1233 · brain_chat_messages.seq is stamped from id inside the INSERT.
--
-- seq is the per-chat append order and has always been "the generated PK" (a
-- read-then-write MAX(seq)+1 races when agents and humans append concurrently). Every
-- writer did that as INSERT ... RETURNING id followed by UPDATE ... SET seq = id: two
-- statements, i.e. two Neon HTTPS round trips, per message. A BEFORE INSERT trigger
-- sees NEW.id already filled from its serial default, so seq is set in the same
-- statement and RETURNING hands callers the final value.
--
-- The column stays NOT NULL DEFAULT 0, so an omitted seq arrives here as 0 (not NULL):
-- 0 and NULL both mean "unset". A writer that passes an explicit positive seq keeps it.
--
-- Rows written before this migration already hold seq = id, so readers ordering by seq,
-- the unread count (seq > last_read_seq) and the afterSeq cursor see no change. The
-- backfill below only repairs any row left at 0 by an INSERT whose follow-up UPDATE
-- never ran, so it is ordered like its neighbours instead of sorting first.
-- idx_brain_chat_messages_chat_seq (1231) is unaffected: the value it indexes is the same.
CREATE OR REPLACE FUNCTION set_brain_chat_message_seq() RETURNS trigger AS $$
BEGIN
  IF NEW.seq IS NULL OR NEW.seq <= 0 THEN
    NEW.seq := NEW.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_brain_chat_messages_seq ON brain_chat_messages;
CREATE TRIGGER trg_brain_chat_messages_seq
  BEFORE INSERT ON brain_chat_messages
  FOR EACH ROW EXECUTE FUNCTION set_brain_chat_message_seq();

UPDATE brain_chat_messages SET seq = id WHERE seq <= 0;
