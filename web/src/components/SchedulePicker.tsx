import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// Escolha de quando publicar em duas etapas visuais — faixa de dias + grade de horários — em vez de
// um <input type="datetime-local">. Aparece só quando o usuário clica em "Agendar post", porque
// escolher a data é a última decisão do fluxo, não a primeira.

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
  // Horário como texto "HH:MM", digitado livremente.
  //
  // Era uma grade de 48 botões de 30 em 30 minutos, e o passo de 30min era um limite inventado aqui:
  // a API de nenhuma rede exige hora redonda. Quem quer publicar 12:07 (ou agendar pra daqui a dois
  // minutos, pra testar) não tinha como — no melhor caso esperava meia hora pelo próximo slot.
  const [time, setTime] = useState<string>(() => {
    if (!initial) return '';
    const d = new Date(initial);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const chosen = useMemo(() => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
    if (!m) return null;
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour > 23 || minute > 59) return null;
    return { hour, minute };
  }, [time]);

  // Hora que já passou no dia de HOJE: a fila cobra a data e publicaria na varredura seguinte (ver
  // design.md §3), então isso é erro de digitação, não uma escolha válida.
  const noPassado = useMemo(() => {
    if (!chosen) return false;
    const alvo = new Date(selectedDay);
    alvo.setHours(chosen.hour, chosen.minute, 0, 0);
    return alvo.getTime() <= Date.now();
  }, [chosen, selectedDay]);

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

          {/* Horário digitado. Os atalhos abaixo cobrem os casos comuns sem tirar a liberdade de
              digitar qualquer minuto — inclusive "daqui a 5min", que a grade antiga não permitia. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <label htmlFor="horario" className="text-sm font-medium">
              Horário
            </label>
            <input
              id="horario"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="mt-1.5 w-full rounded-lg border-2 border-brand bg-card px-3 py-2 text-lg font-semibold tabular-nums outline-none focus-visible:shadow-[3px_3px_0_0_var(--brand)]"
            />
            {noPassado && (
              <p className="mt-2 text-xs font-medium text-destructive">
                Esse horário já passou. Escolha um mais tarde ou outro dia.
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {[
                { rotulo: 'Daqui a 5min', minutos: 5 },
                { rotulo: 'Daqui a 30min', minutos: 30 },
                { rotulo: 'Daqui a 1h', minutos: 60 },
              ].map(({ rotulo, minutos }) => (
                <Button
                  key={rotulo}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const d = new Date(Date.now() + minutos * 60_000);
                    setSelectedDay(startOfDay(d));
                    setWeekStart(startOfDay(d));
                    setTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
                  }}
                >
                  {rotulo}
                </Button>
              ))}
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
              disabled={!chosen || noPassado}
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
