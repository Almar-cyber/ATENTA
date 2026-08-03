import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Runs the tests inside workerd via Miniflare, against a real (in-memory) D1 — the poller's whole
// job is SQL, and the defects this suite guards against were bad SQL and unread columns that a
// mocked database would have happily accepted.
export default defineConfig({
  plugins: [
    cloudflareTest({
      singleWorker: true,
      miniflare: {
        compatibilityDate: '2026-07-01',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: { DB: 'test-db' },
        r2Buckets: ['MEDIA'],
        // O binding de static assets (o SPA React) não existe nos testes de Worker. Um stub que
        // devolve index.html cobre o fall-through: rotas que não são /api, /oauth nem /privacy vão
        // pro SPA, que faz o roteamento no cliente — não são mais 404 como eram antes do dashboard.
        serviceBindings: {
          ASSETS: () => new Response('<!doctype html><title>SPA</title>', { headers: { 'Content-Type': 'text/html' } }),
        },
        bindings: {
          // A real 32-byte AES-256 key (all 0x07). Only the auth-classification test encrypts
          // anything with it; nothing here talks to a real platform.
          TOKEN_ENCRYPTION_KEY: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=',
          // Assina os cookies de sessão nos testes de isolação, que criam contas de verdade
          // pelo /api/auth. Valor fixo e público de propósito: é um banco em memória.
          AUTH_SECRET: 'chave-de-teste-nao-usar-em-producao-0000',
        },
      },
    }),
  ],
});
