import { useEffect, useState } from 'react';
import type { Style } from '@dicebear/core';

// O avatar do usuário, desenhado no navegador.
//
// POR QUE GERAR EM VEZ DE GUARDAR: a versão anterior subia uma foto pro R2 (upload, cota, purge,
// endpoint) só pra pintar uma bolinha de 20px no cabeçalho. Aqui o servidor guarda ~140 bytes de
// escolhas (migração 0020) e o desenho é montado aqui, sem rede e sem armazenamento.
//
// Open Peeps é CC0 (Pablo Stanley — o mesmo autor dos doodles da landing, ver web/doodles-license.md),
// então convive com a linguagem visual que o site já usa em vez de introduzir um segundo traço.
//
// POR QUE TUDO VEM POR IMPORT DINÂMICO: o open-peeps.json tem 244 KB (94 KB gzipado) e o core do
// DiceBear mais 29 KB, contra 220 KB gzipado do bundle inteiro do app. Embutir custaria mais de
// 50% de download a TODA visita pra desenhar uma bolinha de 20px. Assim os dois viram um chunk
// separado, buscado depois do primeiro quadro e guardado em cache pelo navegador — enquanto não
// chega, quem desenha é a inicial do nome.
//
// O `import type` acima não conta: tipo é apagado na compilação e não puxa o pacote pro bundle.

import type { Avatar } from '../../../src/lib/avatar';
export type { Avatar } from '../../../src/lib/avatar';
export {
  CABECAS,
  EXPRESSOES,
  BARBAS,
  ACESSORIOS,
  PELES,
  ROUPAS,
  CABELOS,
  CABELO_COLORIVEL,
} from '../../../src/lib/avatar';
import { ACESSORIOS, BARBAS, CABECAS, CABELOS, EXPRESSOES, PELES, ROUPAS } from '../../../src/lib/avatar';

/** O core e o estilo, juntos. Uma promessa só por sessão: quem pedir depois reaproveita. */
type Motor = { Avatar: typeof import('@dicebear/core').Avatar; estilo: Style };
let motorPendente: Promise<Motor> | null = null;

function carregarMotor(): Promise<Motor> {
  motorPendente ??= Promise.all([
    import('@dicebear/core'),
    import('@dicebear/styles/open-peeps.json'),
  ]).then(([core, def]) => ({
    Avatar: core.Avatar,
    estilo: new core.Style((def.default ?? def) as never),
  }));
  return motorPendente;
}

function montar(motor: Motor, avatar: Avatar, size: number): string {
  // A chave OMITIDA e a chave presente valendo `undefined` NÃO são a mesma coisa aqui: o validador
  // do DiceBear rejeita a segunda, e — pior — reporta o erro apontando para OUTRO campo
  // (`/headVariant has an invalid type`), o que manda quem for depurar pro lugar errado. Daí montar
  // o objeto por partes em vez de escrever `x ? [...] : undefined` no literal.
  const opcoes: Record<string, unknown> = {
    size,
    // Todas as variantes vêm fixadas, então a semente não sorteia nada. Ela só precisa existir.
    seed: 'atenta',
    // O enquadramento sobe um pouco em vez de aproximar.
    //
    // Aproximar (scale) parecia o caminho pra tirar o anel branco do círculo, mas cortava os OMBROS
    // — e a cor da roupa é uma das coisas que a pessoa escolhe no diálogo. Recorte que engole uma
    // opção de personalização transforma o controle em enfeite, igual à cor de cabelo que só valia
    // pra 10 dos 48 cabelos.
    //
    // translateY negativo sobe o desenho, então entra mais da parte de baixo: cabeça inteira em
    // cima, gola e roupa aparecendo embaixo. O espaço em branco quem resolve é o botão, que agora
    // é do tamanho do avatar (ver App.tsx), não o zoom.
    translateY: -8,
    // `<componente>Variant` é a convenção do DiceBear v10 (no v9 era o nome do componente puro).
    // Passar `head` em vez de `headVariant` não é ignorado: o validador LANÇA, então uma
    // atualização de major do pacote aparece como erro em vez de avatar errado em silêncio.
    headVariant: [avatar.head],
    expressionVariant: [avatar.expression],
    // A probabilidade é quem liga e desliga a peça: a lista sozinha não basta, porque barba e
    // acessório nascem opcionais (10% e 20% no estilo original).
    facialHairProbability: avatar.facialHair ? 100 : 0,
    accessoriesProbability: avatar.accessories ? 100 : 0,
    // Sem máscara: é resquício de 2020 e não é escolha que alguém queira no próprio perfil.
    maskProbability: 0,
    // As cores vão SEM o `#` — o DiceBear as recebe como hex cru.
    skinColor: [avatar.skin.replace('#', '')],
    clothingColor: [avatar.clothing.replace('#', '')],
    headContrastColor: [avatar.hair.replace('#', '')],
  };
  if (avatar.facialHair) opcoes.facialHairVariant = [avatar.facialHair];
  if (avatar.accessories) opcoes.accessoriesVariant = [avatar.accessories];

  return new motor.Avatar(motor.estilo, opcoes as never).toDataUri();
}

