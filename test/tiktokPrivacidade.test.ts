import { describe, expect, it } from 'vitest';
import { escolherPrivacidade } from '../src/adapters/tiktok.js';

// A auditoria da Content Posting API foi aprovada em 18/08/2026. Antes dela o creator_info só
// oferecia SELF_ONLY, então "pega o primeiro da lista" dava no mesmo; depois dela, não dá mais.
describe('escolha de privacidade do TikTok', () => {
  it('prefere PUBLIC_TO_EVERYONE mesmo quando ela não é a primeira da lista', () => {
    // O caso que importa: a TikTok não promete ordem em privacy_level_options. Pegando o índice 0,
    // uma conta que devolvesse SELF_ONLY primeiro publicaria pra ninguém, sem erro nenhum no painel.
    expect(escolherPrivacidade(undefined, ['SELF_ONLY', 'MUTUAL_FOLLOW_FRIENDS', 'PUBLIC_TO_EVERYONE'])).toBe(
      'PUBLIC_TO_EVERYONE'
    );
  });

  it('cai no primeiro disponível quando a conta não oferece a pública', () => {
    expect(escolherPrivacidade(undefined, ['SELF_ONLY', 'MUTUAL_FOLLOW_FRIENDS'])).toBe('SELF_ONLY');
  });

  it('respeita a privacidade que o post pediu', () => {
    expect(escolherPrivacidade('SELF_ONLY', ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'])).toBe('SELF_ONLY');
  });

  it('recusa uma privacidade que a conta não oferece, antes de subir o vídeo', () => {
    // A TikTok recusaria do lado dela de qualquer jeito. Recusar aqui economiza o upload inteiro.
    expect(() => escolherPrivacidade('PUBLIC_TO_EVERYONE', ['SELF_ONLY'])).toThrow(/não é oferecida/);
    try {
      escolherPrivacidade('PUBLIC_TO_EVERYONE', ['SELF_ONLY']);
    } catch (err) {
      // O código é o que faz o classifyError tratar isso como permanente em vez de retentar.
      expect((err as { code?: string }).code).toBe('privacy_level_option_mismatch');
    }
  });

  it('lista vazia é erro, não silêncio', () => {
    expect(() => escolherPrivacidade(undefined, [])).toThrow(/privacy_level_options/);
  });
});
