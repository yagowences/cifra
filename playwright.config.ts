import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  // O dev server compila cada rota na primeira visita; o padrão de 30 s não basta.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  use: { baseURL: "http://localhost:3000" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-390", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: { command: "npm run dev", url: "http://localhost:3000/sign-in", reuseExistingServer: true, timeout: 120_000 },
});
