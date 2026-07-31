import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// Escolha de quando publicar em duas etapas visuais — faixa de dias + grade de horários — em vez de
// um <input type="datetime-local">. Aparece só quando o usuário clica em "Agendar post", porque
// escolher a data é a última decisão do fluxo, não a primeira.

const SLOT_MINUTES = 30;
const pad = (n: number) => String(n).padStart(2, '0');
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function toLocalInput(day: Date, hour: number, minute: number): string {
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T${pad(hour)}:${pad(minute)}`;
}

export function SchedulePicker({
  open,
  initial,
  confirmLabel = 'Agendar post',
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  initial?: string;
  confirmLabel?: string;
  onConfirm: (localDateTime: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const today = startOfDay(new Date());
  const initialDay = initial ? startOfDay(new Date(initial)) : today;

  const [weekStart, setWeekStart] = useState(() => initialDay);
  const [selectedDay, setSelectedDay] = useState(() => initialDay);
  // Clicar num horário apenas SELECIONA; agendar de fato exige o botão de confirmação — assim um
  // clique errado não cria o post na data errada.
  const [chosen, setChosen] = useState<{ hour: number; minute: number } | null>(() => {
    if (!initial) return null;
    const d = new Date(initial);
    return { hour: d.getHours(), minute: d.getMinutes() };
  });

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  // Todos os horários do dia de 30 em 30min; os que já passaram (se o dia é hoje) ficam desabilitados.
  const slots = useMemo(() => {
    const now = new Date();
    const isToday = startOfDay(selectedDay).getTime() === startOfDay(now).getTime();
    const out: Array<{ hour: number; minute: number; past: boolean }> = [];
    for (let m = 0; m < 24 * 60; m += SLOT_MINUTES) {
      const hour = Math.floor(m / 60);
      const minute = m % 60;
      const past = isToday && (hour < now.getHours() || (hour === now.getHours() && minute <= now.getMinutes()));
      out.push({ hour, minute, past });
    }
    return out;
  }, [selectedDay]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-hidden p-0 sm:max-w-lg">
        <div className="flex max-h-[85vh] flex-col">
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle>Quando publicar?</DialogTitle>
          </DialogHeader>

          {/* Faixa de dias */}
          <div className="flex items-center gap-2 border-b px-5 py-3">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Semana anterior"
              onClick={() => setWeekStart((w) => addDays(w, -7))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <div className="grid flex-1 grid-cols-7 gap-1">
              {days.map((d) => {
                const isSelected = startOfDay(d).getTime() === startOfDay(selectedDay).getTime();
                const isPast = startOfDay(d).getTime() < today.getTime();
                return (
                  <button
                    key={d.toISOString()}
                    type="button"
                    disabled={isPast}
                    onClick={() => setSelectedDay(d)}
                    className={`rounded-lg py-1.5 text-center transition-colors disabled:opacity-30 ${
                      isSelected ? 'bg-primary text-primary-foreground font-semibold' : 'hover:bg-muted'
                    }`}
                  >
                    <div className="text-[11px] uppercase opacity-70">{WEEKDAYS[d.getDay()]}</div>
                    <div className="text-sm font-semibold leading-tight">{d.getDate()}</div>
                    <div className="text-[11px] opacity-70">{MONTHS[d.getMonth()]}</div>
                  </button>
                );
              })}
            </div>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Próxima semana"
              onClick={() => setWeekStart((w) => addDays(w, 7))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>

          {/* Grade de horários */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="grid grid-cols-3 gap-2">
              {slots.map(({ hour, minute, past }) => {
                const isSelected = chosen != null && chosen.hour === hour && chosen.minute === minute;
                return (
                  <Button
                    key={`${hour}:${minute}`}
                    type="button"
                    variant={isSelected ? 'default' : 'outline'}
                    disabled={past}
                    onClick={() => setChosen({ hour, minute })}
                  >
                    {pad(hour)}:{pad(minute)}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t px-5 py-3">
            <div className="min-w-0 text-xs">
              {chosen ? (
                <>
                  <div className="text-muted-foreground">Publicar em</div>
                  <div className="truncate text-sm font-semibold">
                    {WEEKDAYS[selectedDay.getDay()]}, {selectedDay.getDate()} de {MONTHS[selectedDay.getMonth()]} às{' '}
                    {pad(chosen.hour)}:{pad(chosen.minute)}
                  </div>
                </>
              ) : (
                <span className="text-muted-foreground">Escolha um horário acima.</span>
              )}
            </div>
            <Button
              disabled={!chosen}
              onClick={() => chosen && onConfirm(toLocalInput(selectedDay, chosen.hour, chosen.minute))}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
