import { expect, test } from "@playwright/test";

test("rota protegida sem sessão redireciona para o login", async ({ page }) => {
  await page.goto("/transacoes");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Cifra" })).toBeVisible();
});

test("e-mail inválido mostra erro sem chamar o Supabase", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("E-mail").fill("nao-e-email");
  await page.getByLabel("Senha").fill("12345678");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Digite um e-mail válido." })).toBeVisible();
});

test("tema começa escuro, alterna para claro e persiste ao recarregar", async ({ page }) => {
  await page.goto("/sign-in");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "dark");

  const base = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await base()).toBe("rgb(11, 15, 13)");

  await page.getByTestId("theme-toggle").click();
  await expect(html).toHaveAttribute("data-theme", "light");
  expect(await base()).toBe("rgb(247, 248, 247)");

  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "light");
});

test("login não tem rolagem horizontal em 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sign-in");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
