/**
 * @file app-frame.tsx
 * Top-level application layout frame wrapping header, content area, footer, and notice alerts.
 */

import type { ReactNode } from 'react';
import { Phone } from 'lucide-react';
import { AppHeader } from '@/components/layout/app-header';
import { AppFooter } from '@/components/layout/app-footer';
import { NoticeBar, useNotice } from '@/components/shared/notice-bar';

export interface AppFrameProps {
  children: ReactNode;
}

export function AppFrame({ children }: AppFrameProps) {
  const { notice } = useNotice();

  return (
    <div className="min-h-[100dvh]">
      <AppHeader />
      <main className="route-enter">{children}</main>
      <AppFooter />
      <NoticeBar notice={notice} />

      {/* Botón flotante permanente de WhatsApp */}
      <a
        href="https://wa.me/qr/VALY6ZX5YZLKE1"
        target="_blank"
        rel="noreferrer"
        aria-label="Atención por WhatsApp"
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-[#25D366] px-4 py-2.5 font-semibold text-white shadow-lg transition-transform hover:scale-105 active:scale-95 hover:bg-[#1ebe5d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366] focus-visible:ring-offset-2"
        data-testid="link-floating-whatsapp"
      >
        <Phone className="h-4 w-4" />
        <span className="text-xs font-bold">WhatsApp</span>
      </a>
    </div>
  );
}
