import { createRoot } from 'react-dom/client';
// The design tokens the canvas is built against, straight from the web app — one
// palette, both themes, no editor-side copy to drift.
import '@/app/globals.css';
import '@seanhogg/builderforce-brain-ui/styles.css';
import './theme.css';
import { CanvasApp } from './CanvasScreen';

const el = document.getElementById('root');
if (el) createRoot(el).render(<CanvasApp />);
