import { createRoot } from 'react-dom/client';
// The design tokens the canvas is built against, straight from the web app — one
// palette, both themes, no editor-side copy to drift. It carries the `@tailwind`
// directives for the whole bundle, so nothing below repeats them.
import '@/app/globals.css';
import '@seanhogg/builderforce-brain-ui/styles.css';
// The chat surface's own chrome, and the `--bf-*` mapping that makes the shared
// timeline inherit the editor's colour theme.
import './index.css';
// Editor fit, last: no application shell around the board, and the panel is the
// viewport. It has the final word on `body` and `#root`.
import './canvas/theme.css';
import { WorkspaceApp } from './WorkspaceApp';

const el = document.getElementById('root');
if (el) createRoot(el).render(<WorkspaceApp />);
