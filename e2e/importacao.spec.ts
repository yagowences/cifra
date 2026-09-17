import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/** Importação OFX de ponta a ponta; requer E2E_EMAIL/E2E_PASSWORD (ver README). */
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.skip(!email || !password, "E2E_EMAIL e E2E_PASSWORD não definidos");

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("E-mail").fill(email!);
  await page.getByLabel("Senha").fill(password!);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/$/, { timeout: 60_000 });
}

const fixture = path.join(__dirname, "fixtures", "extrato-teste.ofx");

test("importar OFX, revisar, confirmar; importar de novo só mostra duplicatas; desfazer", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page);

  // 1ª importação
  await page.goto("/importar");
  await page.getByTestId("arquivo").setInputFiles(fixture);
  await page.getByRole("button", { name: "Ler lançamentos" }).click();
  await page.waitForURL(/\/importar\/[a-z0-9]+$/, { timeout: 60_000 });

  const rows = page.getByTestId("linha-revisao");
  await expect(rows).toHaveCount(3, { timeout: 60_000 });
  await expect(page.getByText("3 lançamentos lidos")).toBeVisible();
  await expect(page.getByRole("button", { name: /Importar 3 lançamentos/ })).toBeVisible();
  await page.getByRole("button", { name: /Importar 3 lançamentos/ }).click();
  await page.waitForURL(/\/transacoes/, { timeout: 60_000 });
  await expect(page.getByTestId("linha-transacao").filter({ hasText: "POSTO BR 1042 GOIANIA" })).toBeVisible({ timeout: 30_000 });

  // 2ª importação do mesmo arquivo: tudo duplicata, nada a importar.
  await page.goto("/importar");
  await page.getByTestId("arquivo").setInputFiles(fixture);
  await page.getByRole("button", { name: "Ler lançamentos" }).click();
  await page.waitForURL(/\/importar\/[a-z0-9]+$/, { timeout: 60_000 });
  await expect(rows).toHaveCount(3, { timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Duplicatas · 3" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Importar 0 lançamentos/ })).toBeDisabled();

  // Desfaz a primeira importação para deixar o banco como estava.
  await page.goto("/importar");
  await page.getByRole("button", { name: "Desfazer" }).first().click();
  await expect(page.getByText("Importação desfeita")).toBeVisible({ timeout: 30_000 });
  await page.goto("/transacoes");
  await expect(page.getByTestId("linha-transacao").filter({ hasText: "POSTO BR 1042 GOIANIA" })).toHaveCount(0, { timeout: 30_000 });
});
