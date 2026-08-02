import { SlidersHorizontal, X } from 'lucide-react';
import type { Account } from '@/lib/types';
import { PLATFORM_LABELS } from '@/lib/platforms';
import type { Filters } from '@/store';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const STATUS_OPTIONS: [string, string][] = [
  ['all', 'todos os status'],
  ['draft', 'Rascunho'],
  ['queued', 'Na fila'],
  ['publishing', 'Publicando'],
  ['processing', 'Processando'],
  ['published', 'Publicado'],
  ['failed', 'Falhou'],
  ['canceled', 'Cancelado'],
  ['ambiguous', 'Indefinido'],
];

function Row({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value || 'all'} onValueChange={(v) => onChange(v === 'all' ? '' : v)}>
        <SelectTrigger className="w-full" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Filtros num popover em vez de três selects soltos na barra. Junta as três dimensões (status,
 * plataforma, conta) atrás de um botão só — declutter no desktop e, principalmente, no mobile, onde
 * os selects full-width comiam três linhas. Um badge mostra quantos filtros estão ativos.
 */
export function FilterMenu({
  filters,
  setFilters,
  accounts,
}: {
  filters: Filters;
  setFilters: (f: Partial<Filters>) => void;
  accounts: Account[];
}) {
  const active = [filters.status, filters.platform, filters.account].filter(Boolean).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* Altura h-8 (size default) pra bater com a pílula de abas ao lado. No mobile é só o
            ícone (economiza largura); no desktop, ícone + "Filtros". */}
        <Button variant="outline" size="default" className="gap-2 px-3 sm:px-4" aria-label="Filtros">
          <SlidersHorizontal className="size-4" />
          <span className="hidden sm:inline">Filtros</span>
          {active > 0 && (
            <span className="grid size-5 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              {active}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Filtros</span>
          {active > 0 && (
            <button
              type="button"
              onClick={() => setFilters({ status: '', platform: '', account: '' })}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" /> limpar
            </button>
          )}
        </div>
        <Row label="Status" value={filters.status} onChange={(v) => setFilters({ status: v })} options={STATUS_OPTIONS} />
        <Row
          label="Plataforma"
          value={filters.platform}
          onChange={(v) => setFilters({ platform: v })}
          options={[['all', 'todas as plataformas'], ...Object.entries(PLATFORM_LABELS)] as [string, string][]}
        />
        <Row
          label="Conta"
          value={filters.account}
          onChange={(v) => setFilters({ account: v })}
          options={[['all', 'todas as contas'], ...accounts.map((a) => [a.id, `${PLATFORM_LABELS[a.platform]} — ${a.display_name}`] as [string, string])]}
        />
      </PopoverContent>
    </Popover>
  );
}
