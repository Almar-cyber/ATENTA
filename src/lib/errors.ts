import type { ErrorClass } from './types.js';

/**
 * Error thrown by adapters when a platform API returns a non-OK response.
 *
 * Adapters used to throw plain `new Error('linkedin: post failed: 401 {...}')`, which made every
 * classifyError() table below dead code: extractCode() looks for a `code`/`error` property, a
 * plain Error has neither, so everything fell through to the 'retryable' fallback. In practice
 * that meant a revoked token was retried 5 times and then marked failed, and the account was
 * never flipped to needs_reauth — the one signal worker.ts has for Meta Page tokens, which never
 * trip needsRefresh() on their own.
 */
export class ApiError extends Error {
  readonly code: string | undefined;
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string, code: string | undefined) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.code = code;
  }
}

/**
 * Builds an ApiError from a failed Response, consuming its body once.
 *
 * Usage: `throw await apiError('linkedin: post failed', res)`. The response body is read here, so
 * callers must not have read it already.
 */
export async function apiError(prefix: string, res: Response): Promise<ApiError> {
  const body = await res.text().catch(() => '');
  const code = extractCodeFromBody(body);
  const detail = code ? `${res.status} ${code} ${body}` : `${res.status} ${body}`;
  return new ApiError(`${prefix}: ${detail}`, res.status, body, code);
}

/**
 * Digs the platform's own error identifier out of a JSON error body. Each API nests it somewhere
 * different, and several return a number where the classification tables use a string:
 *   Meta:      {"error": {"type": "OAuthException", "code": 190}}
 *   LinkedIn:  {"code": "REVOKED_ACCESS_TOKEN"} / {"serviceErrorCode": 65601}
 *   TikTok:    {"error": {"code": "access_token_invalid"}}
 *   Pinterest: {"code": 2, "message": "..."}
 *   Google:    {"error": {"errors": [{"reason": "quotaExceeded"}]}}
 */
function extractCodeFromBody(body: string): string | undefined {
  if (!body) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;

  const root = parsed as Record<string, unknown>;
  const error = (typeof root.error === 'object' && root.error !== null ? root.error : {}) as Record<string, unknown>;

  // Google nests the useful reason one level deeper than everyone else.
  const googleReason = Array.isArray(error.errors)
    ? (error.errors[0] as Record<string, unknown> | undefined)?.reason
    : undefined;

  // googleReason outranks error.code because Google puts the plain HTTP status in error.code (403)
  // and the actionable identifier in errors[0].reason ("quotaExceeded"). Meta is the reverse — its
  // error.code (190) is meaningful — but Meta never sends an errors array, so the order is safe.
  return (
    firstString(error.type, googleReason, error.code, root.code, root.serviceErrorCode, root.error_code, root.error) ??
    undefined
  );
}

function firstString(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate) return candidate;
    if (typeof candidate === 'number') return String(candidate);
  }
  return undefined;
}

/** Small static lookup per adapter — a generalized rules engine would be overkill at this volume. */
export function classifyByKnownCodes(
  err: unknown,
  table: Record<string, ErrorClass>,
  fallback?: ErrorClass
): ErrorClass {
  const code = extractCode(err);
  if (code && table[code]) return table[code];
  return fallback ?? classifyByStatus(err);
}

/**
 * When the platform didn't send a code we recognize, HTTP status is still a better signal than a
 * blanket 'retryable': a 400 retried 5 times is 5 guaranteed failures and a wasted day of backoff.
 */
function classifyByStatus(err: unknown): ErrorClass {
  const status = err instanceof ApiError ? err.status : undefined;
  if (status === undefined) return 'retryable';
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'quota';
  if (status >= 400 && status < 500) return 'permanent';
  return 'retryable';
}

function extractCode(err: unknown): string | undefined {
  if (err && typeof err === 'object') {
    const anyErr = err as Record<string, unknown>;
    if (typeof anyErr.code === 'string') return anyErr.code;
    if (typeof anyErr.error === 'string') return anyErr.error;
  }
  return undefined;
}

