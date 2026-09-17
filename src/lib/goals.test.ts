import { describe, expect, it } from "vitest";
import { goalProgress } from "./goals";

describe("goalProgress", () => {
  it("percentual, restante e previsão pelo ritmo", () => {
    const p = goalProgress({ targetAmount: 1_000_000n, currentAmount: 400_000n, deadline: null, monthlyPace: 150_000n, today: "2026-09-17" });
    expect(p.percent).toBe(40);
    expect(p.remaining).toBe(600_000n);
    expect(p.monthsToGo).toBe(4);
    expect(p.forecastMonth).toBe("2027-01");
    expect(p.neededPerMonth).toBeNull();
  });

  it("com prazo, calcula o aporte necessário e se está no ritmo", () => {
    const ok = goalProgress({ targetAmount: 1_000_000n, currentAmount: 400_000n, deadline: "2027-03-31", monthlyPace: 150_000n, today: "2026-09-17" });
    expect(ok.neededPerMonth).toBe(100_000n);
    expect(ok.onTrack).toBe(true);
    const late = goalProgress({ targetAmount: 1_000_000n, currentAmount: 400_000n, deadline: "2026-12-31", monthlyPace: 150_000n, today: "2026-09-17" });
    expect(late.neededPerMonth).toBe(200_000n);
    expect(late.onTrack).toBe(false);
  });

  it("sem histórico não inventa previsão; meta batida fica em 100%", () => {
    const none = goalProgress({ targetAmount: 100n, currentAmount: 10n, deadline: null, monthlyPace: null, today: "2026-09-17" });
    expect(none.monthsToGo).toBeNull();
    expect(none.forecastMonth).toBeNull();
    const done = goalProgress({ targetAmount: 100n, currentAmount: 120n, deadline: "2026-12-31", monthlyPace: null, today: "2026-09-17" });
    expect(done).toMatchObject({ percent: 100, remaining: 0n, reached: true, monthsToGo: 0, neededPerMonth: null });
  });

  it("prazo vencido exige tudo de uma vez", () => {
    const p = goalProgress({ targetAmount: 100n, currentAmount: 10n, deadline: "2026-08-31", monthlyPace: 5n, today: "2026-09-17" });
    expect(p.neededPerMonth).toBe(90n);
    expect(p.onTrack).toBe(false);
  });
});
