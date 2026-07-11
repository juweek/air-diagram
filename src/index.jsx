import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { reportHeightToParent } from './lib/embedHeight';
import './index.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If this page is inside an iframe, keep the parent informed of our height so
// the frame can auto-resize (see docs/EMBEDDING.md for the parent snippet).
// Harmless no-op when running standalone.
reportHeightToParent();
