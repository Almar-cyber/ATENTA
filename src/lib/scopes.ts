// Quais permissões cada conta REALMENTE recebeu, e o que falta pra ela render métrica.
//
// POR QUE ISSO EXISTE: `post_metrics` ficou zerado por semanas sem ninguém perceber. O coletor
// rodava a cada 10 minutos, batia num erro de permissão e voltava vazio — e "vazio" é
// indistinguível de "esse post ainda não tem números". A causa era um escopo
// (`instagram_manage_insights`) que a conta não tinha, porque foi conectada antes de ele existir na
// nossa lista. Descobrir isso levou três rodadas de investigação contra a API.
//
// Guardar o escopo concedido transforma essa investigação numa consulta, e permite ao painel avisar
// sozinho — que é a diferença entre um defeito silencioso e um aviso na tela.
//
// NOTA IMPORTANTE: o que importa é o escopo CONCEDIDO, não o pedido. Nem sempre são iguais: a rede
// pode ignorar um pedido (o Meta descarta em silêncio permissão que não esteja em nenhum caso de
// uso do app) ou a pessoa pode desmarcar itens na tela de consentimento.
import type { Platform } from './types.js';

/**
 * O que cada rede exige para devolver métrica de post. Vazio = não depende de escopo específico
 * (ou não temos coleta de métrica pra ela).
 */
export const METRICS_SCOPES: Record<Platform, string[]> = {
  instagram: ['instagram_manage_insights'],
  facebook: ['read_insights'],
  youtube: ['https://www.googleapis.com/auth/youtube.readonly'],
  tiktok: ['video.list'],
  // O LinkedIn não expõe analytics de post orgânico fora do programa de parceiros — não é falta de
  // escopo, é ausência de API. Exigir algo aqui viraria um aviso que a pessoa não tem como resolver.
  linkedin: [],
  // Pinterest: a coleta ainda não foi implementada; sem promessa, sem exigência.
  pinterest: [],
};

/**
 * Esta conta consegue trazer métrica?
 *
 * `null` (escopo não registrado) devolve `true` de propósito: são as contas conectadas antes de a
 * gravação existir, e marcá-las como quebradas encheria a tela de avisos falsos. Elas se resolvem
 * na próxima reconexão. Quem denuncia problema real é o escopo registrado E incompleto.
 */
export function metricsReady(platform: Platform, grantedScope: string | null | undefined): boolean {
  const required = METRICS_SCOPES[platform] ?? [];
  if (required.length === 0) return true;
  if (!grantedScope) return true;
  const granted = parseScope(grantedScope);
  return required.every((s) => granted.includes(s));
}

/** O que falta, pra mensagem poder dizer o nome exato em vez de "alguma permissão". */
export function missingMetricsScopes(platform: Platform, grantedScope: string | null | undefined): string[] {
  const required = METRICS_SCOPES[platform] ?? [];
  if (required.length === 0 || !grantedScope) return [];
  const granted = parseScope(grantedScope);
  return required.filter((s) => !granted.includes(s));
}

/**
 * Normaliza a lista de escopos.
 *
 * Cada rede escolheu um separador: o Google usa espaço, LinkedIn e Pinterest usam vírgula, o Meta
 * devolve array. Tratar os dois separadores de uma vez evita um analisador por rede — e evita o bug
 * silencioso de "a string tem a permissão mas o `includes` não achou porque o separador era outro".
 */
function parseScope(scope: string): string[] {
  return scope
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
