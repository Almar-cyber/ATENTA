import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import type { Post, Target } from '@/lib/types';
import { PLATFORM_COLORS } from '@/lib/platforms';
import { dayKey } from '@/lib/format';
import { requestPrefillDate } from '@/lib/composer-bus';
import { Button } from '@/components/ui/button';
import { PlatformIcon } from './PlatformIcon';
import type { DialogSelection } from './PostDialog';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

interface Entry {
  post: Post;
  target: Target;
  hour: number;
  minute: number;
}

function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay()); // back to Sunday
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function WeekView({ posts, onOpen }: { posts: Post[]; onOpen: (s: DialogSelection) => void }) {
  const now = new Date();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(now));

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  // entries[dayIndex] → Entry[] for that day of the current week.
  const { byCell, startHour, endHour } = useMemo(() => {
    const map = new Map<string, Entry[]>(); // key: `${dayIndex}-${hour}`
    const dayKeys = days.map(dayKey);
    let min = 8;
    let max = 19;
    for (const post of posts) {
      const d = new Date(post.scheduled_for);
      const di = dayKeys.indexOf(dayKey(d));
      if (di === -1) continue;
      const hour = d.getHours();
      min = Math.min(min, hour);
      max = Math.max(max, hour);
      for (const target of post.targets) {
        const key = `${di}-${hour}`;
        const list = map.get(key) ?? [];
        list.push({ post, target, hour, minute: d.getMinutes() });
        map.set(key, list);
      }
    }
    return { byCell: map, startHour: Math.max(0, min), endHour: Math.min(23, max) };
  }, [posts, days]);

  const hours = useMemo(
    () => Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i),
    [startHour, endHour]
  );

  const rangeLabel = `${pad(days[0].getDate())}/${pad(days[0].getMonth() + 1)} – ${pad(days[6].getDate())}/${pad(days[6].getMonth() + 1)}`;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Button size="icon" variant="outline" className="size-8" onClick={() => setWeekStart((w) => addDays(w, -7))}>
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-32 text-center text-sm font-semibold">{rangeLabel}</span>
        <Button size="icon" variant="outline" className="size-8" onClick={() => setWeekStart((w) => addDays(w, 7))}>
          <ChevronRight className="size-4" />
        </Button>
        <Button size="sm" variant="outline" onClick={() => setWeekStart(startOfWeek(now))}>
          Esta semana
        </Button>
      </div>

      <div className="min-w-[720px] overflow-hidden rounded-xl border">
        {/* Header: corner + 7 day headers */}
        <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b bg-muted/40">
          <div />
          {days.map((d) => {
            const isToday = d.toDateString() === now.toDateString();
            return (
              <div key={d.toISOString()} className="border-l py-2 text-center">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{WEEKDAYS[d.getDay()]}</div>
                <div
                  className={`mx-auto mt-0.5 grid size-6 place-items-center rounded-full text-xs font-semibold ${isToday ? 'bg-primary text-primary-foreground' : ''}`}
                >
                  {d.getDate()}
                </div>
              </div>
            );
          })}
        </div>

        {/* Hour rows */}
        {hours.map((hour) => (
          <div key={hour} className="grid grid-cols-[56px_repeat(7,1fr)] border-b last:border-b-0">
            <div className="py-1 pr-2 text-right text-xs text-muted-foreground">{pad(hour)}:00</div>
            {days.map((d, di) => {
              const entries = byCell.get(`${di}-${hour}`) ?? [];
              const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:00`;
              return (
                <button
                  key={di}
                  onClick={() => requestPrefillDate(local)}
                  className="min-h-12 space-y-1 border-l p-1 text-left align-top transition-colors hover:bg-muted/50"
                >
                  {entries.map(({ post, target, minute }) => {
                    const failed = target.status === 'failed' || target.status === 'ambiguous';
                    const color = PLATFORM_COLORS[target.platform];
                    return (
                      <span
                        key={target.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen({ post, target });
                        }}
                        title={`${pad(hour)}:${pad(minute)} — ${target.account_name}`}
                        className={`block cursor-pointer truncate rounded-md px-1.5 py-1 text-xs leading-tight ${target.status === 'draft' ? 'opacity-70' : ''}`}
                        style={{ backgroundColor: `${color}1f`, borderLeft: `3px solid ${color}` }}
                      >
                        <span className="flex items-center gap-1">
                          {failed ? (
                            <AlertTriangle className="size-2.5 shrink-0 text-destructive" />
                          ) : (
                            <PlatformIcon platform={target.platform} className="size-2.5 shrink-0" style={{ color }} />
                          )}
                          <span className="font-medium">{pad(hour)}:{pad(minute)}</span>
                        </span>
                        <span className="truncate text-muted-foreground">{target.account_name}</span>
                      </span>
                    );
                  })}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
