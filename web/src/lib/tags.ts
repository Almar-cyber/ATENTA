import type { Tag } from './api';

/**
 * A paleta dos pilares de conteúdo.
 *
 * POR QUE HEX AQUI, se `web/design.md` proíbe cor solta. A regra existe pra impedir que cor de UI
 * escape do tema — e a exceção documentada é `PLATFORM_COLORS`, pela mesma razão que vale aqui:
 * estes tons não significam nada no sistema (não são "perigo", "sucesso" ou "primário"), eles só
 * precisam ser DISTINGUÍVEIS entre si. Não existe token semântico pra "o terceiro pilar".
 *
 * Elas vivem num mapa fechado, e o banco guarda a CHAVE ('roxo'), nunca o hex — por isso mudar a
 * paleta um dia é editar este arquivo, não reescrever linha nenhuma.
 *
 * Seis, e não vinte: pilar de conteúdo é um punhado por perfil. Uma paleta grande convida a criar
 * pilares demais, e pilar demais é o mesmo que nenhum — a amostra de cada um fica pequena e o
 * Insights não consegue dizer nada sobre nenhum.
 *
 * `fg` é sempre o texto por cima do `bg` cheio; escolhidos pra ficarem legíveis nos dois temas.
 */
export const TAG_COLORS = {
  roxo: { bg: 'oklch(0.45 0.16 300)', fg: 'oklch(0.99 0 0)', label: 'Roxo' },
  verde: { bg: 'oklch(0.52 0.13 155)', fg: 'oklch(0.99 0 0)', label: 'Verde' },
  azul: { bg: 'oklch(0.52 0.15 250)', fg: 'oklch(0.99 0 0)', label: 'Azul' },
  laranja: { bg: 'oklch(0.62 0.16 55)', fg: 'oklch(0.15 0 0)', label: 'Laranja' },
  rosa: { bg: 'oklch(0.58 0.19 5)', fg: 'oklch(0.99 0 0)', label: 'Rosa' },
  ciano: { bg: 'oklch(0.58 0.11 200)', fg: 'oklch(0.15 0 0)', label: 'Ciano' },
} as const;

export type TagColor = keyof typeof TAG_COLORS;

export const TAG_COLOR_KEYS = Object.keys(TAG_COLORS) as TagColor[];

/** Cor de uma tag, com queda pro primeiro tom se o banco trouxer uma chave desconhecida. */
export function tagColor(tag: Pick<Tag, 'color'>): (typeof TAG_COLORS)[TagColor] {
  return TAG_COLORS[tag.color as TagColor] ?? TAG_COLORS.roxo;
}

/**
 * A cor que uma tag NOVA recebe: a primeira ainda não usada.
 *
 * Sortear repetiria tons e deixaria dois pilares indistinguíveis logo no terceiro — que é
 * exatamente quando a cor começa a ser útil.
 */
export function proximaCor(existentes: Tag[]): TagColor {
  const usadas = new Set(existentes.map((t) => t.color));
  return TAG_COLOR_KEYS.find((c) => !usadas.has(c)) ?? TAG_COLOR_KEYS[existentes.length % TAG_COLOR_KEYS.length];
}
