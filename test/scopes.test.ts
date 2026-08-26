import { describe, expect, it } from 'vitest';
import { metricsReady, missingMetricsScopes, METRICS_SCOPES } from '../src/lib/scopes.js';

// O post_metrics ficou ZERADO por semanas sem ninguém perceber: o coletor batia num erro de
// permissão e voltava vazio, e vazio é indistinguível de "esse post ainda não tem números".
// Estas regras são o que transforma aquele silêncio num aviso na tela.

describe('metricsReady', () => {
  it('escopo completo libera', () => {
    expect(metricsReady('instagram', 'instagram_basic,instagram_manage_insights')).toBe(true);
  });

  it('escopo incompleto denuncia — o caso que passou despercebido', () => {
    expect(metricsReady('instagram', 'instagram_basic,instagram_content_publish')).toBe(false);
    expect(missingMetricsScopes('instagram', 'instagram_basic')).toEqual(['instagram_manage_insights']);
  });

  it('escopo NÃO registrado recebe benefício da dúvida', () => {
    // Contas conectadas antes de existir a gravação. Marcá-las como quebradas encheria a tela de
    // avisos falsos sobre um problema que talvez nem exista.
    expect(metricsReady('instagram', null)).toBe(true);
    expect(missingMetricsScopes('instagram', null)).toEqual([]);
  });

  it('separador não importa: Google usa espaço, os outros usam vírgula', () => {
    const google = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';
    expect(metricsReady('youtube', google)).toBe(true);
    expect(metricsReady('youtube', google.replace(' ', ','))).toBe(true);
    // E sem o readonly, acusa.
    expect(metricsReady('youtube', 'https://www.googleapis.com/auth/youtube.upload')).toBe(false);
  });

  it('rede sem coleta de métrica nunca reclama', () => {
    // LinkedIn não expõe analytics de post orgânico fora do programa de parceiros — um aviso ali
    // seria sobre algo que a pessoa não tem como resolver.
    expect(METRICS_SCOPES.linkedin).toEqual([]);
    expect(metricsReady('linkedin', 'openid profile w_member_social')).toBe(true);
    expect(metricsReady('pinterest', 'boards:read')).toBe(true);
  });

  it('cada rede com coleta exige exatamente o escopo que a coleta usa', () => {
    expect(METRICS_SCOPES.instagram).toContain('instagram_manage_insights');
    expect(METRICS_SCOPES.tiktok).toContain('video.list');
    expect(METRICS_SCOPES.youtube).toContain('https://www.googleapis.com/auth/youtube.readonly');
  });

  // Três redes ficam com a lista VAZIA, e nenhuma por esquecimento.
  //
  // Facebook: a métrica funciona SEM escopo de insights (curtidas, comentários e compartilhamentos
  // vêm dos campos do post). Exigir `read_insights` aqui — como era até 2026-08-05 — marcaria toda
  // conta como quebrada sendo que ela não está.
  //
  // LinkedIn e Pinterest: não há coleta possível (o LinkedIn não expõe analytics de post orgânico
  // fora do programa de parceiros; a do Pinterest nunca foi implementada). Sem promessa, sem
  // cobrança.
  it('redes sem coleta possível não marcam conta nenhuma como incompleta', () => {
    for (const rede of ['facebook', 'linkedin', 'pinterest'] as const) {
      expect(METRICS_SCOPES[rede], `${rede} deveria ter lista vazia`).toEqual([]);
      expect(metricsReady(rede, 'qualquer,escopo,concedido'), `${rede} não pode ser marcada`).toBe(true);
      expect(missingMetricsScopes(rede, 'qualquer')).toEqual([]);
    }
  });

  // O Facebook não exige escopo nenhum pra métrica: curtidas, comentários e compartilhamentos vêm
  // dos CAMPOS do post. Exigir `read_insights` aqui (como era até 2026-08-05) marcaria toda conta
  // como "não traz métrica" e mostraria um aviso insolúvel — o escopo saiu do pedido porque nunca
  // devolveu dado e a Meta passou a recusá-lo (ver oauth-urls.ts).
  it('Facebook não exige escopo pra métrica, então conta nenhuma é marcada como incompleta', () => {
    expect(METRICS_SCOPES.facebook).toEqual([]);
    expect(metricsReady('facebook', 'pages_show_list,pages_manage_posts')).toBe(true);
    expect(missingMetricsScopes('facebook', 'pages_show_list')).toEqual([]);
  });
});
