import { describe, expect, test } from "bun:test";
import { drawNames } from "../src/draw";

const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("sorteio", () => {
  test("ninguém tira a si mesmo e todos são tirados uma única vez", () => {
    for (let n = 3; n <= 40; n++) {
      for (let rep = 0; rep < 20; rep++) {
        const result = drawNames(ids(n))!;
        expect(result).not.toBeNull();
        expect(result.size).toBe(n);
        for (const [giver, receiver] of result) expect(giver).not.toBe(receiver);
        expect(new Set(result.values()).size).toBe(n);
      }
    }
  });

  test("pares proibidos nunca se tiram, em nenhum sentido", () => {
    const forbidden: Array<[number, number]> = [[1, 2], [3, 4]];
    for (let rep = 0; rep < 300; rep++) {
      const result = drawNames(ids(6), forbidden)!;
      expect(result).not.toBeNull();
      expect(result.get(1)).not.toBe(2);
      expect(result.get(2)).not.toBe(1);
      expect(result.get(3)).not.toBe(4);
      expect(result.get(4)).not.toBe(3);
    }
  });

  test("devolve null quando é impossível", () => {
    // 3 pessoas onde 1 não pode tirar ninguém
    expect(drawNames(ids(3), [[1, 2], [1, 3]])).toBeNull();
    // gente de menos
    expect(drawNames([1])).toBeNull();
  });

  test("encontra solução mesmo bem apertada", () => {
    // 4 pessoas, 2 casais: só existem trocas entre os casais
    const result = drawNames(ids(4), [[1, 2], [3, 4]])!;
    expect(result).not.toBeNull();
    expect([1, 2]).toContain(result.get(3)!);
  });

  test("resultados variam (não é sempre o mesmo)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) seen.add(JSON.stringify([...drawNames(ids(6))!]));
    expect(seen.size).toBeGreaterThan(10);
  });
});
