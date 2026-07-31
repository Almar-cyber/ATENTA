import { ArrowLeft } from 'lucide-react';
import { useScheduler } from '@/store';
import type { Account, Platform } from '@/lib/types';
import { PLATFORMS, PLATFORM_COLORS, PLATFORM_LABELS } from '@/lib/platforms';
import { Button } from '@/components/ui/button';
import { PlatformIcon } from './PlatformIcon';

const STATUS_PILL: Record<Account['status'], { label: string; cls: string }> = {
  active: { label: 'Conectada', cls: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300' },
  needs_reauth: { label: 'Reautenticar', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
  disabled: { label: 'Desativada', cls: 'bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300' },
};

// Instagram e Facebook são autenticados juntos pelo mesmo consentimento da Meta; YouTube ainda não
// tem login web (usa CLI local), então fica desabilitado por enquanto.
function connectHref(platform: Platform): string | null {
  if (platform === 'youtube') return null;
  if (platform === 'instagram' || platform === 'facebook') return '/api/connect/meta';
  return `/api/connect/${platform}`;
}

export function ConnectionsView({ onBack }: { onBack: () => void }) {
  const { accounts } = useScheduler();

  return (
    <section className="flex h-full flex-col rounded-2xl bg-card p-5 shadow-soft ring-1 ring-foreground/5">
      <div className="mb-4 flex shrink-0 items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Voltar">
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h2 className="text-base font-semibold">Conexões</h2>
          <p className="text-xs text-muted-foreground">Conecte as contas onde você vai publicar.</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {PLATFORMS.map((platform) => {
            const platformAccounts = accounts.filter((a) => a.platform === platform);
            const href = connectHref(platform);
            const hasAccounts = platformAccounts.length > 0;
            return (
              <div key={platform} className="flex flex-col rounded-2xl bg-card p-4 shadow-soft ring-1 ring-foreground/5">
                <div className="mb-3 flex items-center gap-2.5">
                  <span
                    className="grid size-9 shrink-0 place-items-center rounded-md text-white"
                    style={{ background: PLATFORM_COLORS[platform] }}
                  >
                    <PlatformIcon platform={platform} className="size-[18px]" />
                  </span>
                  <span className="font-semibold">{PLATFORM_LABELS[platform]}</span>
                </div>

                <div className="mb-3 min-h-10 flex-1 space-y-1.5">
                  {hasAccounts ? (
                    platformAccounts.map((a) => (
                      <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/60 px-2.5 py-1.5">
                        <span className="truncate text-sm">{a.display_name}</span>
                        <span className={`shrink-0 rounded-[6px] px-1.5 py-0.5 text-[11px] font-medium ${STATUS_PILL[a.status].cls}`}>
                          {STATUS_PILL[a.status].label}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground">Nenhuma conta conectada.</p>
                  )}
                </div>

                {href ? (
                  <Button
                    variant={hasAccounts ? 'outline' : 'default'}
                    className="w-full"
                    onClick={() => {
                      window.location.href = href;
                    }}
                  >
                    {hasAccounts ? 'Conectar outra' : 'Conectar'}
                  </Button>
                ) : (
                  <Button variant="outline" className="w-full" disabled>
                    Em breve (login web)
                  </Button>
                )}

                {(platform === 'instagram' || platform === 'facebook') && (
                  <p className="mt-2 text-[11px] text-muted-foreground">Instagram e Facebook conectam juntos pela Meta.</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