/**
 * O avatar como data URI (serve direto num `src=`), ou `null` enquanto o estilo não chegou.
 *
 * O `null` é estado de CARREGANDO, não de "sem avatar": quem chama desenha a inicial nesse
 * intervalo. Fora do primeiro uso da sessão ele é praticamente instantâneo, porque o chunk fica
 * em cache.
 */
export function useAvatarUri(avatar: Avatar | null, size = 96): string | null {
  const [uri, setUri] = useState<string | null>(null);
  // A identidade do objeto muda a cada render do diálogo (é estado local), então o efeito depende
  // do CONTEÚDO — senão ele redispara sem parar enquanto a pessoa mexe nos controles.
  const chave = avatar ? JSON.stringify(avatar) + size : '';

  useEffect(() => {
    if (!avatar) {
      setUri(null);
      return;
    }
    let vivo = true;
    carregarMotor()
      .then((motor) => {
        if (vivo) setUri(montar(motor, avatar, size));
      })
      .catch(() => {
        // Sem o chunk não há avatar, e a inicial do nome cobre o caso. Não vale um toast: é
        // decoração, e um erro visível aqui assustaria mais do que informa.
        if (vivo) setUri(null);
      });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  return uri;
}

/** Índice estável a partir de um texto — é o que dá a cada pessoa um peep próprio e sempre igual. */
function indiceDe(semente: string, sal: number, tamanho: number): number {
  let h = 2166136261 ^ sal;
  for (let i = 0; i < semente.length; i++) {
    h ^= semente.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % tamanho;
}

/**
 * O avatar de quem ainda não personalizou, derivado do id do usuário.
 *
 * Ninguém fica sem rosto: antes, sem foto, o cabeçalho mostrava a inicial num círculo amarelo, que
 * é igual pra todo mundo com a mesma letra. Um peep derivado do id é distinto por pessoa, estável
 * entre sessões e já é um ponto de partida pra personalizar em vez de uma tela em branco.
 *
 * Sem barba e sem acessório de propósito: são os dois traços mais específicos, e chutá-los pra
 * alguém que não escolheu erra mais do que acerta.
 */
export function avatarPadrao(userId: string): Avatar {
  return {
    head: CABECAS[indiceDe(userId, 1, CABECAS.length)],
    expression: EXPRESSOES[indiceDe(userId, 2, EXPRESSOES.length)],
    facialHair: null,
    accessories: null,
    skin: PELES[indiceDe(userId, 3, PELES.length)],
    clothing: ROUPAS[indiceDe(userId, 4, ROUPAS.length)],
    hair: CABELOS[indiceDe(userId, 5, CABELOS.length)],
  };
}

/**
 * O avatar a desenhar pra este usuário: o que ele escolheu, ou o padrão do id.
 *
 * O JSON quebrado cai no padrão em vez de lançar: o avatar é decoração de cabeçalho, e derrubar a
 * tela inteira por causa dele seria desproporcional.
 */
export function avatarDoUsuario(user: { id: string; avatar?: string | null }): Avatar {
  if (user.avatar) {
    try {
      return JSON.parse(user.avatar) as Avatar;
    } catch {
      /* cai no padrão */
    }
  }
  return avatarPadrao(user.id);
}

/** Um avatar completamente aleatório, pro botão "Sortear" do diálogo. */
export function avatarSorteado(): Avatar {
  const um = <T,>(lista: readonly T[]): T => lista[Math.floor(Math.random() * lista.length)];
  return {
    head: um(CABECAS),
    expression: um(EXPRESSOES),
    // Barba e acessório entram em parte dos sorteios, não em todos: sempre presentes cansam, nunca
    // presentes escondem que a opção existe.
    facialHair: Math.random() < 0.35 ? um(BARBAS) : null,
    accessories: Math.random() < 0.35 ? um(ACESSORIOS) : null,
    skin: um(PELES),
    clothing: um(ROUPAS),
    hair: um(CABELOS),
  };
}

export async function salvarAvatar(avatar: Avatar): Promise<void> {
  const res = await fetch('/api/profile/avatar', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(avatar),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(json?.error ?? 'não foi possível salvar o avatar');
  }
}
