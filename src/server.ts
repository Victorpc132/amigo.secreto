import { createApp } from "./app";
import { config, dbPathOf } from "./config";
import { openDb, purgeOldGroups } from "./db";

const db = openDb(dbPathOf(config));
const handle = createApp(db, config);

/** Descobre o IP de quem acessou (necessário para o limitador de pedidos). */
function clientIp(req: Request, server: { requestIP(r: Request): { address: string } | null }): string {
  if (config.trustProxy) {
    const fly = req.headers.get("fly-client-ip");
    if (fly) return fly;
    const forwarded = req.headers.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]!.trim();
  }
  return server.requestIP(req)?.address ?? "desconhecido";
}

const server = Bun.serve({
  port: config.port,
  maxRequestBodySize: 64 * 1024,
  fetch: (req, srv) => handle(req, clientIp(req, srv)),
  error(err) {
    console.error(err);
    return new Response("Erro interno", { status: 500 });
  },
});

// Limpeza automática de grupos antigos: ao ligar e a cada 12 horas.
const purge = () => {
  const removed = purgeOldGroups(db, config.retentionDays);
  if (removed > 0) console.log(`🧹 ${removed} grupo(s) antigo(s) apagado(s)`);
};
purge();
setInterval(purge, 12 * 3_600_000).unref();

// Desligamento educado (a hospedagem manda SIGTERM ao reiniciar).
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.stop();
    db.close();
    process.exit(0);
  });
}

console.log(`🎄 Amigo Secreto rodando em http://localhost:${server.port}`);
