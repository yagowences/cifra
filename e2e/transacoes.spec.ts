import { expect, test, type Page } from "@playwright/test";

/**
 * Fluxo completo de lançamento contra o banco de dev, com o usuário de teste.
 * Requer E2E_EMAIL e E2E_PASSWORD no ambiente (ver README); sem eles, pula.
 */
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

test("criar, editar, excluir e desfazer um lançamento", async ({ page }) => {
  await signIn(page);
  const description = `E2E ${Date.now()}`;

  await page.goto("/transacoes");
  await page.getByRole("button", { name: "Novo lançamento" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("0,00").fill("48,90");
  await dialog.getByPlaceholder("Ex.: Padaria, Uber, Salário").fill(description);
  await dialog.getByRole("button", { name: "Salvar" }).click();

  const row = page.getByTestId("linha-transacao").filter({ hasText: description });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText("− 48,90");

  // Editar o valor.
  await row.click();
  await dialog.getByPlaceholder("0,00").fill("50,00");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(row).toContainText("− 50,00", { timeout: 30_000 });

  // Excluir e desfazer.
  await row.click();
  await dialog.getByRole("button", { name: "Excluir" }).click();
  await expect(row).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(row).toBeVisible({ timeout: 30_000 });

  // Excluir de vez (deixa o banco como estava).
  await row.click();
  await dialog.getByRole("button", { name: "Excluir" }).click();
  await expect(row).toHaveCount(0, { timeout: 30_000 });
});
