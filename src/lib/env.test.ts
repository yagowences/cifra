import { describe, expect, it } from "vitest";
import { parsePublicEnv } from "./env";

describe("parsePublicEnv", () => {
  it("aceita URL e publishable key válidas", () => {
    const env = parsePublicEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
    });
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://abc.supabase.co");
  });

  it("nomeia as variáveis ausentes no erro", () => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_SUPABASE_URL: "nao-e-url" })).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/,
    );
  });
});
