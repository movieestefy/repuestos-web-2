/**
 * @file orders-page.tsx
 * @description Customer order history list displaying order status badges,
 * item counts, order totals in USD and Bs., and direct link to order tracking details.
 */

import { Link, useLocation } from 'wouter';
import {
  ArrowRight,
  ClipboardList,
  LogIn,
  ShoppingCart,
} from 'lucide-react';
import {
  getGetCurrentUserQueryKey,
  getListOrdersQueryKey,
  useGetCurrentUser,
  useListOrders,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorState } from '@/components/shared/error-state';
import { OrderRow } from '@/components/shared/order-row';

/**
 * Orders history page for customer tracking of past and active purchases.
 */
export default function OrdersPage() {
  const [, setLocation] = useLocation();
  const { data: user, isLoading: isUserLoading } = useGetCurrentUser({
    query: { queryKey: getGetCurrentUserQueryKey(), retry: false },
  });

  const query = useListOrders(
    { page: 1, pageSize: 30 },
    {
      query: {
        queryKey: getListOrdersQueryKey({ page: 1, pageSize: 30 }),
        enabled: Boolean(user),
      },
    },
  );
  const orders = query.data?.items ?? [];

  if (!isUserLoading && !user) {
    return (
      <div className="mx-auto max-w-[600px] px-4 py-20 text-center sm:px-6">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-secondary/15 text-primary">
          <ClipboardList className="h-8 w-8 text-secondary" />
        </div>
        <h1 className="mt-6 font-display text-3xl font-bold tracking-tight">
          Inicia sesión para ver tus pedidos
        </h1>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
          Tus compras y estados de entrega están vinculados a tu cuenta personal. Inicia sesión para ver el historial y hacer seguimiento a tus repuestos.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button
            type="button"
            onClick={() => setLocation('/sign-in?redirect_url=/orders')}
            className="gap-2"
          >
            <LogIn className="h-4 w-4" />
            <span>Iniciar sesión</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setLocation('/')}
            className="gap-2"
          >
            <span>Volver al catálogo</span>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6 lg:py-14">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[.2em] text-accent">Historial</p>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-[-.05em]">Mis pedidos</h1>
        </div>
        <Link
          href="/"
          className="hidden items-center gap-2 text-sm text-muted-foreground hover:text-foreground sm:flex"
          data-testid="link-orders-shop"
        >
          <ShoppingCart className="h-4 w-4" />
          <span>Seguir comprando</span>
        </Link>
      </div>

      <div className="mt-9">
        {query.isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((item) => (
              <div
                key={item}
                className="h-24 animate-pulse rounded-2xl bg-muted"
                data-testid={`skeleton-order-${item}`}
              />
            ))}
          </div>
        ) : query.isError ? (
          <ErrorState retry={() => query.refetch()} />
        ) : orders.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="Todavía no tienes pedidos"
            description="Cuando confirmes una compra, el seguimiento aparecerá en este espacio."
            action={
              <Link
                href="/"
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
                data-testid="link-orders-empty-shop"
              >
                <span>Ver catálogo</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            }
          />
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <OrderRow key={order.id} order={order} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
