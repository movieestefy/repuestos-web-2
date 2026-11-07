/**
 * @file app-footer.tsx
 * Site-wide footer component with branding, navigation links, and operational links.
 */

import { Link } from 'wouter';
import { Logo } from '@/components/layout/logo';

export function AppFooter() {
  return (
    <footer className="mt-20 border-t border-border bg-primary text-primary-foreground">
      <div className="mx-auto grid max-w-[1440px] gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.4fr_.8fr_.8fr] lg:px-10">
        <div>
          <Logo />
          <p className="mt-4 max-w-sm text-sm leading-6 text-primary-foreground/65">
            Repuestos claros, precios al día y comerciantes que responden. Compra con la pieza correcta desde cualquier punto de Venezuela.
          </p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[.18em] text-secondary">Comprar</p>
          <div className="mt-4 grid gap-3 text-sm text-primary-foreground/70">
            <Link href="/" data-testid="link-footer-catalogo">Catálogo</Link>
            <Link href="/orders" data-testid="link-footer-orders">Seguimiento de pedidos</Link>
            <Link href="/cart" data-testid="link-footer-cart">Carrito</Link>
            <a
              href="https://wa.me/qr/VALY6ZX5YZLKE1"
              target="_blank"
              rel="noreferrer"
              className="text-[#25D366] hover:underline"
              data-testid="link-footer-whatsapp"
            >
              Atención WhatsApp
            </a>
          </div>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[.18em] text-secondary">Operaciones</p>
          <div className="mt-4 grid gap-3 text-sm text-primary-foreground/70">
            <Link href="/inventory" data-testid="link-footer-inventory">Inventario</Link>
            <Link href="/payments" data-testid="link-footer-payments">Pagos móviles</Link>
            <Link href="/settings" data-testid="link-footer-settings">Ajustes y tasa</Link>
          </div>
        </div>
      </div>
      <div className="border-t border-primary-foreground/10 px-4 py-4 text-center font-mono text-[10px] uppercase tracking-[.14em] text-primary-foreground/45">
        Hecho para los talleres que mantienen a Venezuela en movimiento
      </div>
    </footer>
  );
}
