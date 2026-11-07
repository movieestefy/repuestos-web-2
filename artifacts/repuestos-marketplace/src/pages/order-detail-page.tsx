/**
 * @file order-detail-page.tsx
 * @description Detailed order tracking view featuring a visual milestone timeline/stepper,
 * payment verification for merchants, merchant contact & WhatsApp coordination for buyers,
 * itemized breakdown with pricing, delivery details, and customer delivery confirmation.
 */

import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Loader2,
  MapPin,
  MessageCircle,
  Package,
  PackageCheck,
  Phone,
  ShieldCheck,
  Star,
  Store,
  Truck,
  X,
  XCircle,
} from 'lucide-react';
import {
  getGetOrderQueryKey,
  getListOrdersQueryKey,
  getListPaymentsQueryKey,
  useGetCurrentUser,
  useGetOrder,
  useUpdateOrderStatus,
} from '@workspace/api-client-react';
import { bs, dateLabel, statusClass, statusLabel, usd } from '@/lib/formatters';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/shared/error-state';
import { NoticeBar, type Notice } from '@/components/shared/notice-bar';
import { PageLoader } from '@/components/shared/page-loader';

const TIMELINE_STEPS = ['pending_payment', 'paid', 'preparing', 'ready', 'delivered'];

/**
 * Detailed order status and item inspection page.
 */
