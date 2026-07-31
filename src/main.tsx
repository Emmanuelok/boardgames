import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { hydrateAccessibilityPreferences } from './accessibility/preferences';
import { registerPwa } from './pwa/register';
import './styles/global.css';

hydrateAccessibilityPreferences();
void registerPwa();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
