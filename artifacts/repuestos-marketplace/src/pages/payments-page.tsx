/**
 * Payments administration page for tracking mobile payments and status review.
 */
import { useState } from 'react';
import { useListPayments } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Check,
  ChevronRight,
  CreditCard,
  ExternalLink,
  FileText,
  Loader2,
  X,
} from 'lucide-react';
import { Link } from 'wouter';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorState } from '@/components/shared/error-state';
import { ReceiptThumbnailButton } from '@/components/shared/receipt-modal';
import { bs, dateLabel, statusClass, statusLabel } from '@/lib/formatters';

export default function PaymentsPage() {
  const query = useListPayments({ page: 1, pageSize: 40 });
  const client = useQueryClient();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const payments = query.data?.items ?? [];

  const handleConfirmPayment = async (paymentId: string) => {
    if (!window.confirm('¿Confirmas que verificaste el abono de este pago en tu banco? Al confirmar, el pedido se marcará como PAGADO.')) {
      return;
    }
    setProcessingId(paymentId);
    try {
      const res = await fetch(`/api/payments/${paymentId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al confirmar pago');
      query.refetch();
      client.invalidateQueries();
    } catch (err: any) {
      alert(err.message || 'Error al confirmar pago');
    } finally {
      setProcessingId(null);
    }
  };

  const handleRejectPayment = async (paymentId: string) => {
    if (!window.confirm('¿Seguro que deseas rechazar este pago?')) return;
    setProcessingId(paymentId);
    try {
      const res = await fetch(`/api/payments/${paymentId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al rechazar pago');
      query.refetch();
      client.invalidateQueries();
    } catch (err: any) {
      alert(err.message || 'Error al rechazar pago');
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-[1250px] px-4 py-10 sm:px-6 lg:px-10 lg:py-14">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[.2em] text-accent">
            Administración
          </p>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-[-.05em]">
            Pagos móviles
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Verifica depósitos bancarios y confirma los pedidos de tus clientes.
          </p>
        </div>
        <div className="hidden rounded-xl border border-border bg-card px-4 py-3 text-right sm:block">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Por verificar
          </p>
          <p className="font-display text-2xl font-bold text-amber-600">
            {payments.filter((payment) => payment.status === 'pending').length}
          </p>
        </div>
      </div>

      <div className="mt-9 overflow-hidden rounded-2xl border border-card-border bg-card shadow-xs">
        {query.isLoading ? (
          <div className="space-y-3 p-6">
            <div className="h-10 animate-pulse rounded bg-muted" />
            <div className="h-10 animate-pulse rounded bg-muted" />
          </div>
        ) : query.isError ? (
          <div className="p-6">
            <ErrorState retry={() => query.refetch()} />
          </div>
        ) : payments.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={CreditCard}
              title="Sin pagos por revisar"
              description="Los pagos móviles enviados por tus clientes aparecerán aquí."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="border-b border-border bg-muted/60 font-mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">
                <tr>
                  <th className="px-5 py-4">Pedido</th>
                  <th className="px-5 py-4">Banco / referencia</th>
                  <th className="px-5 py-4">Cliente</th>
                  <th className="px-5 py-4">Monto</th>
                  <th className="px-5 py-4">Estado</th>
                  <th className="px-5 py-4">Comprobante</th>
                  <th className="px-5 py-4">Fecha</th>
                  <th className="px-5 py-4">Acción</th>
                  <th className="px-5 py-4 text-right">Ver</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {payments.map((payment) => (
                  <tr
                    key={payment.id}
                    className="hover:bg-muted/30"
                    data-testid={`row-payment-${payment.id}`}
                  >
                    <td className="px-5 py-4 font-mono text-xs font-bold">
                      #{payment.orderId.slice(0, 8).toUpperCase()}
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-medium">{payment.bank}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        Ref: {payment.reference}
                      </p>
                    </td>
                    <td className="px-5 py-4">
                      <p>{payment.phone}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {payment.identityNumber}
                      </p>
                    </td>
                    <td className="px-5 py-4 font-mono font-bold">
                      {bs(payment.amountBs)}
                    </td>
                    <td className="px-5 py-4">
                      <Badge
                        className={`border text-[10px] font-medium ${statusClass(payment.status)}`}
                      >
                        {statusLabel(payment.status)}
                      </Badge>
                    </td>
                    <td className="px-5 py-4">
                      <ReceiptThumbnailButton
                        receiptUrl={payment.receiptUrl}
                        reference={payment.reference}
                        bank={payment.bank}
                      />
                    </td>
                    <td className="px-5 py-4 text-xs text-muted-foreground">
                      {dateLabel(payment.createdAt)}
                    </td>
                    <td className="px-5 py-4">
                      {payment.status === 'pending' ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={processingId === payment.id}
                            onClick={() => handleConfirmPayment(payment.id)}
                            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 hover:bg-emerald-700 px-2.5 py-1 text-xs font-bold text-white transition disabled:opacity-50"
                            title="Confirmar y aprobar pago"
                            data-testid={`btn-confirm-payment-${payment.id}`}
                          >
                            {processingId === payment.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Check className="h-3 w-3" />
                            )}
                            <span>Confirmar</span>
                          </button>
                          <button
                            type="button"
                            disabled={processingId === payment.id}
                            onClick={() => handleRejectPayment(payment.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-destructive/40 text-destructive hover:bg-destructive/10 px-2 py-1 text-xs font-semibold transition disabled:opacity-50"
                            title="Rechazar pago"
                            data-testid={`btn-reject-payment-${payment.id}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : payment.status === 'approved' ? (
                        <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                          <Check className="h-3 w-3" /> Confirmado
                        </span>
                      ) : (
                        <span className="text-xs text-destructive font-semibold">
                          ✕ Rechazado
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Link
                        href={`/orders/${payment.orderId}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label="Ver pedido asociado"
                        data-testid={`link-payment-order-${payment.id}`}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
