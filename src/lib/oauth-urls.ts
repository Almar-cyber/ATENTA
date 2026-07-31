// Construção das URLs de consentimento OAuth, compartilhada entre o Worker (endpoint /api/connect)
// e os CLIs de auth-url (src/cli/*-auth-url.ts). Só usa `URL`/`URLSearchParams`, disponíveis tanto
// no Worker quanto no Node, então não há dependência de ambiente aqui.
//
// YouTube fica de fora: usa fluxo loopback local (cli/youtube-auth.ts), não passa pelo Worker.

export type OAuthPlatform = 'linkedin' | 'meta' | 'pinterest' | 'tiktok';

export const OAUTH_PLATFORMS: readonly OAuthPlatform[] = ['linkedin', 'meta', 'pinterest', 'tiktok'];

export function isOAuthPlatform(p: string): p is OAuthPlatform {
  return (OAUTH_PLATFORMS as readonly string[]).includes(p);
}

// Nome da variável de ambiente / secret do Worker que guarda o client id de cada rede.
export const OAUTH_CLIENT_ID_ENV: Record<OAuthPlatform, string> = {
  linkedin: 'LINKEDIN_CLIENT_ID',
  meta: 'META_APP_ID',
  pinterest: 'PINTEREST_CLIENT_ID',
  tiktok: 'TIKTOK_CLIENT_KEY',
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
        'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,business_management'
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
    case 'tiktok': {
      const u = new URL('https://www.tiktok.com/v2/auth/authorize/');
      u.searchParams.set('client_key', clientId); // TikTok chama de client_key, mesmo valor
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('scope', 'user.info.basic,video.publish,video.upload');
      u.searchParams.set('redirect_uri', redirectUri);
      u.searchParams.set('state', state);
      return u.toString();
    }
  }
}
