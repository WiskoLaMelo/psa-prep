import { describe, expect, it } from "vitest";
import { AutoCapture, meanAbsDiff, toGray } from "./stability";

const still = (diffFromLastCapture: number | null = null, diffFromBackground: number | null = 50) => ({ motion: 1, diffFromLastCapture, diffFromBackground });
const moving = { motion: 30, diffFromLastCapture: 40, diffFromBackground: 50 };

describe("AutoCapture", () => {
  it("capture après le délai de stabilité, une seule fois", () => {
    const a = new AutoCapture({ stableMs: 600, stillThreshold: 4, changeThreshold: 18, emptyThreshold: 10 });
    expect(a.update(still(), 0)).toBe(false);
    expect(a.update(still(), 300)).toBe(false);
    expect(a.update(still(), 650)).toBe(true);
    // Image toujours identique : pas de deuxième capture de la même carte.
    expect(a.update(still(2), 2000)).toBe(false);
    expect(a.update(still(2), 5000)).toBe(false);
  });

  it("se réarme quand la carte est remplacée", () => {
    const a = new AutoCapture({ stableMs: 600, stillThreshold: 4, changeThreshold: 18, emptyThreshold: 10 });
    a.update(still(), 0);
    expect(a.update(still(), 700)).toBe(true);
    a.update(moving, 800); // la main passe
    expect(a.state).toBe("waiting");
    a.update(still(30), 900);
    expect(a.update(still(30), 1600)).toBe(true);
  });

  it("se réarme quand la carte est retirée (retour au fond vide)", () => {
    const a = new AutoCapture({ stableMs: 100, stillThreshold: 4, changeThreshold: 18, emptyThreshold: 10 });
    a.update(still(), 0);
    expect(a.update(still(), 150)).toBe(true);
    a.update({ motion: 1, diffFromLastCapture: 5, diffFromBackground: 2 }, 200);
    expect(a.state).toBe("waiting");
  });

  it("ne capture jamais le fond vide", () => {
    const a = new AutoCapture({ stableMs: 100, stillThreshold: 4, changeThreshold: 18, emptyThreshold: 10 });
    for (let t = 0; t < 1000; t += 50) expect(a.update({ motion: 0, diffFromLastCapture: null, diffFromBackground: 3 }, t)).toBe(false);
  });

  it("le mouvement remet le compteur à zéro", () => {
    const a = new AutoCapture({ stableMs: 600, stillThreshold: 4, changeThreshold: 18, emptyThreshold: 10 });
    a.update(still(), 0);
    a.update(still(), 500);
    a.update(moving, 550);
    expect(a.update(still(), 700)).toBe(false);
    expect(a.update(still(), 1200)).toBe(false);
    expect(a.update(still(), 1310)).toBe(true);
  });
});

describe("outils d'image", () => {
  it("calcule l'écart moyen et les niveaux de gris", () => {
    expect(meanAbsDiff([0, 10, 20], [0, 20, 40])).toBeCloseTo(10);
    expect([...toGray([255, 255, 255, 255, 0, 0, 0, 255])]).toEqual([255, 0]);
  });
});
