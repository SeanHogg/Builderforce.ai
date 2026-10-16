-- 1226 · Release note: the Brain runs its own code — in your browser.
--
-- `new`: the Brain on the canvas and in the Studio workspace could write an app's files
-- but could not run a single command against them, so every change it handed over was
-- unverified. It can now run real commands — npm install, tests, builds, type-checks —
-- in Builderforce's own in-browser runtime (BuilderForce WebContainers), against the
-- build's files, and the source files a command changes are saved back to the project.
-- It runs in the visitor's own browser, so it works on guest boards too. No native
-- addons; long-running servers stay the live preview's job. Alongside it, plain
-- (tool-free) Brain chat turns are answered on-device by Chrome's built-in model
-- (Gemini Nano, Prompt API) when it is already downloaded, falling back invisibly to the
-- cloud pool — never when a specific model was picked, never for tool turns. Rovr gets
-- the same on-device tier. Shipped in the web app 2026.10.52.
--
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0010-4000-8000-000000001226',
    '2026.10.52',
    'The Brain now runs its own code — install, test and build, right in your browser',
    'An agent that writes code but cannot run it hands you work nobody has checked. Until today that was the Brain on the canvas and in the Studio workspace: it wrote the files, and you found out whether they compiled. Now it runs them. Ask for a change and the Brain can install packages with npm, run your tests, build the app and type-check it — real commands, run inside your browser by Builderforce''s own in-browser runtime, against your build''s files. When a test fails, it reads the output, fixes the code and runs it again, so what you see has already passed. Files a command changes, such as a lockfile or generated source, are saved back to your project. Because it all runs in your own browser, it works before you sign up, on a guest board, with nothing to install and no server to wait for. Two limits worth knowing: packages that need native addons do not run in a browser, and the app itself keeps running in the live preview rather than as a command. Simple questions to the Brain also got faster and more private: when Chrome''s built-in model is already on your computer, plain chat turns are answered on your device, and anything it cannot handle goes to the cloud models without you noticing. It is never used when you have picked a model yourself, and Rovr, the Builderforce assistant for Chrome, uses it the same way.',
    'new',
    'live',
    '2026-10-16 23:00:00'
  )
ON CONFLICT (id) DO NOTHING;
