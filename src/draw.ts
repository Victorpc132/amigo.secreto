/**
 * O sorteio.
 *
 * Regras:
 *  - ninguém tira a si mesmo;
 *  - cada pessoa é tirada por exatamente uma pessoa;
 *  - pares "proibidos" (ex.: casais) nunca se tiram, em nenhum dos dois sentidos.
 *
 * Como funciona: para cada pessoa montamos a lista (embaralhada) de quem ela
 * pode tirar. Depois escolhemos sempre a pessoa com MENOS opções restantes e
 * testamos as opções dela; se der um beco sem saída, voltamos atrás e tentamos
 * outra. Se não existir nenhuma combinação possível, devolvemos null.
 */

export function shuffle<T>(list: readonly T[], rng: () => number = Math.random): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const STEP_LIMIT = 200_000; // trava de segurança contra casos impossíveis e enormes

export function drawNames(
  ids: readonly number[],
  forbiddenPairs: ReadonlyArray<readonly [number, number]> = [],
  rng: () => number = Math.random,
): Map<number, number> | null {
  const n = ids.length;
  if (n < 2) return null;

  const blocked = new Set<string>();
  for (const [a, b] of forbiddenPairs) {
    blocked.add(`${a}:${b}`);
    blocked.add(`${b}:${a}`);
  }

  const options = new Map<number, number[]>();
  for (const giver of ids) {
    const list = ids.filter((r) => r !== giver && !blocked.has(`${giver}:${r}`));
    if (list.length === 0) return null;
    options.set(giver, shuffle(list, rng));
  }

  const order = shuffle(ids, rng);
  const taken = new Set<number>();
  const result = new Map<number, number>();
  let steps = 0;

  const solve = (): boolean => {
    if (result.size === n) return true;
    if (++steps > STEP_LIMIT) return false;

    // Quem tem menos opções livres escolhe primeiro.
    let giver = -1;
    let free: number[] = [];
    let fewest = Infinity;
    for (const g of order) {
      if (result.has(g)) continue;
      const candidates = options.get(g)!.filter((r) => !taken.has(r));
      if (candidates.length < fewest) {
        giver = g;
        free = candidates;
        fewest = candidates.length;
        if (fewest <= 1) break;
      }
    }
    if (fewest === 0) return false;

    for (const receiver of free) {
      result.set(giver, receiver);
      taken.add(receiver);
      if (solve()) return true;
      result.delete(giver);
      taken.delete(receiver);
      if (steps > STEP_LIMIT) return false;
    }
    return false;
  };

  return solve() ? result : null;
}
