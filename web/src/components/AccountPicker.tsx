import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Account } from '@/lib/types';
import { PLATFORM_COLORS, PLATFORM_LABELS } from '@/lib/platforms';

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

  return (
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
            className="gap-1.5 rounded-full border-l-[3px] px-3 data-[state=on]:border-foreground/30 data-[state=on]:bg-muted data-[state=on]:font-semibold"
            style={{ borderLeftColor: PLATFORM_COLORS[a.platform] }}
          >
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
  );
}