export default function OrderDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const query = useGetOrder(id, {
    query: { queryKey: getGetOrderQueryKey(id), enabled: Boolean(id) },
  });
  const { data: currentUser } = useGetCurrentUser();
  const updateStatus = useUpdateOrderStatus();
  const client = useQueryClient();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [verifyingPayment, setVerifyingPayment] = useState(false);
  const [rejectingPayment, setRejectingPayment] = useState(false);
  const [ratingScore, setRatingScore] = useState<number>(5);
  const [ratingComment, setRatingComment] = useState<string>('');
  const [submittingRating, setSubmittingRating] = useState<boolean>(false);
  const [targetStatusUpdating, setTargetStatusUpdating] = useState<string | null>(null);

  const handleRateMerchant = async () => {
    if (!ratingScore) return;
    setSubmittingRating(true);
    try {
      const res = await fetch(`/api/orders/${order.id}/rate-merchant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score: ratingScore, comment: ratingComment }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo enviar la calificación');
      client.invalidateQueries({ queryKey: getGetOrderQueryKey(order.id) });
      setNotice({ tone: 'success', text: '¡Gracias! Tu calificación al comercio ha sido registrada.' });
    } catch (err: any) {
      setNotice({ tone: 'error', text: err?.message || 'Error al calificar' });
    } finally {
      setSubmittingRating(false);
    }
  };

  const handleRateCustomer = async () => {
    if (!ratingScore) return;
    setSubmittingRating(true);
    try {
      const res = await fetch(`/api/orders/${order.id}/rate-customer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score: ratingScore, comment: ratingComment }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo enviar la calificación');
      client.invalidateQueries({ queryKey: getGetOrderQueryKey(order.id) });
      setNotice({ tone: 'success', text: '¡Calificación al cliente registrada exitosamente!' });
    } catch (err: any) {
      setNotice({ tone: 'error', text: err?.message || 'Error al calificar' });
    } finally {
      setSubmittingRating(false);
    }
  };

  if (query.isLoading) {
    return <PageLoader />;
  }

  if (query.isError || !query.data) {
    return (
      <div className="mx-auto max-w-[1000px] px-4 py-16 sm:px-6">
        <ErrorState retry={() => query.refetch()} />
      </div>
    );
  }

  const order = query.data;
  const isMerchantOrAdmin = currentUser?.role === 'merchant' || currentUser?.role === 'admin';
  const canConfirm = order.status === 'ready' || (order.status === 'preparing' && !isMerchantOrAdmin);

  const handleUpdateStatus = (newStatus: 'preparing' | 'ready' | 'delivered') => {
    setTargetStatusUpdating(newStatus);
    updateStatus.mutate(
      { orderId: order.id, data: { status: newStatus } },
      {
        onSuccess: (updated) => {
          client.setQueryData(getGetOrderQueryKey(order.id), updated);
          client.invalidateQueries({ queryKey: getListOrdersQueryKey() });
          const messages: Record<string, string> = {
            preparing: 'Pedido en preparación (Paso 3). El cliente ya puede ver el avance.',
            ready: 'Pedido marcado como Listo para retirar / entregar (Paso 4).',
            delivered: '¡Pedido confirmado como entregado! (Paso 5).',
          };
          setNotice({
            tone: 'success',
            text: messages[newStatus] || `Estado cambiado a ${statusLabel(newStatus)}.`,
          });
        },
        onError: (err: any) => {
          setNotice({
            tone: 'error',
            text: err?.message || 'No se pudo actualizar el estado del pedido.',
          });
        },
        onSettled: () => {
          setTargetStatusUpdating(null);
        },
      },
    );
  };

  const confirmDelivery = () => {
    handleUpdateStatus('delivered');
  };

  const handleConfirmPayment = async (paymentId: string) => {
    if (!window.confirm('¿Confirmas que verificaste el abono de este pago en tu cuenta bancaria? Al confirmar, el pedido se marcará como PAGADO.')) {
      return;
    }
    setVerifyingPayment(true);
    try {
      const res = await fetch(`/api/payments/${paymentId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo confirmar el pago.');
      client.invalidateQueries({ queryKey: getGetOrderQueryKey(order.id) });
      client.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      client.invalidateQueries({ queryKey: getListPaymentsQueryKey() });
      setNotice({ tone: 'success', text: '¡Pago confirmado exitosamente! El pedido ahora está PAGADO.' });
    } catch (err: any) {
      setNotice({ tone: 'error', text: err?.message || 'Error al confirmar pago' });
    } finally {
      setVerifyingPayment(false);
    }
  };

  const handleRejectPayment = async (paymentId: string) => {
    if (!window.confirm('¿Seguro que deseas rechazar este pago?')) return;
    setRejectingPayment(true);
    try {
      const res = await fetch(`/api/payments/${paymentId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo rechazar el pago.');
      client.invalidateQueries({ queryKey: getGetOrderQueryKey(order.id) });
      client.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      client.invalidateQueries({ queryKey: getListPaymentsQueryKey() });
      setNotice({ tone: 'error', text: 'Pago rechazado.' });
    } catch (err: any) {
      setNotice({ tone: 'error', text: err?.message || 'Error al rechazar pago' });
    } finally {
      setRejectingPayment(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!window.confirm('¿Seguro que deseas cancelar este pedido? El inventario será devuelto al catálogo inmediatamente.')) {
      return;
    }
    setCancelling(true);
    try {
      const res = await fetch(`/api/orders/${order.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'No se pudo cancelar el pedido');
      }
      client.invalidateQueries({ queryKey: getGetOrderQueryKey(order.id) });
      client.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      setNotice({ tone: 'success', text: 'Pedido cancelado con éxito. El inventario fue restaurado.' });
    } catch (err: any) {
      setNotice({ tone: 'error', text: err?.message || 'Error al cancelar pedido' });
    } finally {
      setCancelling(false);
    }
  };

  // WhatsApp link preparation
  const merchantPhoneRaw = order.merchant?.contactPhone || '';
  const merchantPhoneClean = merchantPhoneRaw.replace(/\D/g, '');
  const waPhone = merchantPhoneClean.startsWith('0')
    ? `58${merchantPhoneClean.slice(1)}`
    : merchantPhoneClean.startsWith('58')
      ? merchantPhoneClean
      : `58${merchantPhoneClean}`;

  const merchantDisplayName = order.merchant?.businessName || order.merchant?.name || 'Comerciante Ruta 44';
  const waMessage = encodeURIComponent(
    `Hola ${merchantDisplayName}, acabo de realizar la compra del pedido #${order.id.slice(0, 8).toUpperCase()} en Ruta 44 (Pago verificado). Te contacto para coordinar la entrega o retiro de mis repuestos.`
  );
  const waUrl = merchantPhoneClean.length >= 7 ? `https://wa.me/${waPhone}?text=${waMessage}` : null;

  const currentIndex = TIMELINE_STEPS.indexOf(order.status);
  const isPaymentApprovedOrPaid = order.status !== 'pending_payment' || order.payment?.status === 'approved';

  return (
    <div className="mx-auto max-w-[1050px] px-4 py-10 sm:px-6 lg:py-14">
      <Link
        href="/orders"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        data-testid="link-back-orders"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Volver a pedidos</span>
      </Link>

      <div className="mt-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[.2em] text-accent">Detalle de pedido</p>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-[-.05em]">
            #{order.id.slice(0, 8).toUpperCase()}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {dateLabel(order.createdAt)} · {order.customerName}
          </p>
        </div>
        <Badge
          className={`w-fit border px-3 py-1.5 text-xs ${statusClass(order.status)}`}
          data-testid="status-order-detail"
        >
          {statusLabel(order.status)}
        </Badge>
      </div>

      <div className="fixed right-4 top-20 z-[70]">
        {notice && <NoticeBar notice={notice} onDismiss={() => setNotice(null)} />}
      </div>

      {/* Visual Timeline / Status Stepper */}
      <div className="mt-9 rounded-2xl border border-card-border bg-card p-5 shadow-xs sm:p-7">
        <div className="grid gap-6 md:grid-cols-5">
          {TIMELINE_STEPS.map((step, index) => (
            <div key={step} className="relative flex gap-3 md:block md:text-center">
              <div
                className={`relative z-10 mx-auto grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 ${
                  index <= currentIndex
                    ? 'border-accent bg-accent text-white'
                    : 'border-border bg-background text-muted-foreground'
                }`}
              >
                {index < currentIndex ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <span className="font-mono text-xs">{index + 1}</span>
                )}
              </div>
              <p
                className={`mt-2 text-xs ${
                  index <= currentIndex ? 'font-semibold text-foreground' : 'text-muted-foreground'
                }`}
              >
                {statusLabel(step)}
              </p>
              {index < TIMELINE_STEPS.length - 1 && (
                <span
                  className={`absolute left-9 top-4 h-px w-[calc(100%-2rem)] md:left-[calc(50%+1.25rem)] md:top-4 md:w-[calc(100%-2.5rem)] ${
                    index < currentIndex ? 'bg-accent' : 'bg-border'
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* SECTION 1: MERCHANT PAYMENT VERIFICATION ACTION BOX (When payment reported & pending) */}
      {order.payment && order.payment.status === 'pending' && isMerchantOrAdmin && (
        <div className="mt-7 rounded-2xl border-2 border-amber-500/40 bg-amber-500/5 p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-wider text-amber-800 dark:text-amber-400 font-bold">
                Acción requerida por el comercio
              </span>
              <h3 className="mt-1 font-display text-xl font-bold">Pago Móvil reportado por el cliente</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Verifica en tu cuenta bancaria que el monto fue acreditado antes de confirmar el pedido.
              </p>
            </div>
            <Badge className="border border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300 w-fit">
              Pendiente de confirmación
            </Badge>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-4 rounded-xl border border-border bg-card p-4 text-xs font-mono">
            <div>
              <p className="text-muted-foreground uppercase text-[10px]">Banco</p>
              <p className="font-bold text-foreground mt-0.5">{order.payment.bank}</p>
            </div>
            <div>
              <p className="text-muted-foreground uppercase text-[10px]">Referencia</p>
              <p className="font-bold text-foreground mt-0.5">{order.payment.reference}</p>
            </div>
            <div>
              <p className="text-muted-foreground uppercase text-[10px]">Titular / Teléfono</p>
              <p className="font-bold text-foreground mt-0.5">{order.payment.identityNumber} · {order.payment.phone}</p>
            </div>
            <div>
              <p className="text-muted-foreground uppercase text-[10px]">Monto reportado</p>
              <p className="font-bold text-accent text-sm mt-0.5">{bs(order.payment.amountBs)}</p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            {order.payment.receiptUrl ? (
              <a
                href={order.payment.receiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-xs font-semibold text-accent hover:underline bg-accent/10 px-3 py-2 rounded-lg border border-accent/20"
              >
                <FileText className="h-4 w-4" />
                <span>Ver captura en Google Drive</span>
                <ExternalLink className="h-3.5 w-3.5 opacity-80" />
              </a>
            ) : (
              <span className="text-xs text-muted-foreground italic">El cliente no adjuntó captura</span>
            )}

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={verifyingPayment || rejectingPayment}
                onClick={() => handleRejectPayment(order.payment!.id)}
                className="border-destructive/40 text-destructive hover:bg-destructive/10 text-xs"
              >
                {rejectingPayment ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <XCircle className="h-3.5 w-3.5 mr-1" />}
                <span>Rechazar</span>
              </Button>

              <Button
                type="button"
                size="sm"
                disabled={verifyingPayment || rejectingPayment}
                onClick={() => handleConfirmPayment(order.payment!.id)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs"
              >
                {verifyingPayment ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                <span>Confirmar y Acreditar Pago</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 2: BUYER PENDING VERIFICATION BANNER */}
      {order.payment && order.payment.status === 'pending' && !isMerchantOrAdmin && (
        <div className="mt-7 rounded-2xl border border-accent/30 bg-accent/5 p-5 shadow-xs">
          <div className="flex items-start gap-3">
            <Clock className="h-5 w-5 text-accent animate-pulse shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-sm">Pago Móvil reportado (Ref: {order.payment.reference})</h3>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                El comerciante está verificando el abono en su cuenta bancaria ({order.payment.bank} por {bs(order.payment.amountBs)}). Tan pronto la tienda confirme la acreditación, aquí se habilitará automáticamente el <strong>botón de WhatsApp y los datos del comercio</strong> para coordinar la entrega o retiro de tus repuestos.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 3: MERCHANT BUSINESS DETAILS & DIRECT WHATSAPP LINK (Active once confirmed/paid) */}
      {isPaymentApprovedOrPaid && (
        <div className="mt-7 rounded-2xl border-2 border-emerald-500/30 bg-emerald-500/5 p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-emerald-500/20 pb-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-600 text-white shadow-xs">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-800 dark:text-emerald-300 font-bold">
                  ¡Pago Confirmado por el Comercio!
                </span>
                <h3 className="font-display text-xl font-bold">Datos del Comerciante Vendedor</h3>
              </div>
            </div>
            <Badge className="border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 w-fit">
              Pago Acreditado
            </Badge>
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            El pago fue confirmado satisfactoriamente. Comunícate directamente con la tienda para coordinar el retiro en su local o el despacho por delivery.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Store & RIF */}
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Comercio / Tienda</p>
              <p className="mt-1 font-display text-base font-bold text-foreground">
                {order.merchant?.businessName || order.merchant?.name || 'Comercio Ruta 44'}
              </p>
              {order.merchant?.rif && (
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">RIF: {order.merchant.rif}</p>
              )}
            </div>

            {/* Address */}
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Dirección de Retiro</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {order.merchant?.address || 'Dirección a coordinar con el comercio'}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">Ciudad: {order.merchant?.city || order.deliveryCity}</p>
            </div>

            {/* Hours & Delivery */}
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Horario y Entrega</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {order.merchant?.businessHours || 'Lunes a Viernes (8:00 AM - 5:00 PM)'}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {order.merchant?.hasDelivery ? '✓ Ofrece servicio de delivery' : 'Solo retiro en tienda'}
              </p>
            </div>
          </div>

          {/* Direct WhatsApp and Call links */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {waUrl && (
              <a
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-[#25D366] hover:bg-[#20ba59] px-5 py-3 text-sm font-bold text-white shadow-sm transition"
                data-testid="button-open-merchant-whatsapp"
              >
                <MessageCircle className="h-4 w-4" />
                <span>Abrir WhatsApp del Comerciante</span>
                <ExternalLink className="h-3.5 w-3.5 opacity-80" />
              </a>
            )}

            {order.merchant?.contactPhone && (
              <a
                href={`tel:${order.merchant.contactPhone}`}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-card hover:bg-muted px-4 py-3 text-sm font-semibold text-foreground transition"
                data-testid="button-call-merchant"
              >
                <Phone className="h-4 w-4 text-accent" />
                <span>Llamar: {order.merchant.contactPhone}</span>
              </a>
            )}
          </div>
        </div>
      )}

      {/* SECTION 3.5: MERCHANT ORDER LIFECYCLE MANAGEMENT (Steps 3, 4 & 5) */}
      {isMerchantOrAdmin && order.status !== 'pending_payment' && order.status !== 'cancelled' && (
        <div className="mt-7 rounded-2xl border-2 border-accent/40 bg-card p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-white shadow-xs">
                <PackageCheck className="h-5 w-5" />
              </div>
              <div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-accent font-bold">
                  Panel de Despacho del Comercio
                </span>
                <h3 className="font-display text-xl font-bold">Control de Pasos del Pedido</h3>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Estado actual:</span>
              <Badge className={`border px-3 py-1 text-xs ${statusClass(order.status)}`}>
                {statusLabel(order.status)}
              </Badge>
            </div>
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            Avanza los pasos para notificar al cliente en tiempo real sobre la preparación y entrega de sus repuestos:
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            {/* PASO 3: PREPARANDO */}
            <div
              className={`flex flex-col justify-between rounded-xl border p-4 transition ${
                order.status === 'preparing'
                  ? 'border-accent bg-accent/5 ring-2 ring-accent/30'
                  : currentIndex > 2
                  ? 'border-emerald-500/30 bg-emerald-500/5'
                  : 'border-border bg-card'
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-accent">Paso 3</span>
                  {currentIndex > 2 ? (
                    <Badge variant="outline" className="border-emerald-500 text-emerald-600 text-[10px] gap-1 py-0">
                      <Check className="h-3 w-3" /> Listo
                    </Badge>
                  ) : order.status === 'preparing' ? (
                    <Badge className="bg-accent text-white text-[10px] py-0">En progreso</Badge>
                  ) : null}
                </div>
                <h4 className="mt-2 font-display text-base font-bold">3. Preparando</h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  Alistando y embalando repuestos en el almacén o mostrador.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant={order.status === 'preparing' ? 'secondary' : order.status === 'paid' ? 'default' : 'outline'}
                className="mt-4 w-full text-xs font-semibold"
                disabled={targetStatusUpdating !== null || order.status === 'delivered'}
                onClick={() => handleUpdateStatus('preparing')}
                data-testid="button-step-preparing"
              >
                {targetStatusUpdating === 'preparing' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <Clock className="h-3.5 w-3.5 mr-1.5" />
                )}
                <span>{order.status === 'preparing' ? 'En Preparación ✓' : '3. Marcar Preparando'}</span>
              </Button>
            </div>

            {/* PASO 4: LISTO PARA RETIRAR / ENTREGAR */}
            <div
              className={`flex flex-col justify-between rounded-xl border p-4 transition ${
                order.status === 'ready'
                  ? 'border-accent bg-accent/5 ring-2 ring-accent/30'
                  : currentIndex > 3
                  ? 'border-emerald-500/30 bg-emerald-500/5'
                  : 'border-border bg-card'
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-accent">Paso 4</span>
                  {currentIndex > 3 ? (
                    <Badge variant="outline" className="border-emerald-500 text-emerald-600 text-[10px] gap-1 py-0">
                      <Check className="h-3 w-3" /> Listo
                    </Badge>
                  ) : order.status === 'ready' ? (
                    <Badge className="bg-accent text-white text-[10px] py-0">Listo para entrega</Badge>
                  ) : null}
                </div>
                <h4 className="mt-2 font-display text-base font-bold">4. Listo para retirar</h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  Repuesto listo en tienda para retiro o disponible para el delivery.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant={order.status === 'ready' ? 'secondary' : order.status === 'preparing' ? 'default' : 'outline'}
                className="mt-4 w-full text-xs font-semibold"
                disabled={targetStatusUpdating !== null || order.status === 'delivered'}
                onClick={() => handleUpdateStatus('ready')}
                data-testid="button-step-ready"
              >
                {targetStatusUpdating === 'ready' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <Store className="h-3.5 w-3.5 mr-1.5" />
                )}
                <span>{order.status === 'ready' ? 'Listo en Local ✓' : '4. Marcar Listo para Retiro'}</span>
              </Button>
            </div>

            {/* PASO 5: ENTREGADO */}
            <div
              className={`flex flex-col justify-between rounded-xl border p-4 transition ${
                order.status === 'delivered'
                  ? 'border-emerald-500 bg-emerald-500/10 ring-2 ring-emerald-500/30'
                  : 'border-border bg-card'
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-emerald-600">Paso 5</span>
                  {order.status === 'delivered' && (
                    <Badge className="bg-emerald-600 text-white text-[10px] py-0">Entregado</Badge>
                  )}
                </div>
                <h4 className="mt-2 font-display text-base font-bold">5. Entregado</h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  Piezas entregadas al cliente satisfactoriamente.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant={order.status === 'delivered' ? 'secondary' : 'default'}
                className={`mt-4 w-full text-xs font-semibold ${
                  order.status !== 'delivered' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''
                }`}
                disabled={targetStatusUpdating !== null || order.status === 'delivered'}
                onClick={() => handleUpdateStatus('delivered')}
                data-testid="button-step-delivered"
              >
                {targetStatusUpdating === 'delivered' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                )}
                <span>{order.status === 'delivered' ? 'Entregado con Éxito ✓' : '5. Marcar como Entregado'}</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 3.6: CUSTOMER STATUS TRACKING & CONFIRM DELIVERY ACTION */}
      {!isMerchantOrAdmin && order.status !== 'pending_payment' && order.status !== 'cancelled' && (
        <div className="mt-7">
          {order.status === 'preparing' && (
            <div className="rounded-2xl border border-accent/40 bg-accent/5 p-5 shadow-xs">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-white shrink-0 mt-0.5">
                  <Package className="h-5 w-5" />
                </div>
                <div>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-accent font-bold">
                    Paso 3: En Proceso
                  </span>
                  <h3 className="font-display text-lg font-bold">El comercio está preparando tus repuestos</h3>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                    Tus piezas están siendo verificadas y embaladas en la tienda. Tan pronto estén listas para que pases a retirarlas o salgan en delivery, verás habilitado el botón para confirmar la recepción.
                  </p>
                </div>
              </div>
            </div>
          )}

          {order.status === 'ready' && (
            <div className="rounded-2xl border-2 border-emerald-500/40 bg-emerald-500/5 p-6 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-600 text-white shrink-0 mt-0.5">
                    <Store className="h-5 w-5" />
                  </div>
                  <div>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-800 dark:text-emerald-300 font-bold">
                      Paso 4: ¡Listo para Entrega!
                    </span>
                    <h3 className="font-display text-lg font-bold">Tus repuestos están listos para retirar o recibir</h3>
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                      Pasa por el local del comercio o recíbelos si coordinaste delivery. Cuando ya tengas las piezas en mano, confirma aquí la entrega para finalizar tu pedido:
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shrink-0 px-5 py-3 h-auto shadow-sm"
                  disabled={targetStatusUpdating !== null}
                  onClick={() => handleUpdateStatus('delivered')}
                  data-testid="button-customer-confirm-delivered"
                >
                  {targetStatusUpdating === 'delivered' ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 mr-1.5" />
                  )}
                  <span>Confirmar que ya recibí mi pedido</span>
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SECTION 4: UNPAID ORDER REMINDER (If no payment reported) */}
      {!order.payment && order.status === 'pending_payment' && (
        <div className="mt-7 rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold text-sm">Este pedido está pendiente de pago</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Realiza la transferencia móvil por {bs(order.totalBs)} ({usd(order.totalUsd)}) para que el comerciante verifique y despache tus repuestos.
              </p>
            </div>
            <Link
              href="/checkout"
              className="inline-flex h-9 items-center justify-center rounded-lg bg-accent px-4 text-xs font-semibold text-white hover:bg-accent/90"
            >
              <span>Registrar Pago Móvil</span>
            </Link>
          </div>
        </div>
      )}

      {/* SECTION 5: MUTUAL 1-5 STAR RATING SYSTEM (Only after order is delivered) */}
      {order.status === 'delivered' && (
        <div className="mt-7">
          {/* CUSTOMER RATING FORM / BADGE FOR MERCHANT */}
          {!isMerchantOrAdmin && (
            order.merchantRating ? (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6 shadow-xs">
                <div className="flex items-center gap-2">
                  <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
                  <h4 className="font-semibold text-sm">Tu calificación a este comercio</h4>
                </div>
                <div className="mt-2.5 flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      className={`h-4 w-4 ${
                        star <= order.merchantRating!.score
                          ? 'fill-amber-400 text-amber-400'
                          : 'text-muted-foreground/30'
                      }`}
                    />
                  ))}
                  <span className="ml-2 font-mono text-xs font-bold text-foreground">
                    {order.merchantRating.score} / 5
                  </span>
                </div>
                {order.merchantRating.comment && (
                  <p className="mt-2 text-xs text-muted-foreground italic">
                    "{order.merchantRating.comment}"
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border-2 border-amber-500/30 bg-card p-6 shadow-sm">
                <div className="flex items-center gap-2.5">
                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-amber-500 text-white">
                    <Star className="h-5 w-5 fill-white" />
                  </div>
                  <div>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-amber-600 font-bold">
                      Pedido Entregado con Éxito
                    </span>
                    <h3 className="font-display text-xl font-bold">Califica al Comercio (1 a 5 Estrellas)</h3>
                  </div>
                </div>

                <p className="mt-2 text-xs text-muted-foreground">
                  ¿Cómo fue la atención, tiempo de entrega y calidad del repuesto suministrado por la tienda?
                </p>

                <div className="mt-4 flex items-center gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRatingScore(star)}
                      className="p-1 transition hover:scale-115"
                      aria-label={`${star} estrellas`}
                      data-testid={`btn-rate-star-${star}`}
                    >
                      <Star
                        className={`h-7 w-7 transition ${
                          star <= ratingScore
                            ? 'fill-amber-400 text-amber-400'
                            : 'text-muted-foreground/30 hover:text-amber-300'
                        }`}
                      />
                    </button>
                  ))}
                  <span className="ml-2 font-mono text-sm font-bold text-amber-600">
                    {ratingScore} de 5 estrellas
                  </span>
                </div>

                <div className="mt-4">
                  <input
                    type="text"
                    value={ratingComment}
                    onChange={(e) => setRatingComment(e.target.value)}
                    placeholder="Escribe tu reseña o comentario (opcional)..."
                    maxLength={300}
                    className="h-11 w-full rounded-lg border border-input bg-background px-3 text-xs outline-none focus:border-accent"
                    data-testid="input-rate-comment"
                  />
                </div>

                <Button
                  type="button"
                  onClick={handleRateMerchant}
                  disabled={submittingRating}
                  className="mt-4 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs"
                  data-testid="button-submit-rate-merchant"
                >
                  {submittingRating ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Star className="h-4 w-4 mr-1.5 fill-white" />}
                  <span>Enviar Calificación al Comercio</span>
                </Button>
              </div>
            )
          )}

          {/* MERCHANT RATING FORM / BADGE FOR CUSTOMER */}
          {isMerchantOrAdmin && (
            order.customerRating ? (
              <div className="rounded-2xl border border-primary/20 bg-muted/20 p-6 shadow-xs">
                <div className="flex items-center gap-2">
                  <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
                  <h4 className="font-semibold text-sm">Tu calificación a este cliente ({order.customerName})</h4>
                </div>
                <div className="mt-2.5 flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      className={`h-4 w-4 ${
                        star <= order.customerRating!.score
                          ? 'fill-amber-400 text-amber-400'
                          : 'text-muted-foreground/30'
                      }`}
                    />
                  ))}
                  <span className="ml-2 font-mono text-xs font-bold text-foreground">
                    {order.customerRating.score} / 5
                  </span>
                </div>
                {order.customerRating.comment && (
                  <p className="mt-2 text-xs text-muted-foreground italic">
                    "{order.customerRating.comment}"
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border-2 border-primary/20 bg-card p-6 shadow-sm">
                <div className="flex items-center gap-2.5">
                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
                    <Star className="h-5 w-5 fill-white" />
                  </div>
                  <div>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-primary font-bold">
                      Control de Reputación
                    </span>
                    <h3 className="font-display text-xl font-bold">Califica al Cliente ({order.customerName})</h3>
                  </div>
                </div>

                <p className="mt-2 text-xs text-muted-foreground">
                  Evalúa la puntualidad, fluidez en la comunicación y trato del comprador para mantener el registro de clientes de confianza.
                </p>

                <div className="mt-4 flex items-center gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRatingScore(star)}
                      className="p-1 transition hover:scale-115"
                      aria-label={`${star} estrellas`}
                      data-testid={`btn-rate-customer-star-${star}`}
                    >
                      <Star
                        className={`h-7 w-7 transition ${
                          star <= ratingScore
                            ? 'fill-amber-400 text-amber-400'
                            : 'text-muted-foreground/30 hover:text-amber-300'
                        }`}
                      />
                    </button>
                  ))}
                  <span className="ml-2 font-mono text-sm font-bold text-amber-600">
                    {ratingScore} de 5 estrellas
                  </span>
                </div>

                <div className="mt-4">
                  <input
                    type="text"
                    value={ratingComment}
                    onChange={(e) => setRatingComment(e.target.value)}
                    placeholder="Nota sobre el comprador (opcional)..."
                    maxLength={300}
                    className="h-11 w-full rounded-lg border border-input bg-background px-3 text-xs outline-none focus:border-accent"
                    data-testid="input-rate-customer-comment"
                  />
                </div>

                <Button
                  type="button"
                  onClick={handleRateCustomer}
                  disabled={submittingRating}
                  className="mt-4 font-bold text-xs"
                  data-testid="button-submit-rate-customer"
                >
                  {submittingRating ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Star className="h-4 w-4 mr-1.5 fill-current" />}
                  <span>Guardar Calificación del Cliente</span>
                </Button>
              </div>
            )
          )}
        </div>
      )}

      {/* Order Itemization & Confirmation Summary */}
      <div className="mt-7 grid gap-7 lg:grid-cols-[1fr_330px]">
        <div className="rounded-2xl border border-card-border bg-card p-5 shadow-xs sm:p-7">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl font-bold">Piezas del pedido</h2>
            <span className="font-mono text-xs text-muted-foreground">{order.items.length} líneas</span>
          </div>

          <div className="mt-6 divide-y divide-border">
            {order.items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
                data-testid={`row-order-item-${item.id}`}
              >
                <div>
                  <p className="font-medium">{item.productName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.quantity} × {usd(item.unitPriceUsd)}
                  </p>
                </div>
                <p className="font-mono font-bold">{usd(item.subtotalUsd)}</p>
              </div>
            ))}
          </div>
        </div>

        <aside className="h-fit rounded-2xl border border-card-border bg-card p-6 shadow-sm">
          <p className="font-mono text-[10px] uppercase tracking-[.18em] text-accent">Total pedido</p>
          <p className="mt-3 font-display text-4xl font-bold">{usd(order.totalUsd)}</p>
          <p className="mt-1 font-mono text-sm text-accent">
            {bs(order.totalBs)} · tasa {order.exchangeRate.toFixed(2)}
          </p>

          <div className="mt-6 border-t border-border pt-5 text-sm">
            <p className="flex items-center gap-2 text-muted-foreground">
              <Phone className="h-4 w-4 text-accent" />
              <span>Cliente: {order.customerPhone}</span>
            </p>
            {order.customerReputation && order.customerReputation.totalCount > 0 && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-600">
                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                <span>Reputación comprador: {order.customerReputation.avgScore} / 5</span>
                <span className="font-normal text-muted-foreground">({order.customerReputation.totalCount} compras)</span>
              </p>
            )}
            {order.pickupNotes && (
              <p className="mt-3 flex items-start gap-2 leading-5 text-muted-foreground">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <span>{order.pickupNotes}</span>
              </p>
            )}
          </div>

          {!isMerchantOrAdmin && (order.status === 'ready' || order.status === 'preparing') && (
            <Button
              type="button"
              className="mt-6 w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
              disabled={targetStatusUpdating !== null}
              onClick={() => handleUpdateStatus('delivered')}
              data-testid="button-confirm-delivery"
            >
              {targetStatusUpdating === 'delivered' ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-1.5" />
              )}
              <span>Confirmar que recibí mi pedido</span>
            </Button>
          )}

          {isMerchantOrAdmin && order.status === 'ready' && (
            <Button
              type="button"
              className="mt-6 w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
              disabled={targetStatusUpdating !== null}
              onClick={() => handleUpdateStatus('delivered')}
              data-testid="button-merchant-confirm-delivery"
            >
              {targetStatusUpdating === 'delivered' ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-1.5" />
              )}
              <span>Marcar como Entregado</span>
            </Button>
          )}

          {order.status === 'pending_payment' && !order.payment && (
            <Button
              type="button"
              variant="outline"
              className="mt-4 w-full border-destructive/40 text-destructive hover:bg-destructive/10"
              disabled={cancelling}
              onClick={handleCancelOrder}
              data-testid="button-cancel-pending-order"
            >
              {cancelling && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              <span>Cancelar pedido y liberar stock</span>
            </Button>
          )}
        </aside>
      </div>
    </div>
  );
}
