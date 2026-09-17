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

## Importação

Upload direto do navegador para o bucket privado `cifra-uploads` (RLS por pasta `<user_id>/…`). `startImport` cria o lote e dispara o processamento:

- **Com `INNGEST_EVENT_KEY`:** evento `import/batch.created` → função `process-import` (rota `/api/inngest`), que lê o arquivo com `SUPABASE_SERVICE_ROLE_KEY`. Em dev, rode `npx inngest-cli@latest dev` para receber os eventos.
- **Sem a chave:** o processamento roda logo após a resposta (`after()`), no próprio servidor, com a sessão do usuário.

PDF é lido pelo modelo (`ai/client.ts`, exige `ANTHROPIC_API_KEY`): com camada de texto, o texto vai redigido de PII; sem ela, o PDF vai como documento ao modelo visual. A validação de saldo roda em código (abertura + soma = fechamento); linha com confiança abaixo de 0,80 fica destacada e fora da seleção padrão.

Pipeline: parser determinístico (OFX, CSV com mapeador) ou IA (PDF) → dedup em 3 níveis (identificador do banco → fingerprint → fuzzy ±3 dias) → conciliação com previsões → sugestão de categoria pela memória de comerciante → validação de saldo (OFX) → revisão. Confirmar cria tudo numa transação só; desfazer remove o que o lote criou.

## Convenções de dados

- **`amount` tem sinal do ponto de vista da conta**: despesa e transferência negativas, receita positiva (checks no banco).
- **Saldo da conta é derivado** por trigger; nenhum handler escreve `current_balance`.
- **RLS vale no Prisma**: todo acesso de request passa por `forUser(userId, tx => …)`, que roda a transação como `authenticated` com `auth.uid()` do usuário. O cliente `db` cru é só para migration, seed e testes.

## Estado (fase 1)

As 14 tarefas da especificação estão implementadas: setup, schema com RLS, dinheiro e datas, CRUD com desfazer, parcelamento e recorrência, dashboard, importação OFX/CSV/PDF, camada de IA, OCR de comprovante, categorização em cascata com regras, metas e patrimônio, insights e assistente. O que depende de `ANTHROPIC_API_KEY` (PDF, comprovante, nível LLM da categorização, assistente) foi testado com provedor falso; a tela avisa quando a chave não está configurada.

Fora da fase 1, como a spec pede: multi-moeda, compartilhamento, app nativo, orçamento por envelope, Open Finance. Também ficaram para depois: importação XLSX, fila Inngest em produção (código pronto, exige chaves), embeddings para o nível 3 da categorização (hoje trigramas).

## Decisões que divergem da especificação

- **Supabase Auth no lugar do Clerk.** A RLS usa `auth.uid()` nativo; as variáveis `CLERK_*` e o webhook do Clerk saíram.
- **Prisma 6 no lugar do 5.** O CLI do Prisma 5 quebra no Node 23+ (`util.isError` removido).
- **Tailwind v4.** O mapeamento de `tailwind.config.ts` da spec vive em `@theme` dentro do CSS gerado; os nomes de classe são os mesmos (`bg-surface-raised`, `text-ink-secondary`, `bg-brand`, `text-brand-on`).
- **Design tokens são gerados, não copiados.** Mudou o `tokens.json` do Design System, rode `npm run tokens`; um teste falha se o CSS versionado estiver desatualizado.
- **Primeira parcela é o registro-pai** (a spec dizia "pai + N filhos"): evita contar o total duas vezes nos agregados.
- **Nível 3 da categorização usa `pg_trgm`** (vizinhos por trigramas e palavras) no lugar de embeddings + pgvector: a Anthropic não oferece embeddings e isso evitaria um segundo provedor. Trocável.
- **Texto dos insights sai de template**, com os números das queries; o modelo não redige (não há como ele inventar número). Se quiser a redação pelo modelo, o lugar é `lib/insights.ts`, mantendo os números como placeholders.
- **Recorrência é materializada ao abrir o mês**, sem fila; a fila Inngest existe só para importação.
