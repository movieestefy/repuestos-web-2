import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

// Automatically route API requests to remote backend in production if VITE_API_URL is configured
// and inject Clerk Authorization bearer token across origins
const apiUrl = import.meta.env.VITE_API_URL;
const cleanApiUrl = apiUrl ? apiUrl.replace(/\/+$/, '') : '';
const originalFetch = window.fetch;

window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  let target = input;
  if (typeof input === 'string' && input.startsWith('/api') && cleanApiUrl) {
    target = `${cleanApiUrl}${input}`;
  }

  // Retrieve Clerk session token if available in the browser window
  let token: string | null = null;
  try {
    const clerk = (window as any).Clerk;
    if (clerk?.session) {
      token = await clerk.session.getToken();
    }
  } catch {
    // Ignore error if Clerk session is not initialized
  }

  const headers = new Headers(init?.headers);
  if (token && !headers.has('Authorization') && !headers.has('authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const options: RequestInit = {
    credentials: 'include',
    ...init,
    headers,
  };

  return originalFetch(target, options);
};

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
