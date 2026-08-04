import { useMemo } from 'react';

// Quando o SEU PÚBLICO está online, por hora do dia.
//
// POR QUE ISSO VALE MAIS QUE O "MELHOR DIA" QUE JÁ EXISTIA: aquele card conclui a partir dos posts
// que a pessoa já fez — amostra pequena e enviesada, que mede quando ELA postou, não quando o
// público está lá. Isto vem do `online_followers` da Meta: comportamento de audiência, independente
// do que se tentou até hoje.
//
// FORMA: magnitude sobre uma dimensão ordenada (0h–23h) — barras. Série única, então sem legenda: o
// título já diz o que é. Rótulo só no pico, nunca número em cima de cada barra.
//
// COR: uma cor só (roxo da marca) porque não há categorias a distinguir; o pico ganha amarelo. Esse
// amarelo tem contraste 1,19:1 contra o fundo — invisível como forma sozinha, o que o validador de
// paleta acusa como WARN exigindo "relevo". Daí a borda roxa e o rótulo direto: a barra de pico é
// reconhecível por forma e por texto, não por cor.

/** `online_followers` da Meta: objeto com chave '0'..'23'. */
export type HourlyFollowers = Record<string, number>;

export function BestHoursChart({ data }: { data: HourlyFollowers }) {
  const horas = useMemo(() => {
    const valores = Array.from({ length: 24 }, (_, h) => ({ hora: h, valor: data[String(h)] ?? 0 }));
    const max = Math.max(...valores.map((v) => v.valor), 1);
    const pico = valores.reduce((a, b) => (b.valor > a.valor ? b : a), valores[0]);
    return { valores, max, pico };
  }, [data]);

  if (horas.max <= 1) return null;

  const fmtHora = (h: number) => `${String(h).padStart(2, '0')}h`;

  return (
    <div>
      <p className="mb-1 text-sm font-semibold">Quando seu público está online</p>
      <p className="mb-4 text-xs text-muted-foreground">
        Pico às <b className="text-foreground">{fmtHora(horas.pico.hora)}</b>, com{' '}
        {horas.pico.valor.toLocaleString('pt-BR')} seguidores online.
      </p>

      <div className="flex h-32 items-end gap-[2px]" role="img" aria-label="Seguidores online por hora do dia">
        {horas.valores.map(({ hora, valor }) => {
          const ehPico = hora === horas.pico.hora;
          return (
            <div key={hora} className="group relative flex flex-1 flex-col justify-end">
              {/* Rótulo do pico: é o "relevo" que torna a barra amarela legível sem depender da cor. */}
              {ehPico && (
                <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-bold">
                  {fmtHora(hora)}
                </span>
              )}
              <div
                className={`w-full rounded-t-[4px] border-2 border-brand transition-[height] ${
                  ehPico ? 'bg-primary' : 'bg-brand'
                }`}
                style={{ height: `${Math.max((valor / horas.max) * 100, 4)}%` }}
                title={`${fmtHora(hora)} — ${valor.toLocaleString('pt-BR')} online`}
              />
            </div>
          );
        })}
      </div>

      {/* Só 4 marcas no eixo: 24 rótulos colidiriam, e a hora exata quem dá é o pico e o title. */}
      <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
        <span>00h</span>
        <span>06h</span>
        <span>12h</span>
        <span>18h</span>
        <span>23h</span>
      </div>
    </div>
  );
}
