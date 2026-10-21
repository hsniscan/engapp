import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import '@/i18n';
import { initTheme } from '@/ui/theme';
import { App } from '@/app/App';

initTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
