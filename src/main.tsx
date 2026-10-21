import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import '@/i18n';
import { initTheme } from '@/ui/theme';
import { App } from '@/app/App';
import { bootstrap } from '@/features/settings/bootstrap';
import { registerServiceWorker } from '@/app/pwa';

// Pre-paint cache first (localStorage), then the settings table takes over (bootstrap).
initTheme();
bootstrap();
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
