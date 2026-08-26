import type { Env } from './env.js';

// Envio de e-mail transacional pela Resend.
//
// POR QUE UM PROVEDOR EXTERNO: o "Send Email" binding da Cloudflare só entrega em endereços
// VERIFICADOS da própria conta — serve pra alertar você mesma, não pra mandar um link de
// redefinição pro e-mail de um cliente qualquer. Alerta e e-mail transacional parecem o mesmo
// problema e não são; ver notify.ts, que resolve o primeiro por webhook e não precisa disto.
//
// CONSEQUÊNCIA A NÃO ESQUECER: a Resend passa a ser um OPERADOR DE DADOS (ela recebe o e-mail da
// pessoa). A declaração de tratamento de dados enviada à Meta diz que a Cloudflare é a única —
// precisa ser atualizada lá, acrescentando "Resend, Inc." como provedor de e-mail transacional.

const RESEND_API = 'https://api.resend.com/emails';

interface Enviar {
  para: string;
  assunto: string;
  html: string;
}

/**
 * Manda um e-mail. Devolve `false` quando não deu (e nunca lança).
 *
 * Nunca lançar é deliberado: quem chama são fluxos de autenticação e o poller. Uma falha de envio
 * não pode derrubar o cadastro de alguém nem a publicação de um post — o e-mail é sempre o item
 * menos importante da operação que o dispara.
 */
export async function enviarEmail(env: Env, { para, assunto, html }: Enviar): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    // Sem chave = envio desligado. Log em vez de silêncio: durante o desenvolvimento local isso é o
    // que mostra que o fluxo chegou até aqui, em vez de parecer que nada aconteceu.
    console.warn(`[email] RESEND_API_KEY ausente — não enviei "${assunto}" para ${para}`);
    return false;
  }

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // `atenta@` e não `nao-responda@`: quem recebe lê "ATENTA! <atenta@omangue.co>", com a marca
        // nas duas metades. O aviso de que a caixa não é monitorada vai no RODAPÉ do e-mail, onde é
        // lido de verdade — endereço de remetente é identidade, não lugar de instrução.
        //
        // O domínio segue omangue.co, que é o verificado na Resend. Trocar só o remetente pra outro
        // domínio desalinharia do link que o e-mail contém (atenta.omangue.co), e domínio
        // desalinhado entre remetente e link é justamente o padrão que filtro de spam persegue.
        from: env.EMAIL_FROM || 'ATENTA! <atenta@omangue.co>',
        to: [para],
        subject: assunto,
        html,
      }),
    });
    if (!res.ok) {
      // O corpo entra no log porque a Resend explica o motivo nele (domínio não verificado, chave
      // sem permissão, destinatário inválido) — sem isso, "não chegou o e-mail" vira adivinhação.
      console.error(`[email] Resend devolveu ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[email] falha ao chamar a Resend:', err);
    return false;
  }
}

/**
 * Moldura comum dos e-mails.
 *
 * HTML de e-mail não é HTML de página: cliente de e-mail ignora folha de estilo externa e boa parte
 * do CSS moderno, então tudo vai inline e a estrutura é deliberadamente simples. Sem imagem remota
 * (Gmail bloqueia por padrão) — a marca é texto.
 */
// O app roda aqui. Fixo em vez de derivado da requisição porque quem manda e-mail é o poller (que
// não tem requisição) e o better-auth (que tem, mas do lado do servidor) — e o link precisa apontar
// pra produção nos dois casos.
const APP_URL = 'https://atenta.omangue.co';

function moldura(titulo: string, corpo: string): string {
  return `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:24px;background:#f6f6f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111">
  <!-- A sombra deslocada do painel (web/design.md) é DESENHADA, não é box-shadow: o Gmail remove
       box-shadow da folha de estilo, e por isso a primeira versão chegava sem sombra nenhuma.
       Aqui a camada roxa é um elemento real, e o padding à direita e embaixo empurra o card branco
       pra cima e pra esquerda, deixando o roxo aparecer nos dois lados. Só background e padding,
       que é o que todo cliente de e-mail suporta, inclusive Outlook. -->
  <div style="max-width:526px;margin:0 auto;background:#52277F;border-radius:18px;padding:0 6px 6px 0">
  <div style="background:#fff;border:2px solid #52277F;border-radius:16px;padding:28px">
    <!-- Logo de verdade, servido pela nossa origem (está em LANDING_PUBLIC_ASSETS, então é público
         sem sessão). O Gmail bloqueia imagem remota por padrão, e é por isso que o atributo alt é o
         nome da marca: bloqueado, a pessoa lê "ATENTA!" no lugar, não um quadrado vazio. -->
    <img src="${APP_URL}/atenta-logoetipo.png" alt="ATENTA!" width="128" style="height:auto;display:block;margin-bottom:20px;font-weight:800;font-size:20px;color:#52277F">
    <h1 style="margin:0 0 14px;font-size:19px;line-height:1.3">${titulo}</h1>
    ${corpo}
  </div>
  </div>
  <p style="max-width:520px;margin:22px auto 0;font-size:12px;color:#666;text-align:center;line-height:1.6">
    Esta caixa não é monitorada, não responda a este e-mail.<br>
    Precisa falar com a gente? <a href="mailto:contato@omangue.co" style="color:#52277F;font-weight:600">contato@omangue.co</a><br><br>
    ATENTA!: agendamento e planejamento de feed.<br>
    Um produto do <a href="https://omangue.co" style="color:#52277F;font-weight:600">Estúdio Mangue</a>.
  </p>
</body></html>`;
}

function botao(href: string, rotulo: string): string {
  return `<a href="${href}" style="display:inline-block;background:#FCEC0E;color:#111;text-decoration:none;font-weight:700;padding:12px 22px;border:2px solid #52277F;border-radius:999px">${rotulo}</a>`;
}

export function emailRedefinirSenha(link: string): { assunto: string; html: string } {
  return {
    assunto: 'Redefinir sua senha do ATENTA!',
    html: moldura(
      'Redefinir sua senha',
      `<p style="margin:0 0 20px;line-height:1.6">Você pediu para criar uma senha nova. O link vale por 1 hora.</p>
       <p style="margin:0 0 20px">${botao(link, 'Criar senha nova')}</p>
       <p style="margin:0;font-size:13px;color:#666;line-height:1.6">Se não foi você que pediu, ignore este e-mail: sua senha continua a mesma.</p>`
    ),
  };
}

export function emailVagaLiberada(link: string): { assunto: string; html: string } {
  return {
    assunto: 'Sua vaga no ATENTA! está liberada',
    html: moldura(
      'Chegou a sua vez',
      `<p style="margin:0 0 20px;line-height:1.6">Abrimos uma vaga para você no ATENTA!. Crie sua conta com este mesmo e-mail:</p>
       <p style="margin:0 0 20px">${botao(link, 'Criar minha conta')}</p>
       <p style="margin:0;font-size:13px;color:#666;line-height:1.6">O plano gratuito não expira: 1 conta conectada e 5 posts por mês, sem cartão.</p>`
    ),
  };
}
