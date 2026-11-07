import { ReactNode } from 'react';
import { useLocation } from 'wouter';
import { useAuth, useUser } from '@clerk/react';
import { getGetCurrentUserQueryKey, useGetCurrentUser } from '@workspace/api-client-react';
import { ShieldAlert, LogIn, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageLoader } from '@/components/shared/page-loader';

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: Array<'admin' | 'merchant' | 'customer'>;
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const [location, setLocation] = useLocation();
  const { isLoaded: isClerkLoaded, isSignedIn } = useAuth();
  const { user: clerkUser } = useUser();
  const { data: user, isLoading: isUserLoading } = useGetCurrentUser({
    query: { queryKey: getGetCurrentUserQueryKey(), retry: 1 },
  });

  // 1. Wait while Clerk or backend auth state is initializing
  if (!isClerkLoaded || (isSignedIn && isUserLoading && !user)) {
    return <PageLoader />;
  }

  // 2. Resolve effective user: backend DB user takes precedence; fallback to active Clerk session
  const effectiveUser =
    user ||
    (isSignedIn && clerkUser
      ? {
          id: clerkUser.id,
          name: clerkUser.fullName || clerkUser.firstName || 'Usuario',
          email: clerkUser.primaryEmailAddress?.emailAddress || '',
          role: ((clerkUser.publicMetadata?.role as string) || 'customer') as 'admin' | 'merchant' | 'customer',
          isMaster:
            clerkUser.primaryEmailAddress?.emailAddress?.toLowerCase() ===
            'alexaelperdomo2410@gmail.com',
        }
      : null);

  // 3. Not logged in: Block access and offer immediate sign-in
  if (!effectiveUser) {
    return (
      <div className="mx-auto max-w-[600px] px-4 py-20 text-center sm:px-6" data-testid="protected-route-unauthorized">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-destructive/10 text-destructive">
          <ShieldAlert className="h-8 w-8" />
        </div>
        <h1 className="mt-6 font-display text-3xl font-bold tracking-tight">Acceso restringido</h1>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
          Esta sección requiere iniciar sesión con tu cuenta para acceder a tus pedidos o configuración.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button
            type="button"
            onClick={() => setLocation(`/sign-in?redirect_url=${encodeURIComponent(location)}`)}
            className="gap-2"
            data-testid="button-redirect-signin"
          >
            <LogIn className="h-4 w-4" />
            Iniciar sesión
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setLocation('/')}
            className="gap-2"
            data-testid="button-back-home"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver al catálogo
          </Button>
        </div>
      </div>
    );
  }

  // 4. Check role restrictions
  if (allowedRoles && allowedRoles.length > 0) {
    const isAllowed = allowedRoles.includes(effectiveUser.role as any) || Boolean(effectiveUser.isMaster);
    if (!isAllowed) {
      return (
        <div className="mx-auto max-w-[600px] px-4 py-20 text-center sm:px-6" data-testid="protected-route-forbidden">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-amber-500/10 text-amber-600">
            <ShieldAlert className="h-8 w-8" />
          </div>
          <h1 className="mt-6 font-display text-3xl font-bold tracking-tight">Permisos insuficientes</h1>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
            Tu cuenta tiene el rol <strong className="capitalize">{effectiveUser.role}</strong>. Esta sección está reservada para comerciantes registrados o administradores del sistema.
          </p>
          <div className="mt-8 flex justify-center">
            <Button
              type="button"
              variant="outline"
              onClick={() => setLocation('/')}
              className="gap-2"
              data-testid="button-forbidden-home"
            >
              <ArrowLeft className="h-4 w-4" />
              Volver al inicio
            </Button>
          </div>
        </div>
      );
    }
  }

  return <>{children}</>;
}
