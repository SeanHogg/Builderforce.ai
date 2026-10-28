-- 1280 · Release note: point it at a folder and see what it knows — the knowledge graph.
--
-- `new`: before this, nothing showed the SHAPE of a folder. The Visualization panel drew only
-- the files one run changed, and a folder of specs, contracts or notes was reviewed by reading
-- every file, while an agent asked about it re-read it every time. Now any host (VS Code, Rovr,
-- the web canvas) reviews a folder of code or docs into a 3D knowledge graph held in memory:
-- layers and where they break, duplicated code and near-duplicate sections, contradicting
-- claims, broken links, a layer sequence trace, Fix with agent on every finding, and questions
-- answered from memory, often with no model call (deterministic prefetch: /review, /graph,
-- /dup, "where is X handled"). PRD 38. Blog: /blog/point-it-at-a-folder-and-see-what-it-knows.
--
-- Marketing copy, framed on what a person can now DO (see the header of 1105). Fixed id so the
-- migration is safe to replay, `emailed_at` left NULL so the product-updates digest announces it
-- exactly once.
INSERT INTO release_notes (
  id,
  version,
  title,
  body,
  category,
  stage,
  published_at
) VALUES
  (
    'a1b2c301-0009-4000-8000-000000001280',
    '2026.10.110',
    'Point it at a folder and see what it knows',
    'Agents now write more files than anyone reads, so you need to see the shape of what is there. Point BuilderForce at any folder, code or docs, from VS Code, Rovr or the web canvas, and it builds a 3D knowledge graph of it that stays in memory. You see the layers and where they are broken, duplicated code and near-duplicate sections, claims in one document that contradict another, and broken links. Pick any file to trace how it reaches the rest, layer by layer. Every finding has Fix with agent, which hands a ready-made request to the composer. Before the review starts you see how many files it will read and roughly what the judgement pass will cost, and a second review only re-reads what changed. Questions about the folder are answered from memory, often with no model call at all: type /review, /graph or /dup, or ask where something is handled.',
    'new',
    'live',
    '2026-10-28 18:00:00'
  )
ON CONFLICT (id) DO NOTHING;
