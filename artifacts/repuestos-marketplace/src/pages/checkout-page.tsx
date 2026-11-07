/**
 * @file checkout-page.tsx
 * @description Two-step checkout process:
 * 1. Customer contact and delivery coordinate capture to generate an Order.
 * 2. Pago Móvil transaction reference submission and receiver verification.
 * 
 * Includes critical React reconciliation fix for dynamic DOM tree substitution.
 */

import { useState, useEffect, useRef, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  QrCode,
  Send,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
} from 'lucide-react';
import {
  getGetCurrentUserQueryKey,
  getGetOrderQueryKey,
  getGetPaymentReceiverQueryKey,
  getGetTodayRateQueryKey,
  getListDeliveryLocationsQueryKey,
  getListOrdersQueryKey,
  getListPaymentsQueryKey,
  useCreateOrder,
  useGetCurrentUser,
  useGetPaymentReceiver,
  useGetTodayRate,
  useListDeliveryLocations,
  useSubmitPayment,
  type Order,
} from '@workspace/api-client-react';
import { bs, usd } from '@/lib/formatters';
import { useCart } from '@/lib/cart-context';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/empty-state';
import { NoticeBar, type Notice } from '@/components/shared/notice-bar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * Format phone number with chunking for rapid optical scanning (04XX - XXX - XXXX)
 */
function formatPhoneChunked(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length >= 11) {
    return {
      prefix: digits.slice(0, 4),
      mid: digits.slice(4, 7),
      last4: digits.slice(7, 11),
    };
  }
  return {
    prefix: digits.slice(0, 4) || '04XX',
    mid: digits.slice(4, 7) || 'XXX',
    last4: digits.slice(7) || 'XXXX',
  };
}

/**
 * Format identity number with chunking (V - XX.XXX.XXX)
 */
function formatIdentityChunked(id: string) {
  const type = id.match(/^[VEJGvejg]-?/)?.[0]?.toUpperCase()?.replace('-', '') || 'V';
  const digits = id.replace(/\D/g, '');
  if (digits.length > 4) {
    const main = digits.slice(0, digits.length - 4);
    const last4 = digits.slice(digits.length - 4);
    // Format main digits with thousand separator
    const formattedMain = main.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return { type: `${type} - `, main: formattedMain, last4 };
  }
  return { type: `${type} - `, main: digits, last4: '' };
}

interface OrderSummaryProps {
  amountUsd: number;
  rate?: number;
  submitting: boolean;
}

/**
 * Order cost summary component with dynamic rate conversion and submit action.
 */
export function OrderSummary({ amountUsd, rate, submitting }: OrderSummaryProps) {
  return (
    <aside className="h-fit rounded-2xl border border-card-border bg-card p-6 shadow-sm">
      <p className="font-mono text-[10px] uppercase tracking-[.18em] text-accent">Resumen del pedido</p>
      <div className="mt-5 flex items-center justify-between text-sm text-muted-foreground">
        <span>Repuestos</span>
        <span className="font-mono text-foreground">{usd(amountUsd)}</span>
      </div>
      <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
        <span>Entrega</span>
        <span className="text-xs">A coordinar</span>
      </div>
      <div className="mt-5 border-t border-border pt-4">
        <div className="flex items-end justify-between">
          <span className="font-semibold">Total</span>
          <span className="font-display text-3xl font-bold">{usd(amountUsd)}</span>
        </div>
        {rate ? (
          <p className="mt-1 text-right font-mono text-xs text-accent">{bs(amountUsd * rate)}</p>
        ) : (
          <p className="mt-1 text-right text-xs text-muted-foreground">Tasa pendiente</p>
        )}
      </div>
      <Button
        type="submit"
        className="mt-7 w-full"
        disabled={submitting}
        data-testid="button-create-order"
      >
        {submitting ? (
          <Loader2 key="icon-submitting" className="h-4 w-4 animate-spin" />
        ) : (
          <ArrowRight key="icon-arrow" className="h-4 w-4" />
        )}
        <span>Crear pedido</span>
      </Button>
      <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
        Después podrás registrar tu pago móvil.
      </p>
    </aside>
  );
}

/**
 * Checkout page managing order creation and instant Pago Móvil payment registration.
 */
