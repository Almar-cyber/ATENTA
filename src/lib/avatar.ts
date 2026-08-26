// As variantes válidas do avatar (Open Peeps).
//
// POR QUE ESTA LISTA EXISTE NO SERVIDOR, e não só no seletor do front: `avatar` é escrito por uma
// rota autenticada e lido de volta pra dentro de um `<svg>` no navegador de quem está logado. Sem
// allowlist, o campo aceitaria qualquer string — e o princípio 1 do design.md (o servidor é a
// autoridade) vale aqui igual vale pro limite de mídia.
//
// Os nomes saem do próprio pacote (`@dicebear/styles`, open-peeps.json, CC0 de Pablo Stanley — o
// mesmo autor dos doodles da landing). Se o pacote subir de versão e mexer nos nomes, é aqui que
// tem que refletir; uma variante desconhecida é recusada em vez de virar avatar quebrado.

export const CABECAS = [
  'afro', 'bangs', 'bangs2', 'bantuKnots', 'bear', 'bun', 'bun2', 'buns', 'cornrows', 'cornrows2',
  'dreads1', 'dreads2', 'flatTop', 'flatTopLong', 'grayBun', 'grayMedium', 'grayShort', 'hatBeanie',
  'hatHip', 'hijab', 'long', 'longAfro', 'longBangs', 'longCurly', 'medium1', 'medium2', 'medium3',
  'mediumBangs', 'mediumBangs2', 'mediumBangs3', 'mediumStraight', 'mohawk', 'mohawk2', 'noHair1',
  'noHair2', 'noHair3', 'pomp', 'shaved1', 'shaved2', 'shaved3', 'short1', 'short2', 'short3',
  'short4', 'short5', 'turban', 'twists', 'twists2',
] as const;

export const EXPRESSOES = [
  'angryWithFang', 'awe', 'blank', 'calm', 'cheeky', 'concerned', 'concernedFear', 'contempt',
  'cute', 'cyclops', 'driven', 'eatingHappy', 'explaining', 'eyesClosed', 'fear', 'hectic',
  'lovingGrin1', 'lovingGrin2', 'monster', 'old', 'rage', 'serious', 'smile', 'smileBig',
  'smileLOL', 'smileTeethGap', 'solemn', 'suspicious', 'tired', 'veryAngry',
] as const;

export const BARBAS = [
  'chin', 'full', 'full2', 'full3', 'full4', 'goatee1', 'goatee2', 'moustache1', 'moustache2',
  'moustache3', 'moustache4', 'moustache5', 'moustache6', 'moustache7', 'moustache8', 'moustache9',
] as const;

export const ACESSORIOS = [
  'eyepatch', 'glasses', 'glasses2', 'glasses3', 'glasses4', 'glasses5', 'sunglasses', 'sunglasses2',
] as const;

/** Tons de pele do próprio Open Peeps. */
export const PELES = ['#ffdbb4', '#edb98a', '#d08b5b', '#ae5d29', '#694d3d'] as const;

/** Cor da roupa. Inclui o amarelo da marca, que não vem no pacote. */
export const ROUPAS = ['#FCEC0E', '#8fa7df', '#78e185', '#ffcf77', '#e279c7', '#e78276', '#9ddadb', '#fdea6b'] as const;

/** Cor do cabelo. Só vale para os cabelos de `CABELO_COLORIVEL` — ver a nota lá embaixo. */
export const CABELOS = [
  '#2c1b18', '#e8e1e1', '#ecdcbf', '#d6b370', '#f59797', '#b58143', '#a55728', '#724133', '#4a312c', '#c93305',
] as const;

/**
 * Os ÚNICOS cabelos que respondem à cor (10 dos 48).
 *
 * No Open Peeps a maior parte do cabelo é traço, desenhado na cor da linha (o roxo da marca), e não
 * área preenchida. Só estes dez têm um preenchimento separado que o `headContrastColor` pinta — nos
 * outros 38 o seletor de cor existia e não mudava nada, que é pior que não existir: a pessoa clica,
 * não acontece nada, e conclui que o app está quebrado.
 *
 * A lista foi levantada gerando os 48 cabelos com duas cores diferentes e comparando o SVG, não da
 * documentação. Se o pacote subir de versão, vale refazer essa conferência.
 */
export const CABELO_COLORIVEL: readonly string[] = [
  'bangs', 'cornrows', 'grayBun', 'grayMedium', 'grayShort', 'mediumBangs2', 'mohawk', 'mohawk2',
  'noHair3', 'short4',
];

/**
 * As escolhas de uma pessoa. Barba e acessório são opcionais — `null` é "não tem", que é diferente
 * de "não escolhi": sem essa distinção, quem tirasse a barba veria o sorteio devolvê-la.
 */
export interface Avatar {
  head: string;
  expression: string;
  facialHair: string | null;
  accessories: string | null;
  skin: string;
  clothing: string;
  hair: string;
}

function umDe<T extends readonly string[]>(lista: T, valor: unknown): valor is T[number] {
  return typeof valor === 'string' && (lista as readonly string[]).includes(valor);
}

/**
 * Valida o que veio do cliente. Devolve `null` quando qualquer campo não bate — recusa inteira, e
 * não conserto campo a campo: um avatar meio aceito seria mais difícil de explicar que uma recusa.
 */
export function validarAvatar(bruto: unknown): Avatar | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const a = bruto as Record<string, unknown>;

  if (!umDe(CABECAS, a.head)) return null;
  if (!umDe(EXPRESSOES, a.expression)) return null;
  if (!umDe(PELES, a.skin)) return null;
  if (!umDe(ROUPAS, a.clothing)) return null;
  if (!umDe(CABELOS, a.hair)) return null;
  // Opcionais: ausente e null são a mesma coisa (o JSON de quem não tem barba pode vir dos dois
  // jeitos, dependendo de como o cliente serializou).
  const barba = a.facialHair ?? null;
  if (barba !== null && !umDe(BARBAS, barba)) return null;
  const acessorio = a.accessories ?? null;
  if (acessorio !== null && !umDe(ACESSORIOS, acessorio)) return null;

  return {
    head: a.head,
    expression: a.expression,
    facialHair: barba as string | null,
    accessories: acessorio as string | null,
    skin: a.skin,
    clothing: a.clothing,
    hair: a.hair,
  };
}
