import { createApp } from "./app";
import { config, dbPathOf } from "./config";
import { openDb, openPostgresDb, purgeOldGroups } from "./db";

const db = config.databaseUrl ? await openPostgresDb(config.databaseUrl) : openDb(dbPathOf(config));
if (!config.databaseUrl) {
  console.warn("DATABASE_URL não definido; usando SQLite local, que exige armazenamento persistente na hospedagem.");
}
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

// Limpeza automática de grupos antigos: ao ligar e a cada 12 horas.
const purge = async () => {
  try {
    const removed = await purgeOldGroups(db, config.retentionDays);
    if (removed > 0) console.log(`🧹 ${removed} grupo(s) antigo(s) apagado(s)`);
  } catch (error) {
    console.error("Falha ao limpar grupos antigos:", error);
  }
};
await purge();
const purgeTimer = setInterval(() => void purge(), 12 * 3_600_000).unref();

const server = Bun.serve({
  port: config.port,
  maxRequestBodySize: 64 * 1024,
  fetch: (req, srv) => handle(req, clientIp(req, srv)),
  error(err) {
    console.error(err);
    return new Response("Erro interno", { status: 500 });
  },
});

// Desligamento educado (a hospedagem manda SIGTERM ao reiniciar).
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  clearInterval(purgeTimer);
  server.stop();
  try {
    if ("kind" in db) await db.close();
    else db.close();
  } catch (error) {
    console.error("Falha ao fechar o banco de dados:", error);
    process.exitCode = 1;
  }
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void shutdown());
}

console.log(`🎄 Amigo Secreto rodando em http://localhost:${server.port}`);
