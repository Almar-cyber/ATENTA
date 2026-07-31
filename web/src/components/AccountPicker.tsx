import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import type { Account } from '@/lib/types';
import { PLATFORM_COLORS, PLATFORM_LABELS } from '@/lib/platforms';
import { PlatformIcon } from './PlatformIcon';

// Compact chip picker for "which accounts does this post go to" — a ToggleGroup (Radix, multi-
// select) instead of a checkbox list, so several accounts can be toggled on/off at a glance.
export function AccountPicker({
  accounts,
  selected,
  onChange,
}: {
  accounts: Account[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  if (accounts.length === 0) {
    return <p className="text-xs text-muted-foreground">Nenhuma conta autenticada ainda.</p>;
  }

  const activeIds = accounts.filter((a) => a.status === 'active').map((a) => a.id);

  return (
    <div className="space-y-1.5">
      <div className="flex justify-end gap-1">
        <Button
          size="xs"
          variant="ghost"
          disabled={activeIds.length === 0}
          onClick={() => onChange(new Set(activeIds))}
        >
          Selecionar todas
        </Button>
        <Button size="xs" variant="ghost" disabled={selected.size === 0} onClick={() => onChange(new Set())}>
          Limpar
        </Button>
      </div>
      <ToggleGroup
        type="multiple"
        value={Array.from(selected)}
        onValueChange={(vals) => onChange(new Set(vals))}
        className="flex flex-wrap gap-1.5"
      >
        {accounts.map((a) => {
          const inactive = a.status !== 'active';
          const item = (
            <ToggleGroupItem
              key={a.id}
              value={a.id}
              disabled={inactive}
              variant="outline"
              size="sm"
              className="gap-1.5 rounded-md px-3 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground data-[state=on]:font-semibold"
            >
              <PlatformIcon
                platform={a.platform}
                className="size-3.5 shrink-0"
                style={{ color: PLATFORM_COLORS[a.platform] }}
              />
              <span>{a.display_name}</span>
              {inactive && <span className="size-1.5 rounded-full bg-muted-foreground/60" />}
            </ToggleGroupItem>
          );

          if (!inactive) return item;

          return (
            <Tooltip key={a.id}>
              {/* Native `disabled` buttons don't reliably fire hover/focus, so the tooltip trigger
                  wraps the item in a plain (non-disabled) span — the standard Radix workaround. */}
              <TooltipTrigger asChild>
                <span tabIndex={0} className="inline-block">
                  {item}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {PLATFORM_LABELS[a.platform]} {a.status === 'needs_reauth' ? 'precisa reautenticar' : 'está desativada'}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </ToggleGroup>
    </div>
  );
}
