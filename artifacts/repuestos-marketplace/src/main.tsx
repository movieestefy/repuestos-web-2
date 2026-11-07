import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

// Automatically route API requests to remote backend in production if VITE_API_URL is configured
// and inject Clerk Authorization bearer token across origins without blocking
const apiUrl = import.meta.env.VITE_API_URL;
const cleanApiUrl = apiUrl ? apiUrl.replace(/\/+$/, '') : '';
const originalFetch = window.fetch;

let cachedClerkToken: string | null = null;
let tokenExpiresAt = 0;

async function getFastClerkToken(): Promise<string | null> {
  const now = Date.now();
  if (cachedClerkToken && now < tokenExpiresAt) {
    return cachedClerkToken;
  }

  try {
    const clerk = (window as any).Clerk;
    if (!clerk?.session) return null;

    // Strict 1000ms timeout so a slow token fetch never hangs the web app
    const tokenPromise = clerk.session.getToken();
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000));
    const token = (await Promise.race([tokenPromise, timeoutPromise])) as string | null;

    if (token) {
      cachedClerkToken = token;
      tokenExpiresAt = now + 40 * 1000; // Cache valid for 40 seconds
    }
    return token || cachedClerkToken;
  } catch {
    return cachedClerkToken;
  }
}

window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  let target = input;
  if (typeof input === 'string' && input.startsWith('/api') && cleanApiUrl) {
    target = `${cleanApiUrl}${input}`;
  }

  const token = await getFastClerkToken();

  const headers = new Headers(init?.headers);
  if (token && !headers.has('Authorization') && !headers.has('authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const options: RequestInit = {
    credentials: 'include',
    ...init,
    headers,
  };

  let response = await originalFetch(target, options);

  // SRE Session Stability: If 401 Unauthorized, refresh Clerk token with skipCache: true and silently retry once
  if (response.status === 401) {
    try {
      const clerk = (window as any).Clerk;
      if (clerk?.session) {
        const freshToken = await clerk.session.getToken({ skipCache: true });
        if (freshToken) {
          cachedClerkToken = freshToken;
          tokenExpiresAt = Date.now() + 40 * 1000;
          const retryHeaders = new Headers(headers);
          retryHeaders.set('Authorization', `Bearer ${freshToken}`);
          response = await originalFetch(target, {
            ...options,
            headers: retryHeaders,
          });
        }
      }
    } catch (refreshErr) {
      console.warn('[fetch] Token refresh attempt failed:', refreshErr);
    }
  }

  return response;
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
