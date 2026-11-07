/**
 * @file receipt-modal.tsx
 * Visual payment receipt capture viewer, thumbnail preview, and full-resolution lightbox modal.
 * Supports Base64 data URLs, Google Drive file URLs (with direct thumbnail extraction), and standard image links.
 */

import { useState } from 'react';
import { ExternalLink, Eye, FileText, Image as ImageIcon, Loader2, Maximize2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function getReceiptImageSrc(url?: string | null): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (trimmed.startsWith('data:image')) {
    return trimmed;
  }
  if (trimmed.includes('drive.google.com')) {
    const match = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/) || trimmed.match(/id=([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w1200`;
    }
  }
  return trimmed;
}

export function isGoogleDriveLink(url?: string | null): boolean {
  if (!url) return false;
  return url.includes('drive.google.com');
}

export interface ReceiptViewerProps {
  receiptUrl?: string | null;
  bank?: string;
  reference?: string;
  amountBs?: number;
  className?: string;
}

export function ReceiptViewer({
  receiptUrl,
  bank,
  reference,
  amountBs,
  className = '',
}: ReceiptViewerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [imgError, setImgError] = useState(false);

  if (!receiptUrl) {
    return (
      <div className={`rounded-xl border border-dashed border-border bg-muted/20 p-4 text-center text-xs text-muted-foreground ${className}`}>
        <p className="italic">El cliente no adjuntó captura de pantalla para este pago.</p>
      </div>
    );
  }

  const imageSrc = getReceiptImageSrc(receiptUrl);
  const isDrive = isGoogleDriveLink(receiptUrl);

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Visual Thumbnail Card */}
      <div className="group relative overflow-hidden rounded-xl border-2 border-accent/20 bg-card p-3 shadow-xs hover:border-accent/50 transition">
        <div className="flex flex-col sm:flex-row items-center gap-3.5">
          {/* Thumbnail box */}
          <div
            onClick={() => setIsOpen(true)}
            className="relative h-24 w-24 sm:h-28 sm:w-28 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-border bg-muted/40 shadow-2xs group-hover:shadow-sm transition"
          >
            {imageSrc && !imgError ? (
              <img
                src={imageSrc}
                alt="Comprobante de pago"
                onError={() => setImgError(true)}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                loading="lazy"
              />
            ) : (
              <div className="grid h-full w-full place-items-center p-2 text-center text-muted-foreground">
                <FileText className="h-6 w-6 text-accent opacity-80" />
                <span className="text-[10px] mt-1 font-mono">Ver archivo</span>
              </div>
            )}
            <div className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
              <Maximize2 className="h-5 w-5 text-white" />
            </div>
          </div>

          {/* Details & Action Buttons */}
          <div className="flex-1 min-w-0 text-center sm:text-left">
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-600 border border-emerald-500/20">
                <ImageIcon className="h-3 w-3" />
                Captura adjunta
              </span>
              {isDrive && (
                <span className="rounded-md bg-blue-500/10 px-2 py-0.5 font-mono text-[10px] text-blue-600 border border-blue-500/20">
                  Google Drive
                </span>
              )}
            </div>

            <p className="mt-1 font-semibold text-xs text-foreground">
              Comprobante de Pago Móvil
            </p>
            {reference && (
              <p className="font-mono text-[11px] text-muted-foreground">
                Ref: <span className="font-bold text-foreground">{reference}</span>
                {bank ? ` · ${bank}` : ''}
              </p>
            )}

            <div className="mt-2.5 flex flex-wrap items-center justify-center sm:justify-start gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setIsOpen(true)}
                className="h-7 text-xs font-semibold gap-1.5 border-accent/30 text-accent hover:bg-accent/10"
                data-testid="button-open-receipt-modal"
              >
                <Eye className="h-3.5 w-3.5" />
                <span>Ver imagen completa</span>
              </Button>

              <a
                href={receiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted transition"
                data-testid="button-open-receipt-external"
              >
                <span>{isDrive ? 'Abrir en Drive' : 'Abrir original'}</span>
                <ExternalLink className="h-3 w-3 opacity-70" />
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Enlarged Lightbox Modal */}
      <ReceiptLightboxDialog
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        receiptUrl={receiptUrl}
        reference={reference}
      />
    </div>
  );
}

export function ReceiptLightboxDialog({
  isOpen,
  onOpenChange,
  receiptUrl,
  reference,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  receiptUrl?: string | null;
  reference?: string;
}) {
  const [imgError, setImgError] = useState(false);
  if (!receiptUrl) return null;

  const imageSrc = getReceiptImageSrc(receiptUrl);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[700px] p-0 overflow-hidden border-border bg-card">
        <DialogHeader className="p-4 border-b border-border bg-muted/20">
          <DialogTitle className="text-sm font-bold flex items-center justify-between">
            <span>Captura de Pago Móvil {reference ? `(Ref: ${reference})` : ''}</span>
            <a
              href={receiptUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-accent hover:underline font-normal"
            >
              <span>Abrir en pestaña completa</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Verifica los datos bancarios, hora, monto acreditado y número de referencia antes de confirmar.
          </DialogDescription>
        </DialogHeader>

        <div className="relative max-h-[75vh] overflow-auto bg-black/5 dark:bg-black/40 p-4 flex items-center justify-center">
          {imageSrc && !imgError ? (
            <img
              src={imageSrc}
              alt="Comprobante de pago móvil ampliado"
              onError={() => setImgError(true)}
              className="max-h-[70vh] w-auto rounded-lg object-contain shadow-md"
            />
          ) : (
            <div className="py-12 text-center space-y-3">
              <FileText className="mx-auto h-12 w-12 text-accent opacity-70" />
              <p className="text-xs text-muted-foreground">
                El comprobante está disponible. Puedes abrirlo directamente con el botón:
              </p>
              <Button
                type="button"
                size="sm"
                onClick={() => window.open(receiptUrl, '_blank')}
                className="bg-accent hover:bg-accent/90 text-white"
              >
                <ExternalLink className="h-4 w-4 mr-1.5" />
                Abrir captura en Google Drive
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ReceiptThumbnailButton({
  receiptUrl,
  reference,
  bank,
}: {
  receiptUrl?: string | null;
  reference?: string;
  bank?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [imgError, setImgError] = useState(false);

  if (!receiptUrl) {
    return <span className="text-xs text-muted-foreground italic">Sin captura</span>;
  }

  const imageSrc = getReceiptImageSrc(receiptUrl);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="group relative inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent hover:bg-accent/20 transition cursor-pointer"
        title="Clic para ver comprobante"
        data-testid={`btn-open-receipt-thumb-${reference || 'item'}`}
      >
        {imageSrc && !imgError ? (
          <img
            src={imageSrc}
            alt="Miniatura"
            onError={() => setImgError(true)}
            className="h-4 w-4 rounded object-cover border border-accent/30"
          />
        ) : (
          <ImageIcon className="h-3.5 w-3.5" />
        )}
        <span>Ver captura</span>
        <Eye className="h-3 w-3 opacity-70 group-hover:scale-110 transition-transform" />
      </button>

      <ReceiptLightboxDialog
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        receiptUrl={receiptUrl}
        reference={reference}
      />
    </>
  );
}