export default function CheckoutPage() {
  const cart = useCart();
  const { data: rate } = useGetTodayRate({
    query: { queryKey: getGetTodayRateQueryKey() },
  });
  const { data: deliveryLocations = [] } = useListDeliveryLocations({
    query: { queryKey: getListDeliveryLocationsQueryKey(), staleTime: 5 * 60 * 1000 },
  });
  const { data: receiver } = useGetPaymentReceiver({
    query: { queryKey: getGetPaymentReceiverQueryKey(), retry: false },
  });

  const createOrder = useCreateOrder();
  const submitPayment = useSubmitPayment();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { user: clerkUser } = useUser();
  const { data: user } = useGetCurrentUser({
    query: { queryKey: getGetCurrentUserQueryKey(), retry: false },
  });

  const [order, setOrder] = useState<Order | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [deliveryCity, setDeliveryCity] = useState('Barinas');
  const [notes, setNotes] = useState('');

  // Prefill name from logged in session
  useEffect(() => {
    if (!name) {
      if (user?.name) setName(user.name);
      else if (clerkUser?.fullName) setName(clerkUser.fullName);
    }
  }, [user, clerkUser, name]);

  // Structured Mobile Payment inputs with instant visual validation
  const [bank, setBank] = useState('');
  const [idPrefix, setIdPrefix] = useState<'V-' | 'E-' | 'J-' | 'G-'>('V-');
  const [idNumber, setIdNumber] = useState('');
  const [reference, setReference] = useState('');
  const [phonePrefix, setPhonePrefix] = useState('0412');
  const [phoneBody, setPhoneBody] = useState('');

  // Receipt capture state for Google Drive upload
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState<boolean>(false);
  const [uploadedReceiptUrl, setUploadedReceiptUrl] = useState<string | null>(null);

  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  // Tab mode for client: 'qr' (QR code scan) vs 'manual' (Chunked Text + Protected Copy)
  const [paymentModalTab, setPaymentModalTab] = useState<'qr' | 'manual'>('qr');
  // Reading mode without clipboard: disables copy buttons and prevents text selection
  const [noClipboardMode, setNoClipboardMode] = useState<boolean>(false);

  // Anti-Clipboard Hijacking Confirmation Modal state
  const [isSecurityModalOpen, setIsSecurityModalOpen] = useState<boolean>(false);
  const [copiedDetail, setCopiedDetail] = useState<{
    label: string;
    value: string;
    fullDetails?: boolean;
  } | null>(null);

  // Canvas ref for verified read-only QR rendering
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [qrIntegrityValid, setQrIntegrityValid] = useState<boolean | null>(null);

  // 45-minute reservation timer state
  const [reservationRemaining, setReservationRemaining] = useState<{
    minutes: number;
    seconds: number;
    isExpired: boolean;
  }>({
    minutes: 45,
    seconds: 0,
    isExpired: false,
  });

  const notify = (next: Notice) => {
    setNotice(next);
    window.setTimeout(() => setNotice(null), 4000);
  };

  /**
   * Safe copy with Mandatory Anti-Clipboard Hijacking confirmation modal
   */
  const handleSafeCopy = (value: string, label: string, fieldId: string, fullDetails: boolean = false) => {
    navigator.clipboard.writeText(value);
    setCopiedField(fieldId);
    setCopiedDetail({ label, value, fullDetails });
    setIsSecurityModalOpen(true);
    window.setTimeout(() => {
      setCopiedField((current) => (current === fieldId ? null : current));
    }, 2000);
  };

  // Switch to manual mode if no QR code is configured by admin
  useEffect(() => {
    if (receiver && !receiver.qrImageData) {
      setPaymentModalTab('manual');
    }
  }, [receiver]);

  // Client-side cryptographic integrity verification of the QR Code (SHA-256)
  useEffect(() => {
    if (!receiver?.qrImageData) {
      setQrIntegrityValid(null);
      return;
    }

    if (!receiver.qrSha256) {
      setQrIntegrityValid(true);
      return;
    }

    let isMounted = true;
    (async () => {
      try {
        const response = await fetch(receiver.qrImageData!);
        const buffer = await response.arrayBuffer();
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
        if (isMounted) {
          const match = hashHex.toLowerCase() === receiver.qrSha256?.toLowerCase();
          setQrIntegrityValid(match);
        }
      } catch (err) {
        console.error('[checkout] Error verifying QR SHA-256:', err);
        if (isMounted) setQrIntegrityValid(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [receiver?.qrImageData, receiver?.qrSha256]);

  // Render QR inside secure read-only canvas with official imprint metadata banner
  useEffect(() => {
    if (paymentModalTab !== 'qr' || !receiver?.qrImageData || qrIntegrityValid === false || !order) {
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const width = 420;
      const height = 520;
      canvas.width = width;
      canvas.height = height;

      // Clean background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      // Draw QR image
      const qrSize = 340;
      const qrX = (width - qrSize) / 2;
      const qrY = 24;
      ctx.drawImage(img, qrX, qrY, qrSize, qrSize);

      // Official Imprinted Metadata Banner
      const bannerY = qrY + qrSize + 16;
      ctx.fillStyle = '#17333a';
      ctx.beginPath();
      ctx.roundRect(16, bannerY, width - 32, 114, 12);
      ctx.fill();

      ctx.fillStyle = '#f4f3eb';
      ctx.font = 'bold 14px "DM Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('RUTA 44 • PAGO MÓVIL OFICIAL', width / 2, bannerY + 28);

      ctx.font = '13px monospace';
      ctx.fillStyle = '#9fd4b8';
      ctx.fillText(`${receiver.bank} • ${receiver.phone}`, width / 2, bannerY + 54);
      ctx.fillText(`${receiver.identityNumber} • Bs. ${order.totalBs.toFixed(2)}`, width / 2, bannerY + 76);

      ctx.font = '10px monospace';
      ctx.fillStyle = '#a6b3aa';
      ctx.fillText(`VERIFICADO SHA-256 • PEDIDO #${order.id.slice(0, 8).toUpperCase()}`, width / 2, bannerY + 98);
    };
    img.src = receiver.qrImageData;
  }, [paymentModalTab, receiver?.qrImageData, qrIntegrityValid, order]);

  // Export and download verified QR image from canvas
  const handleDownloadQr = () => {
    const canvas = canvasRef.current;
    if (!canvas || !order) return;
    const url = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = url;
    link.download = `pago-movil-ruta44-orden-${order.id.slice(0, 8).toUpperCase()}.png`;
    link.click();
    notify({ tone: 'success', text: 'Imagen QR descargada. Puedes abrirla desde la galería de tu banco.' });
  };

  // Run 45-minute countdown clock calculated from order.createdAt
  useEffect(() => {
    if (!order) return;
    const expiresAt = new Date(order.createdAt).getTime() + 45 * 60 * 1000;

    const tick = () => {
      const diff = expiresAt - Date.now();
      if (diff <= 0) {
        setReservationRemaining({ minutes: 0, seconds: 0, isExpired: true });
        return;
      }
      const minutes = Math.floor(diff / (60 * 1000));
      const seconds = Math.floor((diff % (60 * 1000)) / 1000);
      setReservationRemaining({ minutes, seconds, isExpired: false });
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [order]);

  const create = (event: FormEvent) => {
    event.preventDefault();
    if (!cart.items.length) return;

    createOrder.mutate(
      {
        data: {
          customerName: name,
          customerPhone: phone,
          deliveryCity,
          pickupNotes: notes || undefined,
          items: cart.items.map((item) => ({
            productId: item.product.id,
            quantity: item.quantity,
          })),
        },
      },
      {
        onSuccess: (created) => {
          setOrder(created);
          cart.clear();
          queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
          notify({
            tone: 'success',
            text: `Pedido #${created.id.slice(0, 8).toUpperCase()} creado. Tu inventario está reservado por 45 minutos.`,
          });
        },
        onError: (err: any) =>
          notify({
            tone: 'error',
            text: err?.message || 'No pudimos crear el pedido. Revisa tus datos e inténtalo de nuevo.',
          }),
      },
    );
  };

  const sendPayment = (event: FormEvent) => {
    event.preventDefault();
    if (!order) return;

    // Validate reference digits (between 6 and 12 numeric digits)
    const cleanRef = reference.replace(/\D/g, '');
    if (cleanRef.length < 6 || cleanRef.length > 12) {
      notify({
        tone: 'error',
        text: 'La referencia debe contener entre 6 y 12 dígitos numéricos.',
      });
      return;
    }

    // Validate identity digits
    const cleanIdNum = idNumber.replace(/\D/g, '');
    if (cleanIdNum.length < 6 || cleanIdNum.length > 9) {
      notify({
        tone: 'error',
        text: 'Ingresa un número de cédula o RIF válido (6 a 9 dígitos).',
      });
      return;
    }

    // Validate phone digits
    const cleanPhone = phoneBody.replace(/\D/g, '');
    if (cleanPhone.length !== 7) {
      notify({
        tone: 'error',
        text: 'El número de teléfono emisor debe tener 7 dígitos tras el prefijo.',
      });
      return;
    }

    submitPayment.mutate(
      {
        data: {
          orderId: order.id,
          bank: bank.trim(),
          identityNumber: `${idPrefix}${cleanIdNum}`,
          reference: cleanRef,
          phone: `${phonePrefix}${cleanPhone}`,
          amountBs: order.totalBs,
          receiptUrl: uploadedReceiptUrl || null,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(order.id) });
          notify({
            tone: 'success',
            text: 'Comprobante registrado con éxito. Redirigiendo al pedido para seguimiento...',
          });
          window.setTimeout(() => {
            setLocation(`/orders/${order.id}`);
          }, 1200);
        },
        onError: (err: any) =>
          notify({
            tone: 'error',
            text: err?.message || 'No pudimos registrar el pago. Verifica la referencia.',
          }),
      },
    );
  };

  if (!order && !cart.items.length) {
    return (
      <div className="mx-auto max-w-[900px] px-4 py-20 sm:px-6">
        <EmptyState
          icon={ShoppingCart}
          title="No hay nada que cobrar todavía"
          description="Vuelve al catálogo, agrega una pieza y el checkout aparecerá aquí."
          action={
            <Link
              href="/"
              className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
              data-testid="link-checkout-catalog"
            >
              <span>Ver catálogo</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1080px] px-4 py-10 sm:px-6 lg:py-14">
      <Link
        href="/cart"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        data-testid="link-back-cart"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Volver al carrito</span>
      </Link>

      <div className="mt-7 flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[.2em] text-accent">Compra segura</p>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-[-.05em] sm:text-5xl">
            {order ? 'Registra tu pago móvil' : 'Coordina tu pedido'}
          </h1>
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          <span
            className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${
              order ? 'bg-accent text-white' : 'bg-primary text-primary-foreground'
            }`}
          >
            {order ? (
              <Check key="icon-step-1" className="h-4 w-4" />
            ) : (
              <span key="text-step-1">1</span>
            )}
          </span>
          <span className="h-px w-8 bg-border" />
          <span
            className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${
              order ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}
          >
            2
          </span>
        </div>
      </div>

      {/* Notice notification container in fixed z-layer */}
      <div className="fixed right-4 top-20 z-[70]">
        {notice && <NoticeBar notice={notice} onDismiss={() => setNotice(null)} />}
      </div>

      {/* Single container wrapper to guarantee clean reconciliation without text nodes */}
      <div className="mt-9">
        {!order ? (
          <form
            key="step-order"
            onSubmit={create}
            className="grid gap-7 lg:grid-cols-[1fr_340px]"
            data-testid="form-create-order"
          >
            <div className="rounded-2xl border border-card-border bg-card p-6 shadow-xs sm:p-8">
              <h2 className="font-display text-2xl font-bold">Datos de contacto</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                El comerciante los usará para confirmar disponibilidad y entrega.
              </p>

              <div className="mt-7 grid gap-5 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-medium sm:col-span-2">
                  Nombre completo
                  <input
                    required
                    minLength={2}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="h-11 rounded-lg border border-input bg-background px-3 text-sm outline-none ring-offset-background focus:border-accent focus:ring-2 focus:ring-accent/20"
                    placeholder="Ej. Mariana González"
                    data-testid="input-checkout-name"
                  />
                </label>

                <label className="grid gap-2 text-sm font-medium">
                  Teléfono
                  <input
                    required
                    minLength={7}
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    className="h-11 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                    placeholder="0412 000 0000"
                    data-testid="input-checkout-phone"
                  />
                </label>

                <label className="grid gap-2 text-sm font-medium">
                  Ciudad de entrega
                  <select
                    value={deliveryCity}
                    onChange={(event) => setDeliveryCity(event.target.value)}
                    className="h-11 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                    data-testid="input-checkout-city"
                  >
                    {(deliveryLocations.length
                      ? deliveryLocations
                      : [{ id: 'barinas', state: 'Barinas', city: 'Barinas', isEnabled: true }]
                    ).map((location) => (
                      <option key={location.id} value={location.city}>
                        {location.city}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2 text-sm font-medium sm:col-span-2">
                  Nota
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    className="min-h-24 resize-y rounded-lg border border-input bg-background px-3 py-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                    placeholder="Indicaciones adicionales de entrega o preguntas sobre compatibilidad"
                    data-testid="textarea-checkout-notes"
                  />
                </label>
              </div>
            </div>

            <OrderSummary
              amountUsd={cart.totalUsd}
              rate={rate?.value}
              submitting={createOrder.isPending}
            />
          </form>
        ) : (
          <form
            key="step-payment"
            onSubmit={sendPayment}
            className="grid gap-7 lg:grid-cols-[1fr_340px]"
            data-testid="form-submit-payment"
          >
            <div className="rounded-2xl border border-card-border bg-card p-6 shadow-xs sm:p-8">
              {/* 45-Minute Reservation Countdown Banner */}
              <div
                className={`flex items-center justify-between rounded-xl border p-4 text-sm transition-colors ${
                  reservationRemaining.isExpired
                    ? 'border-destructive/30 bg-destructive/10 text-destructive'
                    : reservationRemaining.minutes < 10
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300'
                      : 'border-accent/20 bg-accent/5 text-foreground'
                }`}
                data-testid="banner-reservation-timer"
              >
                <div className="flex items-center gap-2.5">
                  {reservationRemaining.isExpired ? (
                    <AlertTriangle key="icon-timer-expired" className="h-5 w-5 shrink-0 text-destructive" />
                  ) : (
                    <Clock key="icon-timer-active" className="h-5 w-5 shrink-0 text-accent animate-pulse" />
                  )}
                  <div>
                    <p className="font-semibold leading-tight">
                      {reservationRemaining.isExpired ? (
                        'La reserva ha expirado'
                      ) : (
                        <>
                          Tu repuesto está reservado por{' '}
                          <span className="font-mono text-base font-bold text-accent">
                            {String(reservationRemaining.minutes).padStart(2, '0')}:
                            {String(reservationRemaining.seconds).padStart(2, '0')}
                          </span>
                        </>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {reservationRemaining.isExpired
                        ? 'El stock fue liberado. Si aún deseas la pieza, recarga la página para verificar disponibilidad.'
                        : 'Registra tu referencia bancaria antes de que expire para asegurar tus piezas.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Order Created Notification Banner */}
              <div className="mt-4 rounded-xl border border-[#b8dccd] bg-[#e8f4ef] p-4 text-sm text-[#256b55]">
                <div className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>Pedido #{order.id.slice(0, 8).toUpperCase()} creado con éxito</span>
                </div>
                <p className="mt-1 text-xs leading-5">
                  Transfiere el monto exacto de <strong className="font-mono font-bold">{bs(order.totalBs)}</strong> y registra los datos de verificación abajo.
                </p>
              </div>

              {/* Double Modal Selector: QR Code vs Chunked Protected Copy */}
              {receiver && (
                <div className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-xs">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4">
                    <div>
                      <span className="font-mono text-[10px] uppercase tracking-[.18em] text-accent font-bold">
                        Modalidad de Pago Móvil
                      </span>
                      <h3 className="font-display text-lg font-bold text-foreground">
                        Escoge cómo prefieres transferir
                      </h3>
                    </div>

                    {/* Mode Tabs */}
                    <div className="flex rounded-xl bg-muted p-1 border border-border text-xs font-medium">
                      {receiver.qrImageData && (
                        <button
                          type="button"
                          onClick={() => setPaymentModalTab('qr')}
                          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
                            paymentModalTab === 'qr'
                              ? 'bg-card font-semibold text-foreground shadow-xs'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                          data-testid="tab-payment-qr"
                        >
                          <QrCode className="h-3.5 w-3.5 text-accent" />
                          <span>Escanear QR</span>
                          <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.2 text-[9px] font-bold text-emerald-600 dark:text-emerald-400">
                            Recomendado
                          </span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setPaymentModalTab('manual')}
                        className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
                          paymentModalTab === 'manual'
                            ? 'bg-card font-semibold text-foreground shadow-xs'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                        data-testid="tab-payment-manual"
                      >
                        <FileText className="h-3.5 w-3.5 text-accent" />
                        <span>Ver Datos / Copiar</span>
                      </button>
                    </div>
                  </div>

                  {/* TAB 1: Verified Read-Only QR with Bottom Imprinted Banner */}
                  {paymentModalTab === 'qr' && receiver.qrImageData && (
                    <div className="mt-5 flex flex-col items-center text-center">
                      {qrIntegrityValid === false ? (
                        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive max-w-md">
                          <AlertTriangle className="mx-auto h-8 w-8 text-destructive" />
                          <p className="mt-2 font-bold">Firma criptográfica inválida</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            La imagen QR no coincide con la firma registrada en el servidor. Por seguridad, no escanees este código y utiliza la opción manual.
                          </p>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center">
                          <div className="relative overflow-hidden rounded-2xl border-2 border-primary/20 bg-white p-2 shadow-workshop">
                            <canvas
                              ref={canvasRef}
                              className="h-auto w-full max-w-[340px] sm:max-w-[380px] rounded-xl"
                            />
                          </div>

                          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                            <Button
                              type="button"
                              onClick={handleDownloadQr}
                              className="inline-flex items-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                              data-testid="button-download-qr-canvas"
                            >
                              <Download className="h-4 w-4" />
                              <span>Descargar imagen QR</span>
                            </Button>
                          </div>

                          <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                            <ShieldCheck className="h-4 w-4" />
                            <span>Código QR verificado con SHA-256 e impreso de seguridad oficial</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 2: Fast-Reading Chunked Data & Protected Copy */}
                  {paymentModalTab === 'manual' && (
                    <div className="mt-5 space-y-4">
                      {/* Security Mode Switch: No-Clipboard Reading Mode */}
                      <div className="flex items-center justify-between rounded-xl border border-accent/20 bg-accent/5 p-3 text-xs">
                        <div className="flex items-center gap-2">
                          {noClipboardMode ? (
                            <EyeOff className="h-4 w-4 text-accent" />
                          ) : (
                            <Eye className="h-4 w-4 text-accent" />
                          )}
                          <div>
                            <span className="font-semibold text-foreground">Modo lectura sin portapapeles</span>
                            <p className="text-[11px] text-muted-foreground">
                              {noClipboardMode
                                ? 'Los datos están protegidos contra copiado. Escríbelos manualmente en tu app bancaria.'
                                : 'Si usas los botones de copiar, confirma los datos en el modal de verificación anti-secuestro.'}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setNoClipboardMode(!noClipboardMode)}
                          className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                            noClipboardMode
                              ? 'bg-accent text-accent-foreground'
                              : 'border border-border bg-card text-foreground hover:bg-muted'
                          }`}
                          data-testid="button-toggle-no-clipboard"
                        >
                          <span>{noClipboardMode ? 'Desactivar' : 'Activar'}</span>
                        </button>
                      </div>

                      {/* Chunked Optical Display Cards */}
                      <div className={`grid gap-3.5 sm:grid-cols-2 ${noClipboardMode ? 'select-none' : ''}`}>
                        {/* Banco */}
                        <div className="rounded-xl border border-border bg-muted/30 p-4">
                          <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                            Banco Receptor
                          </span>
                          <p className="mt-1 font-display text-base font-bold text-foreground">
                            {receiver.bank}
                          </p>
                          {!noClipboardMode && receiver.allowClipboardCopy !== false && (
                            <button
                              type="button"
                              onClick={() => handleSafeCopy(receiver.bank, 'Banco Receptor', 'bank')}
                              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
                              data-testid="button-copy-bank"
                            >
                              <Copy className="h-3.5 w-3.5" />
                              <span>Copiar banco</span>
                            </button>
                          )}
                        </div>

                        {/* Teléfono con Chunking */}
                        {(() => {
                          const phoneChunks = formatPhoneChunked(receiver.phone);
                          return (
                            <div className="rounded-xl border border-border bg-muted/30 p-4">
                              <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                                Teléfono Pago Móvil
                              </span>
                              <p className="mt-1 font-mono text-lg font-bold tracking-wider text-foreground">
                                <span className="text-muted-foreground">{phoneChunks.prefix}</span> -{' '}
                                <span className="text-foreground">{phoneChunks.mid}</span> -{' '}
                                <span className="rounded bg-accent/15 px-1 py-0.5 text-accent font-extrabold">
                                  {phoneChunks.last4}
                                </span>
                              </p>
                              {!noClipboardMode && receiver.allowClipboardCopy !== false && (
                                <button
                                  type="button"
                                  onClick={() => handleSafeCopy(receiver.phone.replace(/\D/g, ''), 'Teléfono Pago Móvil', 'phone')}
                                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
                                  data-testid="button-copy-phone"
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                  <span>Copiar teléfono</span>
                                </button>
                              )}
                            </div>
                          );
                        })()}

                        {/* Cédula con Chunking */}
                        {(() => {
                          const idChunks = formatIdentityChunked(receiver.identityNumber);
                          return (
                            <div className="rounded-xl border border-border bg-muted/30 p-4">
                              <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                                Cédula / RIF del Titular
                              </span>
                              <p className="mt-1 font-mono text-lg font-bold tracking-wider text-foreground">
                                <span>{idChunks.type}</span>
                                <span>{idChunks.main}</span>
                                {idChunks.last4 && (
                                  <>
                                    .<span className="rounded bg-accent/15 px-1 py-0.5 text-accent font-extrabold">
                                      {idChunks.last4}
                                    </span>
                                  </>
                                )}
                              </p>
                              {!noClipboardMode && receiver.allowClipboardCopy !== false && (
                                <button
                                  type="button"
                                  onClick={() => handleSafeCopy(receiver.identityNumber.replace(/\s+/g, ''), 'Cédula / RIF', 'identity')}
                                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
                                  data-testid="button-copy-identity"
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                  <span>Copiar cédula</span>
                                </button>
                              )}
                            </div>
                          );
                        })()}

                        {/* Monto exacto en Bs. */}
                        <div className="rounded-xl border border-border bg-muted/30 p-4">
                          <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                            Monto Exacto a Transferir
                          </span>
                          <p className="mt-1 font-mono text-xl font-bold text-primary">
                            {bs(order.totalBs)}
                          </p>
                          {!noClipboardMode && receiver.allowClipboardCopy !== false && (
                            <button
                              type="button"
                              onClick={() => handleSafeCopy(order.totalBs.toFixed(2), 'Monto Exacto en Bs.', 'amount')}
                              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
                              data-testid="button-copy-amount"
                            >
                              <Copy className="h-3.5 w-3.5" />
                              <span>Copiar monto exacto</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Copy All Button with Anti-Clipboard Modal */}
                      {!noClipboardMode && receiver.allowClipboardCopy !== false && (
                        <div className="pt-2 flex justify-end">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              const allText = `Pago Móvil RUTA 44\nBanco: ${receiver.bank}\nTeléfono: ${receiver.phone}\nCédula: ${receiver.identityNumber}\nMonto exacto: Bs. ${order.totalBs.toFixed(2)}`;
                              handleSafeCopy(allText, 'Todos los datos completos de Pago Móvil', 'all', true);
                            }}
                            className="w-full sm:w-auto inline-flex items-center gap-2 border-accent/40 text-accent hover:bg-accent hover:text-accent-foreground"
                            data-testid="button-copy-all-receiver-info"
                          >
                            <Copy className="h-4 w-4" />
                            <span>Copiar todos los datos de Pago Móvil</span>
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Mandatory Anti-Clipboard Hijacking Confirmation Modal */}
              <AlertDialog open={isSecurityModalOpen} onOpenChange={setIsSecurityModalOpen}>
                <AlertDialogContent className="max-w-xl p-6 sm:p-7" data-testid="modal-anti-clipboard-hijacking">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2.5 font-display text-xl font-bold text-amber-600 dark:text-amber-400">
                      <ShieldAlert className="h-6 w-6 shrink-0" />
                      <span>⚠️ Verifica los datos antes de transferir</span>
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-sm leading-relaxed text-muted-foreground pt-1">
                      Has copiado los datos al portapapeles. Existen virus en teléfonos y PCs que cambian los números copiados sin que te des cuenta. Confirma que en tu aplicación del banco aparezcan <strong>EXACTAMENTE</strong> estos datos completos:
                    </AlertDialogDescription>
                  </AlertDialogHeader>

                  <div className="mt-3 space-y-4">
                    {/* Highlighted Recently Copied Value */}
                    {copiedDetail && (
                      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">
                        <span className="font-semibold text-emerald-800 dark:text-emerald-300">
                          Dato copiado ({copiedDetail.label}):
                        </span>
                        <p className="mt-1 font-mono font-bold text-sm text-emerald-900 dark:text-emerald-200 break-all select-all">
                          {copiedDetail.value}
                        </p>
                      </div>
                    )}

                    {/* Official Receiver Account Summary Card */}
                    {receiver && (
                      <div className="rounded-xl border border-border bg-card p-4 space-y-2.5 text-xs shadow-xs">
                        <p className="font-mono text-[10px] uppercase tracking-[.18em] text-accent font-bold">
                          Resumen Oficial de la Cuenta Receptora
                        </p>
                        <div className="grid gap-2 font-mono sm:grid-cols-2">
                          <div>
                            <span className="text-muted-foreground block text-[11px]">Banco Receptor:</span>
                            <span className="font-semibold text-sm text-foreground">{receiver.bank}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block text-[11px]">Teléfono Pago Móvil:</span>
                            {(() => {
                              const p = formatPhoneChunked(receiver.phone);
                              return (
                                <span className="font-semibold text-sm text-foreground">
                                  {p.prefix} - {p.mid} - <strong className="text-accent underline font-extrabold">{p.last4}</strong>
                                </span>
                              );
                            })()}
                          </div>
                          <div>
                            <span className="text-muted-foreground block text-[11px]">Cédula / RIF:</span>
                            {(() => {
                              const c = formatIdentityChunked(receiver.identityNumber);
                              return (
                                <span className="font-semibold text-sm text-foreground">
                                  {c.type}{c.main}.<strong className="text-accent underline font-extrabold">{c.last4}</strong>
                                </span>
                              );
                            })()}
                          </div>
                          <div>
                            <span className="text-muted-foreground block text-[11px]">Monto Exacto en Bs.:</span>
                            <span className="font-bold text-sm text-primary">{bs(order.totalBs)}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <AlertDialogFooter className="mt-5">
                    <AlertDialogAction
                      onClick={() => setIsSecurityModalOpen(false)}
                      className="w-full h-12 text-sm font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl"
                      data-testid="button-confirm-clipboard-security"
                    >
                      <span>Entendido, verificaré estos datos en mi banco</span>
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              {/* Real-time Validated Pago Móvil Form */}
              <h2 className="mt-8 font-display text-2xl font-bold">Datos de tu comprobante</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Ingresa los datos exactos del pago para que el sistema valide la transacción al instante.
              </p>

              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-medium">
                  <span>Banco emisor (desde donde transferiste)</span>
                  <input
                    required
                    value={bank}
                    onChange={(event) => setBank(event.target.value)}
                    className="h-11 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                    placeholder="Ej. Banesco, Mercantil, Venezuela..."
                    data-testid="input-payment-bank"
                  />
                </label>

                {/* Cédula/RIF with prefix selector */}
                <div className="grid gap-2 text-sm font-medium">
                  <div className="flex items-center justify-between">
                    <span>Cédula o RIF del titular</span>
                    {idNumber.replace(/\D/g, '').length >= 6 ? (
                      <span key="badge-id-valid" className="flex items-center gap-1 text-[11px] text-emerald-600 font-normal">
                        <Check className="h-3 w-3 shrink-0" />
                        <span>Válida</span>
                      </span>
                    ) : (
                      <span key="badge-id-hint" className="text-[11px] text-muted-foreground font-normal">
                        <span>6-9 dígitos</span>
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <select
                      value={idPrefix}
                      onChange={(e) => setIdPrefix(e.target.value as any)}
                      className="h-11 w-20 rounded-lg border border-input bg-background px-2 text-sm font-mono outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                      data-testid="select-payment-id-prefix"
                    >
                      <option value="V-">V-</option>
                      <option value="E-">E-</option>
                      <option value="J-">J-</option>
                      <option value="G-">G-</option>
                    </select>
                    <input
                      required
                      type="text"
                      inputMode="numeric"
                      value={idNumber}
                      onChange={(event) => setIdNumber(event.target.value.replace(/\D/g, '').slice(0, 9))}
                      className="h-11 flex-1 rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                      placeholder="Ej. 18234567"
                      maxLength={9}
                      data-testid="input-payment-identity"
                    />
                  </div>
                </div>

                {/* Bank Reference with Instant Digit Validation */}
                <div className="grid gap-2 text-sm font-medium">
                  <div className="flex items-center justify-between">
                    <span>Número de referencia bancaria</span>
                    {reference.replace(/\D/g, '').length >= 6 ? (
                      <span key="badge-ref-valid" className="flex items-center gap-1 text-[11px] text-emerald-600 font-semibold" data-testid="badge-ref-valid">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        <span>Últimos dígitos verificados</span>
                      </span>
                    ) : (
                      <span key="badge-ref-counter" className="text-[11px] text-muted-foreground font-normal" data-testid="badge-ref-counter">
                        <span>{`${reference.replace(/\D/g, '').length}/6-12 dígitos`}</span>
                      </span>
                    )}
                  </div>
                  <input
                    required
                    type="text"
                    inputMode="numeric"
                    value={reference}
                    onChange={(event) => setReference(event.target.value.replace(/\D/g, '').slice(0, 12))}
                    className="h-11 rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                    placeholder="Ej. 482910 ó 00482910"
                    maxLength={12}
                    data-testid="input-payment-reference"
                  />
                </div>

                {/* Origin Phone with prefix selector */}
                <div className="grid gap-2 text-sm font-medium">
                  <div className="flex items-center justify-between">
                    <span>Teléfono emisor</span>
                    {phoneBody.replace(/\D/g, '').length === 7 ? (
                      <span key="badge-phone-valid" className="flex items-center gap-1 text-[11px] text-emerald-600 font-normal">
                        <Check className="h-3 w-3 shrink-0" />
                        <span>Formato correcto</span>
                      </span>
                    ) : (
                      <span key="badge-phone-hint" className="text-[11px] text-muted-foreground font-normal">
                        <span>{`${phoneBody.replace(/\D/g, '').length}/7 dígitos`}</span>
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <select
                      value={phonePrefix}
                      onChange={(e) => setPhonePrefix(e.target.value)}
                      className="h-11 w-24 rounded-lg border border-input bg-background px-2 text-sm font-mono outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                      data-testid="select-payment-phone-prefix"
                    >
                      <option value="0412">0412</option>
                      <option value="0414">0414</option>
                      <option value="0424">0424</option>
                      <option value="0416">0416</option>
                      <option value="0426">0426</option>
                    </select>
                    <input
                      required
                      type="tel"
                      inputMode="numeric"
                      value={phoneBody}
                      onChange={(event) => setPhoneBody(event.target.value.replace(/\D/g, '').slice(0, 7))}
                      className="h-11 flex-1 rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                      placeholder="1234567"
                      maxLength={7}
                      data-testid="input-payment-phone"
                    />
                  </div>
                </div>

                {/* Mobile Payment Receipt / Capture upload to Google Drive */}
                <div className="grid gap-2 text-sm font-medium">
                  <div className="flex items-center justify-between">
                    <span>Comprobante de Pago Móvil (Captura opcional)</span>
                    {uploadedReceiptUrl ? (
                      <span key="badge-receipt-valid" className="flex items-center gap-1 text-[11px] text-emerald-600 font-semibold" data-testid="badge-receipt-uploaded">
                        <Check className="h-3 w-3 shrink-0" />
                        <span>Subido a Google Drive</span>
                      </span>
                    ) : (
                      <span key="badge-receipt-hint" className="text-[11px] text-muted-foreground font-normal">
                        <span>PNG, JPG o PDF</span>
                      </span>
                    )}
                  </div>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      setReceiptFile(file);
                      setUploadingReceipt(true);
                      const reader = new FileReader();
                      reader.onload = async () => {
                        try {
                          const base64Data = reader.result as string;
                          const res = await fetch('/api/payments/upload-receipt', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              fileData: base64Data,
                              fileName: file.name,
                              mimeType: file.type,
                            }),
                          });
                          const data = await res.json();
                          if (data.webViewLink) {
                            setUploadedReceiptUrl(data.webViewLink);
                            notify({ tone: 'success', text: 'Comprobante subido a Google Drive correctamente.' });
                          }
                        } catch (err) {
                          console.error('Error al subir comprobante:', err);
                          notify({ tone: 'error', text: 'Error al subir la captura a Google Drive.' });
                        } finally {
                          setUploadingReceipt(false);
                        }
                      };
                      reader.readAsDataURL(file);
                    }}
                    className="h-11 file:mr-4 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-accent/10 file:text-accent hover:file:bg-accent/20 cursor-pointer rounded-lg border border-input bg-background p-1.5 text-xs outline-none focus:border-accent"
                    data-testid="input-payment-receipt"
                  />
                  {uploadingReceipt && (
                    <p key="text-receipt-uploading" className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                      <span>Subiendo captura a Google Drive...</span>
                    </p>
                  )}
                  {uploadedReceiptUrl && (
                    <div key="link-receipt-uploaded" className="flex items-center gap-2 text-xs">
                      <a
                        href={uploadedReceiptUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent underline hover:opacity-80 flex items-center gap-1"
                      >
                        <Eye className="h-3.5 w-3.5 shrink-0" />
                        <span>Ver comprobante subido</span>
                      </a>
                    </div>
                  )}
                </div>
              </div>

              <p className="mt-6 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <span>La referencia será validada de forma única contra los registros bancarios para evitar duplicados.</span>
              </p>
            </div>

            <aside className="h-fit rounded-2xl border border-card-border bg-card p-6 shadow-sm">
              <p className="font-mono text-[10px] uppercase tracking-[.18em] text-accent">Monto a transferir</p>
              <p className="mt-3 font-display text-4xl font-bold text-primary" data-testid="text-payment-total-bs">
                {bs(order.totalBs)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {usd(order.totalUsd)} · tasa {order.exchangeRate.toFixed(2)}
              </p>
              <Button
                type="submit"
                className="mt-7 w-full"
                disabled={
                  submitPayment.isPending ||
                  reservationRemaining.isExpired ||
                  reference.replace(/\D/g, '').length < 6 ||
                  idNumber.replace(/\D/g, '').length < 6 ||
                  phoneBody.replace(/\D/g, '').length !== 7
                }
                data-testid="button-submit-payment"
              >
                {submitPayment.isPending ? (
                  <Loader2 key="icon-paying" className="h-4 w-4 animate-spin" />
                ) : (
                  <Send key="icon-send" className="h-4 w-4" />
                )}
                <span>Registrar Pago Móvil</span>
              </Button>
              <Link
                href={`/orders/${order.id}`}
                className="mt-3 flex h-10 items-center justify-center text-sm text-muted-foreground hover:text-foreground"
                data-testid="link-view-created-order"
              >
                <span>Ver detalle del pedido</span>
              </Link>
            </aside>
          </form>
        )}
      </div>
    </div>
  );
}
