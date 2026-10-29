import { createRoot } from 'react-dom/client';
// The design tokens the canvas is built against, straight from the web app — one
// palette, both themes, no editor-side copy to drift. It carries the `@tailwind`
// directives for the whole bundle, so nothing below repeats them.
import '@/app/globals.css';
// The knowledge graph view's `--kg-*` palette; `index.css` below re-points its hues at the editor's theme.
import '@builderforce/knowledge-graph-view/tokens.css';
import '@seanhogg/builderforce-brain-ui/styles.css';
// The chat surface's own chrome, and the `--bf-*` mapping that makes the shared
// timeline inherit the editor's colour theme.
import './index.css';
// The Knowledge view's hues, mapped onto the editor's theme colours (after the package's own tokens above).
import './knowledgeGraph/hostTokens.css';
// Editor fit, last: no application shell around the board, and the panel is the
// viewport. It has the final word on `body` and `#root`.
import './canvas/theme.css';
import { WorkspaceApp } from './WorkspaceApp';
import { installPageEngineHost } from './pageEngines';
import { installWebviewPlatformPolicy } from './platformPolicy';

installWebviewPlatformPolicy();
installPageEngineHost();

const el = document.getElementById('root');
if (el) createRoot(el).render(<WorkspaceApp />);
