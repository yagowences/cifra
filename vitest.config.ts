import { fileURLToPath } from "node:url";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

try {
  // Testes de integração leem DATABASE_URL do .env local; sem ele, são pulados.
  process.loadEnvFile(".env");
} catch {
  // sem .env
}

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // O pacote lança erro fora do React Server; nos testes vira módulo vazio.
      "server-only": fileURLToPath(new URL("./src/test/server-only.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