// Parse best-effort de um corpo já lido: um corpo malformado/não-JSON só significa "sem código pra
// anexar" (cai no fallback de classifyByKnownCodes), não um erro novo pra lançar. Mantido porque os
// adapters daqui leem o corpo e classificam com classifyByKnownCodes + este helper (em vez do
// apiError() da branch, que faz as duas coisas de uma vez).
export function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Mensagem para a PESSOA, não para o log
//
// O que era gravado em `last_error` (e mostrado na tela) vinha cru da API:
//
//   tiktok: video/init failed: 400 {"error":{"code":"invalid_params",
//   "message":"The chunk size is invalid","log_id":"20260805...F3C"}}
//
// Isso não é mensagem, é despejo de JSON. Quem lê não descobre nem o que houve nem o que fazer, e
// `log_id` só serve pro suporte da plataforma. O texto técnico continua existindo (é o que permite
// depurar), mas deixa de ser a primeira coisa que a pessoa vê.
//
// A regra é a mesma dos avisos do compositor (design.md §7): diga O QUE FAZER, não o que quebrou.

interface Traducao {
  /** Trecho que identifica o erro dentro da mensagem técnica. */
  quando: RegExp;
  /** O que a pessoa lê. Imperativo, sem jargão, sem id de suporte. */
  texto: string;
}

const TRADUCOES: Traducao[] = [
  // TikTok
  {
    quando: /chunk size is invalid/i,
    texto: 'O vídeo é grande demais para o envio em uma etapa. Tente um arquivo menor ou mais curto.',
  },
  {
    quando: /privacy_level_option_mismatch/i,
    texto: 'O nível de privacidade escolhido não está disponível nesta conta do TikTok. Escolha outro.',
  },
  {
    quando: /spam_risk|reached_active_user_cap/i,
    texto: 'O TikTok limitou publicações desta conta por enquanto. Tente de novo mais tarde.',
  },
  {
    quando: /url_ownership_unverified/i,
    texto: 'O TikTok não reconheceu o domínio de onde o vídeo é servido. Verifique o domínio no painel do TikTok.',
  },
  // Precisa vir ANTES da regra genérica de 401/403 lá embaixo: este erro é 403, e a genérica dizia
  // "a conexão expirou, reconecte" — mandando reconectar uma conta que estava perfeitamente
  // conectada. Foi exatamente o que aconteceu na primeira publicação real do TikTok: reconectar não
  // resolvia nada e o motivo verdadeiro ficava escondido.
  {
    quando: /unaudited_client_can_only_post_to_private_accounts/i,
    texto:
      'Enquanto o app não passa pela auditoria do TikTok, só dá para publicar em conta com perfil PRIVADO. Deixe a conta privada no app do TikTok e tente de novo, ou espere a aprovação.',
  },
  // Meta (Instagram e Facebook)
  {
    quando: /Missing Permissions|#200/i,
    texto: 'A rede social ainda não liberou esta permissão para o app. Nada a fazer aqui — depende da análise da plataforma.',
  },
  {
    quando: /nonexisting field/i,
    texto: 'A rede social não reconheceu um dos campos pedidos. Já registramos; nenhuma ação sua é necessária.',
  },
  {
    quando: /aspect ratio|proporção/i,
    texto: 'A proporção da imagem não é aceita nesta rede. Use o recorte antes de agendar.',
  },
  // Genéricos, por classe
  {
    quando: /\b(401|403)\b|OAuthException|invalid_token|token.*expired/i,
    texto: 'A conexão com esta rede expirou. Reconecte a conta em Conexões.',
  },
  { quando: /\b429\b|rate.?limit|quota/i, texto: 'A rede social limitou o volume de chamadas. Vamos tentar de novo sozinhos.' },
  { quando: /\b5\d\d\b|timed out|timeout/i, texto: 'A rede social não respondeu a tempo. Vamos tentar de novo sozinhos.' },
];

/**
 * Frase curta e acionável para o erro; `null` quando não sabemos traduzir.
 *
 * Devolver `null` (em vez de um genérico do tipo "algo deu errado") é de propósito: um erro que não
 * reconhecemos precisa chegar íntegro a quem for investigar. Esconder atrás de texto bonito foi
 * exatamente o que fez a coleta do Facebook falhar em silêncio por semanas.
 */
export function mensagemAmigavel(erroTecnico: string): string | null {
  for (const { quando, texto } of TRADUCOES) {
    if (quando.test(erroTecnico)) return texto;
  }
  return null;
}
