export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function fmtDayHeader(iso: string): string {
  const s = new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Quando, do jeito que se fala: "hoje 18h", "amanhã 9h", "qui 12/08 14h".
 *
 * O painel lista o que sai a seguir, e ali a pergunta é "falta muito?", não "que data é". Uma data
 * absoluta obriga a conta de cabeça toda vez — e é a conta que decide se você precisa agir agora.
 */
export function fmtQuando(iso: string): string {
  const d = new Date(iso);
  const hora = d.toLocaleTimeString('pt-BR', { hour: 'numeric', minute: '2-digit' }).replace(':00', 'h');
  const hoje = new Date();
  const amanha = new Date(hoje.getTime() + 86_400_000);
  if (dayKey(d) === dayKey(hoje)) return `hoje ${hora}`;
  if (dayKey(d) === dayKey(amanha)) return `amanhã ${hora}`;
  const dia = d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  // pt-BR devolve "qui., 12/08" — o ponto depois do dia da semana só polui numa linha curta.
  return `${dia.replace('.,', '')} ${hora}`;
}

/**
 * Quanto tempo FAZ: "ontem", "há 3 dias", "há 9 meses", "há 2 anos".
 *
 * Irmã da `fmtQuando` acima, virada pro passado. Existe pela mesma razão: "06/10/2020" obriga a
 * conta de cabeça, e é a conta que carrega o significado — "há 6 anos" já diz que aquela pessoa
 * some do mapa, sem ninguém precisar calcular.
 */
export function fmtHaQuantoTempo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const dias = Math.floor(ms / 86_400_000);
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  if (meses < 12) return `há ${meses} ${meses === 1 ? 'mês' : 'meses'}`;
  const anos = Math.floor(dias / 365);
  return `há ${anos} ${anos === 1 ? 'ano' : 'anos'}`;
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// datetime-local value (YYYY-MM-DDTHH:mm) → ISO string.
export function localToIso(local: string): string {
  return new Date(local).toISOString();
}

export function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h${minutes}min` : `${hours}h`;
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}
