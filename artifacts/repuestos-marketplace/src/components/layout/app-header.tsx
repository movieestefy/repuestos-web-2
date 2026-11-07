/**
 * @file app-header.tsx
 * Top navigation bar containing logo, main nav links, cart indicator, user profile shortcut, and mobile menu.
 */

import { useState, useRef, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { useClerk, useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Boxes,
  ChevronDown,
  ClipboardList,
  Gauge,
  LogIn,
  LogOut,
  Menu,
  Settings,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Store,
  UserCheck,
  UserCircle,
  UserPlus,
  X,
} from 'lucide-react';
import {
  getGetCurrentUserQueryKey,
  useGetCurrentUser,
  getGetTodayRateQueryKey,
  useGetTodayRate,
} from '@workspace/api-client-react';
import { useCart } from '@/lib/cart-context';
import { Logo } from '@/components/layout/logo';
import { Button } from '@/components/ui/button';

export function AppHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const { totalItems } = useCart();
  const [location, setLocation] = useLocation();
  const { signOut, openUserProfile } = useClerk();
  const { user: clerkUser, isSignedIn } = useUser();
  const queryClient = useQueryClient();

  const { data: user } = useGetCurrentUser({
    query: { queryKey: getGetCurrentUserQueryKey(), retry: false },
  });
  const { data: todayRate } = useGetTodayRate({
    query: { queryKey: getGetTodayRateQueryKey(), staleTime: 10 * 60 * 1000 },
  });

  const isAuthenticated = Boolean(user || isSignedIn);

  // Close account dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    }
    if (accountOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [accountOpen]);

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (err) {
      console.error('Error signing out:', err);
    }
    queryClient.clear();
    setAccountOpen(false);
    setMobileOpen(false);
    setLocation('/');
  };

  const links = [
    { href: '/', label: 'Catálogo', icon: Store },
    { href: '/orders', label: 'Mis pedidos', icon: ClipboardList },
    ...(user?.role === 'admin' || user?.role === 'merchant'
      ? [{ href: '/dashboard', label: 'Operaciones', icon: Gauge }]
      : []),
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-sidebar-border bg-sidebar text-sidebar-foreground shadow-sm">
      {/* TopBar: Daily Rate & Coverage Status */}
      <div className="border-b border-sidebar-border/60 bg-black/15 py-1.5 text-xs text-sidebar-foreground/80">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-10">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-mono text-[11px] sm:text-xs">
              Tasa del día: <strong className="text-secondary">{todayRate?.value ? `Bs. ${Number(todayRate.value).toFixed(2)}` : 'Actualizando...'}</strong> / $1 USD
            </span>
          </div>
          <div className="hidden items-center gap-3 font-mono text-[11px] text-sidebar-foreground/70 sm:flex">
            <span>Entregas en Barinas</span>
            <span className="text-sidebar-border">•</span>
            <span className="text-secondary/90">Pago Móvil Seguro</span>
          </div>
        </div>
      </div>

      <div className="mx-auto flex h-[4.2rem] max-w-[1440px] items-center gap-6 px-4 sm:px-6 lg:px-10">
        <Logo />
        <div className="hidden h-7 w-px bg-sidebar-border md:block" />
        <nav className="hidden items-center gap-1 md:flex" aria-label="Navegación principal">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                location === href
                  ? 'bg-sidebar-accent font-semibold text-secondary'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
              }`}
              data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/cart"
            className="relative grid h-10 w-10 place-items-center rounded-lg text-sidebar-foreground/80 transition hover:bg-sidebar-accent hover:text-secondary"
            aria-label="Ver carrito"
            data-testid="link-cart"
          >
            <ShoppingCart className="h-5 w-5" />
            {totalItems > 0 && (
              <span
                className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-secondary px-1 font-mono text-[10px] font-bold text-primary"
                data-testid="text-cart-count"
              >
                {totalItems}
              </span>
            )}
          </Link>

          {/* Account Menu Dropdown */}
          <div className="relative hidden sm:block" ref={accountRef}>
            <button
              type="button"
              onClick={() => setAccountOpen((prev) => !prev)}
              className="flex items-center gap-2 rounded-lg border border-sidebar-border px-3 py-2 text-sm text-sidebar-foreground/80 transition hover:border-secondary hover:text-secondary"
              data-testid="link-account"
            >
              <UserCircle className="h-4 w-4 text-secondary" />
              <span className="max-w-[120px] truncate">
                {isAuthenticated
                  ? user?.name?.split(' ')[0] ?? clerkUser?.firstName ?? 'Mi cuenta'
                  : 'Mi cuenta'}
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform duration-200 ${
                  accountOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {accountOpen && (
              <div className="absolute right-0 top-full mt-2 w-72 rounded-2xl border border-border bg-card p-3 text-card-foreground shadow-2xl z-50">
                {isAuthenticated ? (
                  <>
                    {/* User Identity Header */}
                    <div className="rounded-xl bg-muted/60 p-3">
                      <div className="flex items-center gap-3">
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary/20 text-secondary font-bold font-mono text-sm">
                          {(user?.name || clerkUser?.fullName || 'U').charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-foreground">
                            {user?.name ?? clerkUser?.fullName ?? 'Usuario'}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {user?.email ?? clerkUser?.primaryEmailAddress?.emailAddress ?? ''}
                          </p>
                        </div>
                      </div>
                      <div className="mt-2.5 flex items-center gap-1.5">
                        <ShieldCheck className="h-3.5 w-3.5 text-accent" />
                        <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-mono font-medium text-accent uppercase tracking-wider">
                          {user?.isMaster
                            ? 'Admin Master'
                            : user?.role === 'merchant'
                            ? 'Comerciante'
                            : 'Cliente'}
                        </span>
                      </div>
                    </div>

                    <div className="my-2 h-px bg-border" />

                    {/* Actions List */}
                    <div className="space-y-1">
                      <button
                        type="button"
                        onClick={() => {
                          setAccountOpen(false);
                          setLocation('/settings');
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-foreground hover:bg-muted transition text-left"
                        data-testid="button-account-settings"
                      >
                        <Settings className="h-4 w-4 text-muted-foreground" />
                        <span>Ajustes del usuario</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setAccountOpen(false);
                          openUserProfile?.();
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-foreground hover:bg-muted transition text-left"
                        data-testid="button-account-clerk-profile"
                      >
                        <UserCheck className="h-4 w-4 text-muted-foreground" />
                        <span>Gestionar perfil y seguridad</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setAccountOpen(false);
                          setLocation('/orders');
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-foreground hover:bg-muted transition text-left"
                        data-testid="button-account-orders"
                      >
                        <ClipboardList className="h-4 w-4 text-muted-foreground" />
                        <span>Mis pedidos</span>
                      </button>

                      {(user?.role === 'admin' || user?.role === 'merchant') && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setAccountOpen(false);
                              setLocation('/inventory');
                            }}
                            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-foreground hover:bg-muted transition text-left"
                          >
                            <Boxes className="h-4 w-4 text-muted-foreground" />
                            <span>Inventario</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAccountOpen(false);
                              setLocation('/dashboard');
                            }}
                            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-foreground hover:bg-muted transition text-left"
                          >
                            <Gauge className="h-4 w-4 text-muted-foreground" />
                            <span>Panel de control</span>
                          </button>
                        </>
                      )}
                    </div>

                    <div className="my-2 h-px bg-border" />

                    {/* Sign Out Button */}
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 transition text-left"
                      data-testid="button-account-logout"
                    >
                      <LogOut className="h-4 w-4" />
                      <span>Cerrar sesión</span>
                    </button>
                  </>
                ) : (
                  <>
                    <div className="p-2 text-center">
                      <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-secondary/15 text-secondary">
                        <UserCircle className="h-6 w-6" />
                      </div>
                      <p className="mt-2 text-sm font-bold text-foreground">Mi cuenta</p>
                      <p className="text-xs text-muted-foreground">
                        Accede para ver tus pedidos y datos.
                      </p>
                    </div>

                    <div className="mt-2 space-y-2">
                      <Button
                        type="button"
                        onClick={() => {
                          setAccountOpen(false);
                          setLocation('/sign-in');
                        }}
                        className="w-full justify-center gap-2 text-xs h-9"
                        data-testid="button-account-login"
                      >
                        <LogIn className="h-3.5 w-3.5" />
                        <span>Iniciar sesión</span>
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setAccountOpen(false);
                          setLocation('/sign-up');
                        }}
                        className="w-full justify-center gap-2 text-xs h-9"
                        data-testid="button-account-register"
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        <span>Crear cuenta</span>
                      </Button>
                    </div>

                    <div className="my-2 h-px bg-border" />

                    <button
                      type="button"
                      onClick={() => {
                        setAccountOpen(false);
                        setLocation('/settings');
                      }}
                      className="flex w-full items-center justify-center gap-1.5 py-1 text-xs text-muted-foreground hover:text-foreground transition"
                    >
                      <Settings className="h-3.5 w-3.5" />
                      <span>Ajustes del sistema</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            className="grid h-10 w-10 place-items-center rounded-lg text-sidebar-foreground md:hidden"
            onClick={() => setMobileOpen((open) => !open)}
            aria-label="Abrir menú"
            data-testid="button-mobile-menu"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="border-t border-sidebar-border px-4 py-3 md:hidden">
          <nav className="grid gap-1">
            {links.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent"
                data-testid={`link-mobile-${label.toLowerCase().replaceAll(' ', '-')}`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
            {(user?.role === 'admin' || user?.role === 'merchant') && (
              <Link
                href="/inventory"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent"
                data-testid="link-mobile-inventario"
              >
                <Boxes className="h-4 w-4" />
                Inventario
              </Link>
            )}

            <div className="my-2 h-px bg-sidebar-border" />

            {/* Mobile Account Section */}
            {isAuthenticated ? (
              <div className="rounded-xl bg-sidebar-accent/50 p-3 space-y-2">
                <div className="flex items-center gap-2.5">
                  <UserCircle className="h-5 w-5 text-secondary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-sidebar-foreground">
                      {user?.name ?? clerkUser?.fullName ?? 'Usuario'}
                    </p>
                    <p className="truncate text-xs text-sidebar-foreground/70">
                      {user?.email ?? clerkUser?.primaryEmailAddress?.emailAddress ?? ''}
                    </p>
                  </div>
                </div>
                <Link
                  href="/settings"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-xs text-sidebar-foreground/80 hover:bg-sidebar-accent"
                >
                  <Settings className="h-4 w-4" />
                  <span>Ajustes del usuario</span>
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setMobileOpen(false);
                    openUserProfile?.();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-xs text-sidebar-foreground/80 hover:bg-sidebar-accent text-left"
                >
                  <UserCheck className="h-4 w-4" />
                  <span>Gestionar perfil y seguridad</span>
                </button>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-xs font-medium text-rose-400 hover:bg-rose-500/10 text-left"
                >
                  <LogOut className="h-4 w-4" />
                  <span>Cerrar sesión</span>
                </button>
              </div>
            ) : (
              <div className="grid gap-2 pt-1">
                <Button
                  type="button"
                  onClick={() => {
                    setMobileOpen(false);
                    setLocation('/sign-in');
                  }}
                  className="justify-center gap-2 h-9 text-xs"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  <span>Iniciar sesión</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setMobileOpen(false);
                    setLocation('/sign-up');
                  }}
                  className="justify-center gap-2 h-9 text-xs border-sidebar-border text-sidebar-foreground hover:bg-sidebar-accent"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  <span>Crear cuenta</span>
                </Button>
                <Link
                  href="/settings"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center justify-center gap-2 py-2 text-xs text-sidebar-foreground/70 hover:text-sidebar-foreground"
                >
                  <Settings2 className="h-4 w-4" />
                  <span>Ajustes</span>
                </Link>
              </div>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
