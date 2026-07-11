import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@rodinna/ui/tokens.css';
import './styles.css';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { registerServiceWorker } from './shared/usePushSubscription';
import { initTheme } from './shared/theme';

// Service worker: Web Push (M0) + offline app shell (T8).
registerServiceWorker();
// Nočný režim: aplikuj uloženú voľbu + sleduj systémovú tému.
initTheme();

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
