# Cifra

Finanças pessoais ingestão-primeiro: extratos e comprovantes entram, lançamentos categorizados e conciliados saem.

## Rodando

```bash
cp .env.example .env   # preencha com as chaves do projeto Supabase
npm install            # roda prisma generate
npm run dev
```

No Supabase, em Authentication → URL Configuration, inclua `http://localhost:3000/auth/callback` nas Redirect URLs.

## Scripts

| Script | O que faz |
| --- | --- |
| `npm run tokens` | Regera `src/styles/tokens.css` a partir de `design-system/tokens.json` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest (unitários) |
| `npm run test:e2e` | Playwright em desktop e 390px. Os fluxos logados usam `E2E_EMAIL`/`E2E_PASSWORD` (um usuário do projeto de dev); sem eles, são pulados |

Os testes de integração (`*.test.ts` em `src/server`) rodam contra o banco do `.env` e criam/apagam usuários próprios em `auth.users`; sem `DATABASE_URL`, são pulados.

## Convenções de dados

- **`amount` tem sinal do ponto de vista da conta**: despesa e transferência negativas, receita positiva (checks no banco).
- **Saldo da conta é derivado** por trigger; nenhum handler escreve `current_balance`.
- **RLS vale no Prisma**: todo acesso de request passa por `forUser(userId, tx => …)`, que roda a transação como `authenticated` com `auth.uid()` do usuário. O cliente `db` cru é só para migration, seed e testes.

## Decisões que divergem da especificação

- **Supabase Auth no lugar do Clerk.** A RLS usa `auth.uid()` nativo; as variáveis `CLERK_*` e o webhook do Clerk saíram.
- **Prisma 6 no lugar do 5.** O CLI do Prisma 5 quebra no Node 23+ (`util.isError` removido).
- **Tailwind v4.** O mapeamento de `tailwind.config.ts` da spec vive em `@theme` dentro do CSS gerado; os nomes de classe são os mesmos (`bg-surface-raised`, `text-ink-secondary`, `bg-brand`, `text-brand-on`).
- **Design tokens são gerados, não copiados.** Mudou o `tokens.json` do Design System, rode `npm run tokens`; um teste falha se o CSS versionado estiver desatualizado.
