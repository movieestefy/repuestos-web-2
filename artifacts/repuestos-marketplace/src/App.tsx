/**
 * @file App.tsx
 * Application root — providers, lazy-loaded routes, and Clerk integration.
 *
 * All page components, layout, shared utilities, and cart context have been
 * extracted to their own modules under src/pages/, src/components/, and src/lib/.
 * This file is intentionally small: providers + router only.
 */

import { lazy, Suspense, useEffect, useRef } from 'react';
import { ClerkProvider, useAuth, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import { getGetCurrentUserQueryKey, setAuthTokenGetter } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { AppFrame } from '@/components/layout/app-frame';
import { CartProvider } from '@/lib/cart-context';
import { PageLoader } from '@/components/shared/page-loader';
import { ProtectedRoute } from '@/components/shared/protected-route';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

/* -------------------------------------------------------------------------- */
/*  Lazy-loaded page components (code-split per route)                        */
/* -------------------------------------------------------------------------- */

const HomePage = lazy(() => import('@/pages/home-page'));
const ProductPage = lazy(() => import('@/pages/product-page'));
const CartPage = lazy(() => import('@/pages/cart-page'));
const CheckoutPage = lazy(() => import('@/pages/checkout-page'));
const OrdersPage = lazy(() => import('@/pages/orders-page'));
const OrderDetailPage = lazy(() => import('@/pages/order-detail-page'));
const DashboardPage = lazy(() => import('@/pages/dashboard-page'));
const InventoryPage = lazy(() => import('@/pages/inventory-page'));
const PaymentsPage = lazy(() => import('@/pages/payments-page'));
const SettingsPage = lazy(() => import('@/pages/settings-page'));
const SignInPage = lazy(() => import('@/pages/sign-in-page'));
const SignUpPage = lazy(() => import('@/pages/sign-up-page'));
const NotFound = lazy(() => import('@/pages/not-found'));

/* -------------------------------------------------------------------------- */
/*  Global singletons                                                         */
/* -------------------------------------------------------------------------- */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30 * 1000, // 30s cache prevents endless refetches and UI freezes
      gcTime: 5 * 60 * 1000,
    },
  },
});

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

const DEFAULT_CLERK_KEY = 'pk_test_ZmFzdC1sYWItODQzNS5jbGVyay5hY2NvdW50cy5kZXYk';
const clerkPubKey =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ||
  publishableKeyFromHost(window.location.hostname, DEFAULT_CLERK_KEY) ||
  DEFAULT_CLERK_KEY;

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

/* -------------------------------------------------------------------------- */
/*  Suspense fallback wrapper                                                 */
/* -------------------------------------------------------------------------- */

function SuspenseFrame({ children }: { children: React.ReactNode }) {
  return (
    <AppFrame>
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </AppFrame>
  );
}

/* -------------------------------------------------------------------------- */
/*  Route tree                                                                */
/* -------------------------------------------------------------------------- */

function RoutedApp() {
  return (
    <Switch>
      {/* Auth pages render without AppFrame */}
      <Route path="/sign-in/*?">
        <Suspense fallback={<PageLoader />}><SignInPage /></Suspense>
      </Route>
      <Route path="/sign-up/*?">
        <Suspense fallback={<PageLoader />}><SignUpPage /></Suspense>
      </Route>

      {/* Customer-facing pages */}
      <Route path="/">
        <SuspenseFrame><HomePage /></SuspenseFrame>
      </Route>
      <Route path="/product/:id">
        <SuspenseFrame><ProductPage /></SuspenseFrame>
      </Route>
      <Route path="/cart">
        <SuspenseFrame><CartPage /></SuspenseFrame>
      </Route>
      <Route path="/checkout">
        <SuspenseFrame><CheckoutPage /></SuspenseFrame>
      </Route>
      <Route path="/orders">
        <SuspenseFrame>
          <ProtectedRoute>
            <OrdersPage />
          </ProtectedRoute>
        </SuspenseFrame>
      </Route>
      <Route path="/orders/:id">
        <SuspenseFrame>
          <ProtectedRoute>
            <OrderDetailPage />
          </ProtectedRoute>
        </SuspenseFrame>
      </Route>

      {/* Admin/operational pages */}
      <Route path="/dashboard">
        <SuspenseFrame>
          <ProtectedRoute allowedRoles={['admin', 'merchant']}>
            <DashboardPage />
          </ProtectedRoute>
        </SuspenseFrame>
      </Route>
      <Route path="/inventory">
        <SuspenseFrame>
          <ProtectedRoute allowedRoles={['admin', 'merchant']}>
            <InventoryPage />
          </ProtectedRoute>
        </SuspenseFrame>
      </Route>
      <Route path="/payments">
        <SuspenseFrame>
          <ProtectedRoute allowedRoles={['admin', 'merchant']}>
            <PaymentsPage />
          </ProtectedRoute>
        </SuspenseFrame>
      </Route>
      <Route path="/settings">
        <SuspenseFrame>
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        </SuspenseFrame>
      </Route>

      {/* Fallback */}
      <Route>
        <SuspenseFrame><NotFound /></SuspenseFrame>
      </Route>
    </Switch>
  );
}

