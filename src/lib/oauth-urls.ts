// Construção das URLs de consentimento OAuth, compartilhada entre o Worker (endpoint /api/connect)
// e os CLIs de auth-url (src/cli/*-auth-url.ts). Só usa `URL`/`URLSearchParams`, disponíveis tanto
// no Worker quanto no Node, então não há dependência de ambiente aqui.
//
// YouTube fica de fora: usa fluxo loopback local (cli/youtube-auth.ts), não passa pelo Worker.

export type OAuthPlatform = 'linkedin' | 'meta' | 'pinterest' | 'tiktok' | 'youtube';

export const OAUTH_PLATFORMS: readonly OAuthPlatform[] = ['linkedin', 'meta', 'pinterest', 'tiktok', 'youtube'];

export function isOAuthPlatform(p: string): p is OAuthPlatform {
  return (OAUTH_PLATFORMS as readonly string[]).includes(p);
}

// Nome da variável de ambiente / secret do Worker que guarda o client id de cada rede.
export const OAUTH_CLIENT_ID_ENV: Record<OAuthPlatform, string> = {
  linkedin: 'LINKEDIN_CLIENT_ID',
  meta: 'META_APP_ID',
  pinterest: 'PINTEREST_CLIENT_ID',
  tiktok: 'TIKTOK_CLIENT_KEY',
  youtube: 'YOUTUBE_CLIENT_ID',
};

export interface AuthUrlParams {
  clientId: string;
  redirectUri: string;
  state: string;
}

export function buildAuthUrl(platform: OAuthPlatform, { clientId, redirectUri, state }: AuthUrlParams): string {
  switch (platform) {
    case 'linkedin': {
      const u = new URL('https://www.linkedin.com/oauth/v2/authorization');
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('client_id', clientId);
      u.searchParams.set('redirect_uri', redirectUri);
      u.searchParams.set('state', state);
      u.searchParams.set('scope', 'openid profile w_member_social');
      return u.toString();
    }
    case 'meta': {
      const u = new URL('https://www.facebook.com/v21.0/dialog/oauth');
      u.searchParams.set('client_id', clientId);
      u.searchParams.set('redirect_uri', redirectUri);
      u.searchParams.set('state', state);
      u.searchParams.set(
        'scope',
        // Cada escopo aqui precisa ter uma chamada que o justifique — o App Review da Meta reprova
        // app que pede permissão sem demonstrar uso, e cada uma some num caso de uso a defender:
        //   pages_show_list          → GET /me/accounts (listar as Páginas pra você escolher)
        //   pages_read_engagement    → ler nome/id da Página conectada
        //   pages_manage_posts       → POST /{page}/photos e /{page}/feed (publicar no Facebook)
        //   instagram_basic          → achar o instagram_business_account da Página e o @username
        //   instagram_content_publish→ POST /{ig}/media e /{ig}/media_publish
        //   instagram_manage_insights→ insights do post + followers_count
        //   read_insights            → post_impressions da Página
        //
        //   business_management    → GET /me/accounts ENXERGAR Página de Portfólio de Negócios
        //
        // Sobre o business_management: eu o removi por um raciocínio errado — "não chamamos
        // /businesses, logo não usamos". A chamada direta de fato não existe, mas ele é
        // pré-requisito para o /me/accounts LISTAR Página que pertence a um Portfólio de Negócios,
        // e sem ele a resposta vem vazia mesmo com pages_show_list concedido.
        //
        // A prova veio de uma comparação controlada, quando a primeira testadora não conseguiu
        // conectar: token com business_management devolveu 2 Páginas; token sem, 0 — os dois com
        // pages_show_list. Contas antigas não sentiram porque o Facebook re-concede permissão já
        // autorizada; só quem conectou DEPOIS da remoção passou pelo caminho quebrado.
        //
        // Lição: "não há chamada explícita" não é prova de que uma permissão não é usada. Algumas
        // são pré-requisito de VISIBILIDADE em endpoints que já chamamos.
        //
        // Escopo novo só tem efeito ao (re)conectar: conta já conectada precisa passar pelo
        // consentimento de novo pra ganhá-lo.
        'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,instagram_manage_insights,read_insights,business_management'
      );
      return u.toString();
    }
    case 'pinterest': {
      const u = new URL('https://www.pinterest.com/oauth/');
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('client_id', clientId);
      u.searchParams.set('redirect_uri', redirectUri);
      u.searchParams.set('state', state);
      u.searchParams.set('scope', 'boards:read,pins:read,pins:write');
      return u.toString();
    }
    case 'youtube': {
      const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      u.searchParams.set('client_id', clientId);
      u.searchParams.set('redirect_uri', redirectUri);
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('scope', 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly');
      // offline + consent garantem que venha refresh_token (o adapter precisa dele pra renovar).
      u.searchParams.set('access_type', 'offline');
      u.searchParams.set('prompt', 'consent');
      u.searchParams.set('state', state);
      return u.toString();
    }
    case 'tiktok': {
      const u = new URL('https://www.tiktok.com/v2/auth/authorize/');
      u.searchParams.set('client_key', clientId); // TikTok chama de client_key, mesmo valor
      u.searchParams.set('response_type', 'code');
      // video.list é o escopo do endpoint /v2/video/query/ (métricas de post). Pedimos junto pra
      // que, quando a auditoria da Content Posting API aprovar, o Insights do TikTok funcione
      // reconectando 1x só — sem esse escopo o coletor bate em 401 mesmo aprovado.
      u.searchParams.set('scope', 'user.info.basic,video.publish,video.upload,video.list');
      u.searchParams.set('redirect_uri', redirectUri);
      u.searchParams.set('state', state);
      // TikTok exige vírgula literal no scope, não %2C — URLSearchParams codifica por padrão.
      // Só esse parâmetro tem vírgula, então o replace global é seguro.
      return u.toString().replace(/%2C/g, ',');
    }
  }
}
