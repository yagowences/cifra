import { describe, expect, it } from "vitest";
import { isStaleProcessing, STALE_PROCESSING_MS } from "./types";

const AGORA = Date.parse("2026-10-14T12:00:00Z");
const haMs = (ms: number) => new Date(AGORA - ms);

describe("isStaleProcessing", () => {
  it("lote lendo há pouco tempo ainda está vivo", () => {
    expect(isStaleProcessing({ status: "PROCESSING", updatedAt: haMs(20_000) }, AGORA)).toBe(false);
    expect(isStaleProcessing({ status: "PENDING", updatedAt: haMs(STALE_PROCESSING_MS) }, AGORA)).toBe(false);
  });

  it("lote que não se mexe além do limite foi interrompido, esteja PENDING ou PROCESSING", () => {
    expect(isStaleProcessing({ status: "PROCESSING", updatedAt: haMs(STALE_PROCESSING_MS + 1) }, AGORA)).toBe(true);
    expect(isStaleProcessing({ status: "PENDING", updatedAt: haMs(10 * 60_000) }, AGORA)).toBe(true);
  });

  it("só PENDING/PROCESSING podem ficar presos: o resto é estado final, por mais antigo que seja", () => {
    for (const status of ["READY_FOR_REVIEW", "NEEDS_MAPPING", "CONFIRMED", "UNDONE", "FAILED"]) {
      expect(isStaleProcessing({ status, updatedAt: haMs(24 * 3_600_000) }, AGORA)).toBe(false);
    }
  });

  it("o limite fica acima dos 60 s em que a function da Netlify é encerrada", () => {
    expect(STALE_PROCESSING_MS).toBeGreaterThan(60_000);
  });
});
