import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Post, Target } from '@/lib/types';
import { PLATFORM_COLORS, PLATFORM_LABELS } from '@/lib/platforms';
import { dayKey } from '@/lib/format';
import { requestPrefillDate } from '@/lib/composer-bus';
import { Button } from '@/components/ui/button';
import type { DialogSelection } from './PostDialog';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

interface Entry {
  post: Post;
  target: Target;
}

export function CalendarView({ posts, onOpen }: { posts: Post[]; onOpen: (s: DialogSelection) => void }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const byDay = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const post of posts) {
      const k = dayKey(new Date(post.scheduled_for));
      for (const target of post.targets) {
        const list = map.get(k) ?? [];
        list.push({ post, target });
        map.set(k, list);
      }
    }
    return map;
  }, [posts]);

  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const lead = first.getDay();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  function shift(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 0) {
      m = 11;
      y--;
    } else if (m > 11) {
      m = 0;
      y++;
    }
    setMonth(m);
    setYear(y);
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Button size="icon" variant="outline" className="size-8" onClick={() => shift(-1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-40 text-sm font-semibold">
          {MONTHS[month]} de {year}
        </span>
        <Button size="icon" variant="outline" className="size-8" onClick={() => shift(1)}>
          <ChevronRight className="size-4" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setYear(now.getFullYear());
            setMonth(now.getMonth());
          }}
        >
          Hoje
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((w) => (
          <div key={w} className="pb-1 text-center text-[11px] font-semibold uppercase text-muted-foreground">
            {w}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`b${i}`} />;
          const date = new Date(year, month, day);
          const isToday = date.toDateString() === now.toDateString();
          const entries = byDay.get(dayKey(date)) ?? [];
          const local = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T09:00`;
          return (
            <button
              key={day}
              onClick={() => requestPrefillDate(local)}
              className={`min-h-24 rounded-lg border p-1.5 text-left transition-colors hover:border-primary ${isToday ? 'border-2 border-primary' : ''}`}
            >
              <div className="mb-1 text-xs font-semibold">{day}</div>
              {entries.slice(0, 3).map(({ post, target }) => {
                const failed = target.status === 'failed' || target.status === 'ambiguous';
                return (
                  <span
                    key={target.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen({ post, target });
                    }}
                    title={`${PLATFORM_LABELS[target.platform]} — ${target.account_name}`}
                    className={`mb-0.5 flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] ${failed ? 'bg-red-100 dark:bg-red-500/15' : 'bg-muted'} ${target.status === 'draft' ? 'opacity-70' : ''}`}
                    style={{ borderLeft: `3px ${target.status === 'draft' ? 'dashed' : 'solid'} ${PLATFORM_COLORS[target.platform]}` }}
                  >
                    {failed && <AlertTriangle className="size-2.5 shrink-0 text-red-600" />}
                    <span className="truncate">{target.account_name}</span>
                  </span>
                );
              })}
              {entries.length > 3 && <span className="text-[11px] text-muted-foreground">+{entries.length - 3} mais</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