/* -------------------------------------------------------------------------- */
/*  Clerk cache invalidator — clears React Query cache on user change         */
/* -------------------------------------------------------------------------- */

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const previous = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (previous.current !== undefined && previous.current !== userId) {
        client.clear();
      }
      previous.current = userId;
    });
    return unsubscribe;
  }, [addListener, client]);

  return null;
}

function ClerkAuthSync() {
  const { getToken, isSignedIn } = useAuth();
  const client = useQueryClient();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const lastSignedInRef = useRef<boolean | null | undefined>(null);

  useEffect(() => {
    if (lastSignedInRef.current === isSignedIn) return;
    lastSignedInRef.current = isSignedIn;

    if (isSignedIn) {
      setAuthTokenGetter(async () => {
        try {
          return await getTokenRef.current();
        } catch {
          return null;
        }
      });
      // Invalidate once on sign-in transition
      client.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
    } else {
      setAuthTokenGetter(null);
      client.setQueryData(getGetCurrentUserQueryKey(), null);
    }
  }, [isSignedIn, client]);

  return null;
}

/* -------------------------------------------------------------------------- */
/*  Clerk provider with appearance theming                                    */
/* -------------------------------------------------------------------------- */

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  if (!clerkPubKey) return <RoutedApp />;

  const appearance = {
    theme: shadcn,
    cssLayerName: 'clerk',
    options: {
      logoPlacement: 'inside' as const,
      logoLinkUrl: basePath || '/',
      logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
    },
    variables: {
      colorPrimary: '#256b55',
      colorForeground: '#17333a',
      colorMutedForeground: '#65736e',
      colorDanger: '#a94535',
      colorBackground: '#fbfaf4',
      colorInput: '#f4f3eb',
      colorInputForeground: '#17333a',
      colorNeutral: '#d9ded2',
      fontFamily: 'DM Sans',
      borderRadius: '0.75rem',
    },
    elements: {
      rootBox: 'w-full flex justify-center',
      cardBox: 'bg-[#fbfaf4] rounded-2xl w-[440px] max-w-full overflow-hidden',
      card: '!shadow-none !border-0 !bg-transparent !rounded-none',
      footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
      headerTitle: 'text-[#17333a] font-display',
      headerSubtitle: 'text-[#65736e]',
      socialButtonsBlockButtonText: 'text-[#17333a]',
      formFieldLabel: 'text-[#17333a]',
      footerActionLink: 'text-[#256b55]',
      footerActionText: 'text-[#65736e]',
      dividerText: 'text-[#65736e]',
      identityPreviewEditButton: 'text-[#256b55]',
      formFieldSuccessText: 'text-[#256b55]',
      alertText: 'text-[#a94535]',
      logoBox: 'p-4',
      logoImage: 'max-h-10',
      socialButtonsBlockButton: 'border-[#d9ded2] bg-[#f4f3eb]',
      formButtonPrimary: 'bg-[#17333a] hover:bg-[#256b55]',
      formFieldInput: 'border-[#d9ded2] bg-[#f4f3eb] text-[#17333a]',
      footerAction: 'border-t border-[#d9ded2]',
      dividerLine: 'bg-[#d9ded2]',
      alert: 'bg-[#fae9e5] border-[#e8bdb3]',
      otpCodeFieldInput: 'border-[#d9ded2] bg-[#f4f3eb]',
      formFieldRow: 'gap-2',
      main: 'gap-5',
    },
  };

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={appearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: 'Bienvenido de nuevo', subtitle: 'Entra para continuar tu compra' } },
        signUp: { start: { title: 'Crea tu cuenta', subtitle: 'Compra con más control y seguimiento' } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <ClerkQueryClientCacheInvalidator />
      <ClerkAuthSync />
      <RoutedApp />
    </ClerkProvider>
  );
}

/* -------------------------------------------------------------------------- */
/*  Root App component                                                        */
/* -------------------------------------------------------------------------- */

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <CartProvider>
          <WouterRouter base={basePath}>
            <ErrorBoundary>
              <ClerkProviderWithRoutes />
            </ErrorBoundary>
          </WouterRouter>
        </CartProvider>
      </TooltipProvider>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;