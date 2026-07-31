import { ArrowLeft } from 'lucide-react';
import { useScheduler } from '@/store';
import type { Account, Platform } from '@/lib/types';
import { PLATFORMS, PLATFORM_LABELS } from '@/lib/platforms';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PlatformAvatar } from './PlatformAvatar';

const STATUS_PILL: Record<Account['status'], { label: string; cls: string }> = {
  active: { label: 'Conectada', cls: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300' },
  needs_reauth: { label: 'Reautenticar', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
  disabled: { label: 'Desativada', cls: 'bg-muted text-muted-foreground' },
};

// Instagram e Facebook são autenticados juntos pelo mesmo consentimento da Meta.
function connectHref(platform: Platform): string {
  if (platform === 'instagram' || platform === 'facebook') return '/api/connect/meta';
  return `/api/connect/${platform}`;
}

export function ConnectionsView({ onBack }: { onBack: () => void }) {
  const { accounts } = useScheduler();

  return (
    <Card className="h-full">
      <CardHeader className="flex-row items-center gap-3 space-y-0">
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Voltar">
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <CardTitle>Conexões</CardTitle>
          <p className="text-xs text-muted-foreground">Conecte as contas onde você vai publicar.</p>
        </div>
      </CardHeader>

      <CardContent className="min-h-0 flex-1 overflow-auto">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {PLATFORMS.map((platform) => {
            const platformAccounts = accounts.filter((a) => a.platform === platform);
            const href = connectHref(platform);
            const hasAccounts = platformAccounts.length > 0;
            return (
              // h-full + flex-col fazem os cards da mesma linha terem a mesma altura, e o mt-auto
              // do bloco de ação prende o botão no rodapé — sem isso ele flutua logo abaixo da
              // lista e cada card alinha o botão numa altura diferente.
              <Card key={platform} size="sm" className="flex h-full flex-col gap-3">
                <CardHeader className="flex-row items-center gap-2 space-y-0">
                  <PlatformAvatar platform={platform} />
                  <CardTitle className="text-sm">{PLATFORM_LABELS[platform]}</CardTitle>
                </CardHeader>

                <CardContent className="flex flex-1 flex-col gap-2">
                  {hasAccounts &&
                    platformAccounts.map((a) => (
                      <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/60 px-3 py-2">
                        <span className="truncate text-sm">{a.display_name}</span>
                        <Badge variant="secondary" className={STATUS_PILL[a.status].cls}>
                          {STATUS_PILL[a.status].label}
                        </Badge>
                      </div>
                    ))}

                  <div className="mt-auto space-y-2 pt-1">
                    {(platform === 'instagram' || platform === 'facebook') && (
                      <p className="text-xs text-muted-foreground">Instagram e Facebook conectam juntos pela Meta.</p>
                    )}
                    <Button
                      variant={hasAccounts ? 'outline' : 'default'}
                      className="w-full"
                      onClick={() => {
                        window.location.href = href;
                      }}
                    >
                      {hasAccounts ? 'Conectar outra' : 'Conectar'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
