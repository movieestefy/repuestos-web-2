/**
 * Settings page for account info, daily exchange rate, payment receivers, delivery locations, and user role management.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useLocation } from 'wouter';
import { useClerk } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetCurrentUserQueryKey,
  getGetDashboardSummaryQueryKey,
  getGetPaymentReceiverQueryKey,
  getGetTodayRateQueryKey,
  getListAdminUsersQueryKey,
  getListDeliveryLocationsQueryKey,
  useCreateDeliveryLocation,
  useCreateExchangeRate,
  useGetCurrentUser,
  useGetPaymentReceiver,
  useGetTodayRate,
  useListAdminUsers,
  useListDeliveryLocations,
  useUpdatePaymentReceiver,
  useUpdateUserRole,
  type AdminUser,
} from '@workspace/api-client-react';
import {
  Building2,
  Check,
  CircleDollarSign,
  Clock,
  CreditCard,
  Eye,
  Loader2,
  LockKeyhole,
  LogIn,
  LogOut,
  MapPin,
  Phone,
  Plus,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Truck,
  Upload,
  UserCheck,
  UserCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NoticeBar, type Notice } from '@/components/shared/notice-bar';
import { dateLabel } from '@/lib/formatters';

export default function SettingsPage() {
  const { signOut, openUserProfile } = useClerk();
  const [, setLocation] = useLocation();
  const { data: user } = useGetCurrentUser({
    query: { queryKey: getGetCurrentUserQueryKey(), retry: false },
  });
  const { data: rate, isLoading, isError, refetch } = useGetTodayRate({
    query: { queryKey: getGetTodayRateQueryKey() },
  });
  const { data: receiver } = useGetPaymentReceiver({
    query: { queryKey: getGetPaymentReceiverQueryKey(), retry: false },
  });
  const { data: locations = [] } = useListDeliveryLocations({
    query: { queryKey: getListDeliveryLocationsQueryKey(), staleTime: 5 * 60 * 1000 },
  });
  const usersQuery = useListAdminUsers({
    query: {
      queryKey: getListAdminUsersQueryKey(),
      enabled: Boolean(user?.isMaster),
      retry: false,
    },
  });

  const createRate = useCreateExchangeRate();
  const updateReceiver = useUpdatePaymentReceiver();
  const createLocation = useCreateDeliveryLocation();
  const updateRole = useUpdateUserRole();
  const client = useQueryClient();

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (err) {
      console.error('Error signing out:', err);
    }
    client.clear();
    setLocation('/');
  };

  const [value, setValue] = useState('');
  const [bank, setBank] = useState('');
  const [receiverPhone, setReceiverPhone] = useState('');
  const [receiverIdentity, setReceiverIdentity] = useState('');
  const [qrData, setQrData] = useState<string | null>(null);
  const [qrHash, setQrHash] = useState<string | null>(null);
  const [allowCopy, setAllowCopy] = useState<boolean>(true);
  const [processingQr, setProcessingQr] = useState<boolean>(false);
  const [state, setState] = useState('Barinas');
  const [city, setCity] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);

  // Merchant Profile state
  const [businessName, setBusinessName] = useState('');
  const [rif, setRif] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [address, setAddress] = useState('');
  const [businessHours, setBusinessHours] = useState('');
  const [hasDelivery, setHasDelivery] = useState<boolean>(false);
  const [savingProfile, setSavingProfile] = useState<boolean>(false);
  const [loadingProfile, setLoadingProfile] = useState<boolean>(false);

  useEffect(() => {
    if (user?.role === 'merchant') {
      setLoadingProfile(true);
      fetch('/api/merchant/profile')
        .then((res) => res.json())
        .then((data) => {
          if (data && !data.error) {
            setBusinessName(data.businessName || '');
            setRif(data.rif || '');
            setContactPhone(data.contactPhone || '');
            setAddress(data.address || '');
            setBusinessHours(data.businessHours || '');
            setHasDelivery(Boolean(data.hasDelivery));
          }
        })
        .catch(console.error)
        .finally(() => setLoadingProfile(false));
    }
  }, [user]);

  const saveMerchantProfile = async (event: FormEvent) => {
    event.preventDefault();
    setSavingProfile(true);
    try {
      const res = await fetch('/api/merchant/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName,
          rif,
          contactPhone,
          address,
          businessHours,
          hasDelivery,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setNotice({
          tone: 'success',
          text: 'Perfil de tienda y datos fiscales guardados con éxito.',
        });
      } else {
        setNotice({
          tone: 'error',
          text: data.error || 'No se pudo guardar el perfil comercial.',
        });
      }
    } catch {
      setNotice({
        tone: 'error',
        text: 'Error de conexión al guardar el perfil comercial.',
      });
    } finally {
      setSavingProfile(false);
    }
  };

  useEffect(() => {
    if (receiver) {
      setBank(receiver.bank);
      setReceiverPhone(receiver.phone);
      setReceiverIdentity(receiver.identityNumber);
      setQrData(receiver.qrImageData ?? null);
      setQrHash(receiver.qrSha256 ?? null);
      setAllowCopy(receiver.allowClipboardCopy ?? true);
    }
  }, [receiver]);

  // Compute SHA-256 hash using native Web Crypto API
  const computeSha256 = async (buffer: ArrayBuffer): Promise<string> => {
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  };

  const handleQrUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setNotice({ tone: 'error', text: 'El archivo seleccionado debe ser una imagen válida (PNG, JPG, WebP).' });
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setNotice({ tone: 'error', text: 'La imagen del QR no debe exceder 2MB.' });
      return;
    }

    setProcessingQr(true);
    try {
      const buffer = await file.arrayBuffer();
      const sha256 = await computeSha256(buffer);

      // Read as Data URL
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        setQrData(dataUrl);
        setQrHash(sha256);
        setProcessingQr(false);
        setNotice({
          tone: 'success',
          text: `QR cargado y verificado con SHA-256 (${sha256.slice(0, 12)}...)`,
        });
      };
      reader.onerror = () => {
        setProcessingQr(false);
        setNotice({ tone: 'error', text: 'Error al procesar la imagen del QR.' });
      };
      reader.readAsDataURL(file);
    } catch {
      setProcessingQr(false);
      setNotice({ tone: 'error', text: 'No se pudo calcular la firma SHA-256 del archivo.' });
    }
  };

  const removeQr = () => {
    setQrData(null);
    setQrHash(null);
  };

  const saveRate = (event: FormEvent) => {
    event.preventDefault();
    createRate.mutate(
      { data: { value: Number(value), currency: 'USD' } },
      {
        onSuccess: (created) => {
          client.setQueryData(getGetTodayRateQueryKey(), created);
          client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          setValue('');
          setNotice({
            tone: 'success',
            text: `Tasa actualizada a ${created.value.toFixed(2)} Bs. por USD.`,
          });
        },
        onError: () =>
          setNotice({
            tone: 'error',
            text: 'No se pudo actualizar la tasa. Verifica el valor.',
          }),
      },
    );
  };

  const saveReceiver = (event: FormEvent) => {
    event.preventDefault();
    updateReceiver.mutate(
      {
        data: {
          bank,
          phone: receiverPhone,
          identityNumber: receiverIdentity,
          qrImageData: qrData,
          qrSha256: qrHash,
          allowClipboardCopy: allowCopy,
        },
      },
      {
        onSuccess: (updated) => {
          client.setQueryData(getGetPaymentReceiverQueryKey(), updated);
          setNotice({ tone: 'success', text: 'Datos receptores y configuración QR actualizados.' });
        },
        onError: () =>
          setNotice({
            tone: 'error',
            text: 'No se pudieron guardar los datos de pago.',
          }),
      },
    );
  };

  const addLocation = (event: FormEvent) => {
    event.preventDefault();
    createLocation.mutate(
      { data: { state, city, isEnabled: true } },
      {
        onSuccess: () => {
          setCity('');
          client.invalidateQueries({ queryKey: getListDeliveryLocationsQueryKey() });
          setNotice({ tone: 'success', text: 'Ciudad habilitada para entregas.' });
        },
        onError: () =>
          setNotice({ tone: 'error', text: 'No se pudo habilitar esa ciudad.' }),
      },
    );
  };

  const changeRole = (target: AdminUser, role: AdminUser['role']) => {
    if (target.isMaster) return;
    updateRole.mutate(
      { userId: target.id, data: { role, merchantId: null } },
      {
        onSuccess: () => {
          client.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
          setNotice({
            tone: 'success',
            text: `Rol actualizado para ${target.name}.`,
          });
        },
        onError: () =>
          setNotice({ tone: 'error', text: 'No se pudo actualizar el rol.' }),
      },
    );
  };

  return (
    <div className="mx-auto max-w-[1000px] px-4 py-10 sm:px-6 lg:py-14">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[.2em] text-accent">
          Cuenta y operación
        </p>
        <h1 className="mt-2 font-display text-4xl font-bold tracking-[-.05em]">
          Ajustes
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          La información que mantiene el marketplace en hora.
        </p>
      </div>

      {notice && (
        <div className="mt-5">
          <NoticeBar notice={notice} onDismiss={() => setNotice(null)} />
        </div>
      )}

      <div className="mt-9 grid gap-7 lg:grid-cols-[1fr_330px]">
        <section className="rounded-2xl border border-card-border bg-card p-6 shadow-xs sm:p-8">
          <div className="flex items-start gap-4">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-muted text-accent">
              <UserCircle className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-display text-2xl font-bold">Tu cuenta</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Identidad y permisos dentro de Ruta 44.
              </p>
            </div>
          </div>
          <div className="mt-7 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-background p-4">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Nombre
              </p>
              <p className="mt-2 font-medium" data-testid="text-settings-name">
                {user?.name ?? 'No disponible'}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-background p-4">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Correo
              </p>
              <p
                className="mt-2 truncate font-medium"
                data-testid="text-settings-email"
              >
                {user?.email ?? 'No disponible'}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-background p-4 sm:col-span-2">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Rol
              </p>
              <p className="mt-2 flex items-center gap-2 font-medium capitalize">
                <ShieldCheck className="h-4 w-4 text-accent" />
                {user?.isMaster ? 'Admin Master' : user?.role ?? 'Cliente'}
              </p>
            </div>

            <div className="mt-2 flex flex-wrap gap-3 pt-5 border-t border-border sm:col-span-2">
              {user ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openUserProfile?.()}
                    className="gap-2"
                    data-testid="button-settings-clerk-profile"
                  >
                    <UserCheck className="h-4 w-4 text-accent" />
                    <span>Ajustes del perfil y seguridad</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleSignOut}
                    className="gap-2 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    data-testid="button-settings-logout"
                  >
                    <LogOut className="h-4 w-4" />
                    <span>Cerrar sesión</span>
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  onClick={() => setLocation('/sign-in')}
                  className="gap-2"
                  data-testid="button-settings-login"
                >
                  <LogIn className="h-4 w-4" />
                  <span>Iniciar sesión</span>
                </Button>
              )}
            </div>
          </div>
        </section>

        <section className="h-fit rounded-2xl border border-card-border bg-card p-6 shadow-xs sm:p-7">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[.18em] text-accent">
                Tasa del día
              </p>
              <h2 className="mt-2 font-display text-3xl font-bold">
                {isLoading ? '—' : rate ? `${Number(rate.value).toFixed(2)} Bs.` : 'Sin tasa'}
              </h2>
            </div>
            <CircleDollarSign className="h-8 w-8 text-secondary" />
          </div>
          {isError ? (
            <div className="mt-5">
              <p className="text-sm text-muted-foreground">
                No pudimos cargar la tasa.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => refetch()}
                data-testid="button-retry-rate"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Reintentar
              </Button>
            </div>
          ) : (
            <>
              <p className="mt-2 text-xs text-muted-foreground">
                Última actualización:{' '}
                {rate ? dateLabel(rate.effectiveDate) : 'pendiente'}
              </p>
              {user?.isMaster ? (
                <form
                  onSubmit={saveRate}
                  className="mt-6 space-y-3"
                  data-testid="form-exchange-rate"
                >
                  <label className="grid gap-1.5 text-sm font-medium">
                    Nueva tasa USD / Bs.
                    <input
                      required
                      min="0.01"
                      step="0.01"
                      type="number"
                      value={value}
                      onChange={(event) => setValue(event.target.value)}
                      placeholder={rate?.value != null ? Number(rate.value).toFixed(2) : '36.50'}
                      className="h-11 rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-accent"
                      data-testid="input-exchange-rate"
                    />
                  </label>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={createRate.isPending}
                    data-testid="button-save-rate"
                  >
                    {createRate.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    Actualizar tasa
                  </Button>
                </form>
              ) : (
                <div className="mt-5 rounded-xl border border-border bg-muted/40 p-4 text-xs text-muted-foreground">
                  <p className="flex items-center gap-1.5 font-medium text-foreground">
                    <LockKeyhole className="h-3.5 w-3.5 text-accent" />
                    Solo lectura
                  </p>
                  <p className="mt-1 leading-relaxed">
                    Solo el Admin Master puede configurar la tasa oficial del día. Los comerciantes no pueden alterarla.
                  </p>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* Merchant Profile Form (Visible for merchants) */}
      {user?.role === 'merchant' && (
        <section className="mt-7 rounded-2xl border border-card-border bg-card p-6 shadow-xs sm:p-8" data-testid="section-merchant-profile">
          <div className="flex items-start gap-4">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent/10 text-accent">
              <Building2 className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-display text-2xl font-bold">Perfil del Comercio / Tienda</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Configura los datos fiscales y de atención al público de tu venta de repuestos.
              </p>
            </div>
          </div>

          <form onSubmit={saveMerchantProfile} className="mt-7 grid gap-5 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">
              <span>Nombre Comercial / Razón Social *</span>
              <input
                required
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="Ej. Moto Repuestos El Ávila C.A."
                className="h-11 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent"
                data-testid="input-merchant-business-name"
              />
            </label>

            <label className="grid gap-1.5 text-sm font-medium">
              <span>RIF Fiscal *</span>
              <input
                required
                type="text"
                value={rif}
                onChange={(e) => setRif(e.target.value)}
                placeholder="Ej. J-40123456-7 ó V-18234567-0"
                className="h-11 rounded-lg border border-input bg-background px-3 text-sm font-mono outline-none focus:border-accent"
                data-testid="input-merchant-rif"
              />
            </label>

            <label className="grid gap-1.5 text-sm font-medium">
              <span>Teléfono de Contacto / WhatsApp *</span>
              <input
                required
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="Ej. 0414-1234567"
                className="h-11 rounded-lg border border-input bg-background px-3 text-sm font-mono outline-none focus:border-accent"
                data-testid="input-merchant-phone"
              />
            </label>

            <label className="grid gap-1.5 text-sm font-medium">
              <span>Horario de Atención</span>
              <input
                type="text"
                value={businessHours}
                onChange={(e) => setBusinessHours(e.target.value)}
                placeholder="Ej. 8:00 AM - 5:00 PM (Lunes a Sábado)"
                className="h-11 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent"
                data-testid="input-merchant-hours"
              />
            </label>

            <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
              <span>Dirección Física de la Tienda *</span>
              <textarea
                required
                rows={2}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Ej. Av. 23 de Enero, Edif. Los Andes, Local 2, Barinas"
                className="rounded-lg border border-input bg-background p-3 text-sm outline-none focus:border-accent"
                data-testid="input-merchant-address"
              />
            </label>

            <div className="flex items-center gap-3 sm:col-span-2 rounded-xl border border-border bg-muted/20 p-4">
              <input
                id="hasDelivery"
                type="checkbox"
                checked={hasDelivery}
                onChange={(e) => setHasDelivery(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent"
                data-testid="checkbox-merchant-delivery"
              />
              <label htmlFor="hasDelivery" className="cursor-pointer text-sm font-medium flex items-center gap-2">
                <Truck className="h-4 w-4 text-accent" />
                <span>¿Ofreces servicio de entrega a domicilio / Delivery en tu zona?</span>
              </label>
            </div>

            <div className="sm:col-span-2">
              <Button
                type="submit"
                disabled={savingProfile}
                data-testid="button-save-merchant-profile"
              >
                {savingProfile ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                <span>Guardar datos de la tienda</span>
              </Button>
            </div>
          </form>
        </section>
      )}

      <section className="mt-7 rounded-2xl border border-[#d7dcbf] bg-[#f0f3df] p-6 sm:p-7">
        <div className="flex gap-4">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
            <LockKeyhole className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-xl font-bold">
              Una nota sobre la conversión
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-primary/70">
              Los precios se publican en USD para facilitar la comparación. El
              equivalente en bolívares se calcula con la tasa vigente al momento de
              crear el pedido.
            </p>
          </div>
        </div>
      </section>

      {user?.isMaster && (
        <div className="mt-7 space-y-7">
          <section className="rounded-2xl border border-card-border bg-card p-6 shadow-xs sm:p-8">
            <div className="flex items-start gap-4">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#e8f4ef] text-[#256b55]">
                <CreditCard className="h-5 w-5" />
              </span>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[.18em] text-accent">
                  Admin Master
                </p>
                <h2 className="font-display text-2xl font-bold">
                  Datos receptores de pago
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Estos datos se muestran al cliente después de crear su pedido.
                </p>
              </div>
            </div>
            <form
              onSubmit={saveReceiver}
              className="mt-6 space-y-6"
              data-testid="form-payment-receiver"
            >
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="grid gap-1.5 text-sm font-medium">
                  Banco
                  <input
                    required
                    value={bank}
                    onChange={(event) => setBank(event.target.value)}
                    className="h-11 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent"
                    data-testid="input-receiver-bank"
                  />
                </label>
                <label className="grid gap-1.5 text-sm font-medium">
                  Teléfono
                  <input
                    required
                    value={receiverPhone}
                    onChange={(event) => setReceiverPhone(event.target.value)}
                    className="h-11 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent"
                    data-testid="input-receiver-phone"
                  />
                </label>
                <label className="grid gap-1.5 text-sm font-medium">
                  Cédula / RIF
                  <input
                    required
                    value={receiverIdentity}
                    onChange={(event) => setReceiverIdentity(event.target.value)}
                    className="h-11 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent"
                    data-testid="input-receiver-identity"
                  />
                </label>
              </div>

              {/* QR Code Upload & SHA-256 Verification Section */}
              <div className="rounded-xl border border-border bg-muted/30 p-5">
                <div className="flex items-center gap-2">
                  <QrCode className="h-4 w-4 text-accent" />
                  <h3 className="text-sm font-bold text-foreground">Código QR Oficial de Pago Móvil</h3>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Sube el comprobante o código QR generado por tu banco. Se generará una firma SHA-256 única para verificar su integridad en el navegador del cliente.
                </p>

                <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-start">
                  {qrData ? (
                    <div className="relative flex flex-col items-center rounded-xl border border-border bg-card p-3 shadow-xs">
                      <img
                        src={qrData}
                        alt="QR Pago Móvil"
                        className="h-36 w-36 object-contain rounded-lg"
                      />
                      <button
                        type="button"
                        onClick={removeQr}
                        className="mt-2.5 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 transition"
                        data-testid="button-remove-qr"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Eliminar QR</span>
                      </button>
                    </div>
                  ) : (
                    <label
                      onPaste={(e) => {
                        e.preventDefault();
                        setNotice({ tone: 'error', text: 'Por seguridad, el pegado directo desde portapapeles está bloqueado. Selecciona el archivo manualmente.' });
                      }}
                      className="flex h-36 w-36 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-card p-3 text-center transition hover:border-accent hover:bg-accent/5"
                    >
                      {processingQr ? (
                        <Loader2 className="h-6 w-6 animate-spin text-accent" />
                      ) : (
                        <Upload className="h-6 w-6 text-muted-foreground" />
                      )}
                      <span className="mt-2 text-xs font-medium text-muted-foreground">
                        {processingQr ? 'Calculando firma...' : 'Subir imagen QR'}
                      </span>
                      <input
                        type="file"
                        accept="image/png, image/jpeg, image/webp"
                        onChange={handleQrUpload}
                        className="hidden"
                        data-testid="input-qr-file"
                      />
                    </label>
                  )}

                  <div className="flex-1 space-y-3">
                    {qrHash ? (
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300">
                        <div className="flex items-center gap-1.5 font-semibold">
                          <ShieldCheck className="h-4 w-4" />
                          <span>Firma criptográfica SHA-256 verificada:</span>
                        </div>
                        <p className="mt-1 font-mono text-[11px] break-all select-all">
                          {qrHash}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">
                        No hay código QR cargado. Se mostrarán únicamente los datos en formato texto al cliente.
                      </p>
                    )}

                    {/* Toggle: Allow Clipboard Copying on Checkout */}
                    <div className="pt-2">
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allowCopy}
                          onChange={(e) => setAllowCopy(e.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded border-input text-accent focus:ring-accent"
                          data-testid="checkbox-allow-clipboard"
                        />
                        <div>
                          <span className="text-xs font-semibold text-foreground">
                            Habilitar botones de copiado manual en el checkout
                          </span>
                          <p className="text-[11px] text-muted-foreground">
                            Si está activo, los clientes pueden copiar al portapapeles mediante el modal de confirmación anti-secuestro. Si está desactivado, el cliente solo verá los datos en modo lectura visual y escaneo QR.
                          </p>
                        </div>
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full sm:w-fit"
                disabled={updateReceiver.isPending || processingQr}
              >
                {updateReceiver.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                <span>Guardar configuración de pago</span>
              </Button>
            </form>
          </section>

          <section className="rounded-2xl border border-card-border bg-card p-6 shadow-xs sm:p-8">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[.18em] text-accent">
                Cobertura
              </p>
              <h2 className="font-display text-2xl font-bold">
                Ciudades de entrega
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Barinas queda habilitada por defecto. Solo el Admin Master puede
                ampliar la cobertura.
              </p>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {(Array.isArray(locations) ? locations : []).map((location) => (
                <span
                  key={location.id}
                  className="rounded-full border border-[#b8dccd] bg-[#e8f4ef] px-3 py-1.5 text-xs font-medium text-[#256b55]"
                >
                  {location.city}, {location.state}
                </span>
              ))}
            </div>
            <form
              onSubmit={addLocation}
              className="mt-6 grid gap-4 sm:grid-cols-[.8fr_1fr_auto]"
              data-testid="form-delivery-location"
            >
              <label className="grid gap-1.5 text-sm font-medium">
                Estado
                <input
                  required
                  value={state}
                  onChange={(event) => setState(event.target.value)}
                  className="h-11 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent"
                  data-testid="input-location-state"
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Ciudad
                <input
                  required
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                  className="h-11 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent"
                  placeholder="Ej. Barquisimeto"
                  data-testid="input-location-city"
                />
              </label>
              <Button
                type="submit"
                className="self-end"
                disabled={createLocation.isPending}
              >
                {createLocation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Habilitar
              </Button>
            </form>
          </section>

          <section className="rounded-2xl border border-card-border bg-card p-6 shadow-xs sm:p-8">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[.18em] text-accent">
                Accesos
              </p>
              <h2 className="font-display text-2xl font-bold">
                Usuarios y roles
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Los registros públicos nacen como clientes. Aquí puedes asignar
                comerciante o administración.
              </p>
            </div>
            <div className="mt-6 divide-y divide-border">
              {usersQuery.isLoading ? (
                <p className="py-5 text-sm text-muted-foreground">
                  Cargando usuarios…
                </p>
              ) : (
                (Array.isArray(usersQuery.data) ? usersQuery.data : []).map((target) => (
                  <div
                    key={target.id}
                    className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                    data-testid={`row-admin-user-${target.id}`}
                  >
                    <div>
                      <p className="font-medium">{target.name}</p>
                      <p className="text-xs text-muted-foreground">{target.email}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        {target.isMaster ? 'Admin Master' : 'Rol'}
                      </span>
                      {target.isMaster ? (
                        <ShieldCheck className="h-4 w-4 text-accent" />
                      ) : (
                        <select
                          value={target.role}
                          onChange={(event) =>
                            changeRole(target, event.target.value as AdminUser['role'])
                          }
                          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                          data-testid={`select-user-role-${target.id}`}
                        >
                          <option value="customer">Cliente</option>
                          <option value="merchant">Comerciante</option>
                          <option value="admin">Admin</option>
                        </select>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
