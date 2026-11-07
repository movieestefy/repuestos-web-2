/**
 * @file home-page.tsx
 * @description Catalog browsing and landing page with search, category filtering,
 * product grid, pagination, and merchant recruitment contact CTA.
 */

import { useState, useMemo, useEffect, type FormEvent } from 'react';
import { Link } from 'wouter';
import {
  ArrowLeft,
  ArrowRight,
  CarFront,
  CircleDollarSign,
  Phone,
  Search,
  ShieldCheck,
  Truck,
  Wrench,
  X,
} from 'lucide-react';
import { useListProducts } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/shared/error-state';
import { EmptyState } from '@/components/shared/empty-state';
import { ProductCard } from '@/components/shared/product-card';
import { PartRequestModal } from '@/components/shared/part-request-modal';
import { useDebounce } from '@/hooks/use-debounce';

/**
 * Skeleton placeholder displayed while the product catalog is loading.
 */
export function CatalogSkeleton() {
  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
      {[1, 2, 3, 4].map((item) => (
        <div
          key={item}
          className="overflow-hidden rounded-2xl border border-card-border bg-card"
          data-testid={`skeleton-product-${item}`}
        >
          <div className="h-44 animate-pulse bg-muted" />
          <div className="space-y-3 p-4">
            <div className="h-3 w-20 animate-pulse rounded bg-muted" />
            <div className="h-5 w-4/5 animate-pulse rounded bg-muted" />
            <div className="h-9 w-full animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Main customer landing page featuring hero search, filter pills,
 * live product catalog, and informational banners.
 */
export default function HomePage() {
  // Read initial filter values from URL params for WhatsApp/link shareability
  const initialParams = useMemo(() => {
    if (typeof window === 'undefined') return { q: '', category: '', condition: '' };
    const query = new URLSearchParams(window.location.search);
    return {
      q: query.get('q') || '',
      category: query.get('category') || '',
      condition: query.get('condition') || '',
    };
  }, []);

  const [search, setSearch] = useState(initialParams.q);
  const [category, setCategory] = useState(initialParams.category);
  const [condition, setCondition] = useState(initialParams.condition);
  const [page, setPage] = useState(1);
  const [requestModalOpen, setRequestModalOpen] = useState(false);

  // Throttled debounce (250ms) for real-time search queries without server flooding
  const debouncedSearch = useDebounce(search.trim(), 250);

  // Sync active filters to URL search parameters in real time
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const currentUrl = new URL(window.location.href);
    if (debouncedSearch) {
      currentUrl.searchParams.set('q', debouncedSearch);
    } else {
      currentUrl.searchParams.delete('q');
    }
    if (category) {
      currentUrl.searchParams.set('category', category);
    } else {
      currentUrl.searchParams.delete('category');
    }
    if (condition) {
      currentUrl.searchParams.set('condition', condition);
    } else {
      currentUrl.searchParams.delete('condition');
    }

    const newQueryString = currentUrl.searchParams.toString();
    const newRelativePathQuery = `${currentUrl.pathname}${newQueryString ? `?${newQueryString}` : ''}`;
    window.history.replaceState(null, '', newRelativePathQuery);
  }, [debouncedSearch, category, condition]);

  const params = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      category: category || undefined,
      page,
      pageSize: 12,
    }),
    [category, page, debouncedSearch],
  );

  const productsQuery = useListProducts(params);
  const products = productsQuery.data?.items ?? [];

  const categories = useMemo(
    () => Array.from(new Set(products.map((product) => product.category))).slice(0, 6),
    [products],
  );

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
  };

  return (
    <div>
      {/* Hero Section */}
      <section className="stripe-bg overflow-hidden text-primary-foreground">
        <div className="mx-auto grid max-w-[1440px] items-center gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[1.05fr_.95fr] lg:px-10 lg:py-24">
          <div className="rise-in">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary-foreground/15 bg-primary-foreground/5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.16em] text-secondary">
              <span className="pulse-dot h-2 w-2 rounded-full bg-secondary" />
              Marketplace venezolano de repuestos
            </div>
            <h1 className="max-w-2xl font-display text-5xl font-bold leading-[.98] tracking-[-.06em] sm:text-7xl">
              La pieza correcta.<br />
              <span className="text-secondary">Sin adivinar.</span>
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-primary-foreground/70 sm:text-lg">
              Busca por nombre, código o categoría. Compara precios en USD, mira el equivalente en bolívares y compra a comerciantes locales que conocen su inventario.
            </p>

            <form
              className="mt-8 flex max-w-xl flex-col gap-2 rounded-2xl bg-primary-foreground p-2 shadow-workshop sm:flex-row"
              onSubmit={submitSearch}
              data-testid="form-search-catalog"
            >
              <div className="flex flex-1 items-center gap-3 px-3">
                <Search className="h-5 w-5 text-muted-foreground shrink-0" />
                <input
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Ej. pastillas de freno, BRK-2048, aceite..."
                  className="min-w-0 flex-1 bg-transparent py-3 text-sm text-primary outline-none placeholder:text-muted-foreground"
                  data-testid="input-search-products"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      setPage(1);
                    }}
                    className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-primary"
                    aria-label="Borrar búsqueda"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <Button type="submit" className="h-12 rounded-xl px-6" data-testid="button-search-products">
                Buscar repuesto
              </Button>
            </form>

            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-primary-foreground/55">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-secondary" />
                Comerciantes verificados
              </span>
              <span className="flex items-center gap-1.5">
                <CircleDollarSign className="h-3.5 w-3.5 text-secondary" />
                Tasa visible del día
              </span>
              <span className="flex items-center gap-1.5">
                <Truck className="h-3.5 w-3.5 text-secondary" />
                Retiro y envío coordinado
              </span>
            </div>
          </div>

          <div className="relative hidden min-h-[360px] lg:block">
            <div className="absolute inset-8 rotate-3 rounded-[2rem] border border-secondary/20 bg-secondary/10" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative grid h-[310px] w-[310px] place-items-center rounded-full border border-secondary/35 bg-primary/50 shadow-workshop">
                <div className="absolute inset-7 rounded-full border border-secondary/15" />
                <CarFront className="h-40 w-40 text-secondary" strokeWidth={1.1} />
                <span className="absolute bottom-7 rounded-full bg-secondary px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-[.16em] text-primary">
                  Verificado en ruta
                </span>
              </div>
            </div>
            <div className="absolute left-0 top-12 w-44 rounded-xl border border-primary-foreground/10 bg-primary-foreground/10 p-4 backdrop-blur-sm">
              <p className="font-mono text-[10px] uppercase tracking-widest text-secondary">Hoy</p>
              <p className="mt-2 font-display text-2xl font-bold">2.418</p>
              <p className="text-xs text-primary-foreground/55">piezas disponibles</p>
            </div>
            <div className="absolute bottom-7 right-0 w-48 rounded-xl border border-primary-foreground/10 bg-primary-foreground/10 p-4 backdrop-blur-sm">
              <p className="font-mono text-[10px] uppercase tracking-widest text-secondary">Confianza</p>
              <p className="mt-2 flex items-center gap-2 font-display text-lg font-bold">
                <ShieldCheck className="h-5 w-5 text-secondary" />
                Datos claros
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Main Catalog Section */}
      <main className="mx-auto max-w-[1440px] px-4 py-12 sm:px-6 lg:px-10">
        {/* Banner: Solicitud de Repuestos personalizada */}
        <div className="mb-10 flex flex-col items-center justify-between gap-5 rounded-2xl border border-accent/25 bg-accent/5 p-6 sm:flex-row sm:p-7">
          <div className="flex items-center gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-accent text-accent-foreground shadow-sm">
              <Wrench className="h-6 w-6" />
            </span>
            <div>
              <h3 className="font-display text-lg font-bold text-foreground sm:text-xl">
                ¿No encuentras el repuesto que buscas para tu moto?
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
                Envía tu solicitud y nuestra red nacional de talleres y tiendas aliadas lo ubicará por ti en minutos.
              </p>
            </div>
          </div>
          <Button
            type="button"
            onClick={() => setRequestModalOpen(true)}
            className="shrink-0 gap-2 shadow-sm"
            data-testid="button-banner-part-request"
          >
            <Wrench className="h-4 w-4" />
            <span>Solicitar Repuesto</span>
          </Button>
        </div>

        <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[.2em] text-accent">Explora el catálogo</p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-[-.04em] sm:text-4xl">
              {debouncedSearch ? `Resultados para “${debouncedSearch}”` : 'Lo que más se mueve esta semana'}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs text-muted-foreground">Categoría:</span>
            <button
              type="button"
              onClick={() => {
                setCategory('');
                setPage(1);
              }}
              className={`rounded-full border px-3 py-1.5 text-xs transition ${
                !category
                  ? 'border-primary bg-primary text-primary-foreground font-semibold'
                  : 'border-border bg-card text-muted-foreground hover:border-primary'
              }`}
              data-testid="button-filter-all"
            >
              Todo
            </button>
            {categories.map((item) => (
              <button
                type="button"
                key={item}
                onClick={() => {
                  setCategory(category === item ? '' : item);
                  setPage(1);
                }}
                className={`rounded-full border px-3 py-1.5 text-xs transition ${
                  category === item
                    ? 'border-primary bg-primary text-primary-foreground font-semibold'
                    : 'border-border bg-card text-muted-foreground hover:border-primary'
                }`}
                data-testid={`button-filter-${item}`}
              >
                {item}
              </button>
            ))}
            {(debouncedSearch || category || condition) && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setCategory('');
                  setCondition('');
                  setPage(1);
                }}
                className="ml-2 rounded-full border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive hover:bg-destructive hover:text-destructive-foreground transition"
                data-testid="button-reset-all-filters"
              >
                Limpiar filtros
              </button>
            )}
          </div>
        </div>

        {productsQuery.isLoading ? (
          <CatalogSkeleton />
        ) : productsQuery.isError ? (
          <ErrorState retry={() => productsQuery.refetch()} />
        ) : products.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No encontramos esa pieza"
            description="Prueba con otro código, una categoría distinta o solicita el repuesto directamente a nuestros aliados."
            action={
              <div className="flex flex-wrap items-center justify-center gap-3">
                <Button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setCategory('');
                    setCondition('');
                  }}
                  variant="outline"
                  data-testid="button-clear-filters"
                >
                  Limpiar filtros
                </Button>
                <Button
                  type="button"
                  onClick={() => setRequestModalOpen(true)}
                  className="gap-2"
                  data-testid="button-empty-part-request"
                >
                  <Wrench className="h-4 w-4" />
                  <span>Pedir este repuesto</span>
                </Button>
              </div>
            }
          />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}

        {productsQuery.data && productsQuery.data.totalPages > 1 && (
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
              data-testid="button-previous-page"
            >
              <ArrowLeft className="h-4 w-4" />
              Anterior
            </Button>
            <span className="font-mono text-xs text-muted-foreground" data-testid="text-pagination">
              Página {page} de {productsQuery.data.totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= productsQuery.data.totalPages}
              onClick={() => setPage((current) => current + 1)}
              data-testid="button-next-page"
            >
              Siguiente
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Informational Callouts */}
        <section className="mt-20 grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
          <div className="rounded-2xl bg-secondary p-7 text-primary sm:p-10">
            <p className="font-mono text-[10px] uppercase tracking-[.18em] text-primary/65">Antes de comprar</p>
            <h3 className="mt-3 max-w-md font-display text-3xl font-bold leading-tight tracking-[-.04em]">
              Un código correcto ahorra una devolución.
            </h3>
            <p className="mt-4 max-w-md text-sm leading-6 text-primary/70">
              Si no estás seguro, ten a mano marca, modelo y año del vehículo. Los comerciantes pueden confirmar compatibilidad antes de que pagues.
            </p>
            <Link
              href="/sign-in"
              className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-primary underline-offset-4 hover:underline"
              data-testid="link-help-buying"
            >
              Quiero comprar con cuenta <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="rounded-2xl border border-card-border bg-card p-7 shadow-xs sm:p-10">
            <div className="flex items-start justify-between gap-5">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[.18em] text-accent">¿Quieres formar parte?</p>
                <h3 className="mt-3 max-w-md font-display text-3xl font-bold tracking-[-.04em]">
                  Si quieres ser aliado nuestro contáctanos al
                </h3>
              </div>
              <Phone className="h-8 w-8 shrink-0 text-[#25D366]" />
            </div>
            <a
              href="https://wa.me/qr/VALY6ZX5YZLKE1"
              target="_blank"
              rel="noreferrer"
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#25D366] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#1ebe5d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366] focus-visible:ring-offset-2"
              data-testid="link-merchant-whatsapp"
            >
              <Phone className="h-4 w-4" />
              Escribir por WhatsApp
            </a>
          </div>
        </section>
      </main>

      <PartRequestModal
        open={requestModalOpen}
        onClose={() => setRequestModalOpen(false)}
        defaultPartName={search}
      />
    </div>
  );
}
