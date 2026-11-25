/**
 * Limitador simples de pedidos (guardado na memória).
 * Serve para impedir que alguém fique criando milhares de grupos ou
 * tentando adivinhar links. Se o servidor reiniciar, a contagem zera - e tudo bem.
 */
interface Entry {
  hits: number[];
  windowMs: number;
}

export class RateLimiter {
  private entries = new Map<string, Entry>();

  constructor() {
    const timer = setInterval(() => this.sweep(), 60_000);
    (timer as { unref?: () => void }).unref?.(); // não impede o programa de fechar
  }

  /** Retorna true se o pedido pode passar; false se passou do limite. */
  hit(key: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    const entry = this.entries.get(key) ?? { hits: [], windowMs };
    entry.windowMs = windowMs;
    entry.hits = entry.hits.filter((t) => now - t < windowMs);
    if (entry.hits.length >= max) {
      this.entries.set(key, entry);
      return false;
    }
    entry.hits.push(now);
    this.entries.set(key, entry);
    return true;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, e] of this.entries) {
      if (e.hits.every((t) => now - t >= e.windowMs)) this.entries.delete(key);
    }
  }
}
