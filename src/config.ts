import { join, resolve } from "node:path";

// Todas as configurações vêm de "variáveis de ambiente" (valores que a
// hospedagem permite você definir sem mexer no código). Se não existirem,
// usamos o valor padrão, que já serve para rodar no seu computador.

const positive = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const nonNegative = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export const config = {
  /** Porta onde o site "escuta". Hospedagens costumam definir PORT sozinhas. */
  port: positive(process.env.PORT, 3000),
  /** Pasta onde fica o arquivo do banco de dados. Na hospedagem, aponte para o disco persistente. */
  dataDir: resolve(process.env.DATA_DIR ?? "./data"),
  /** URL de um banco PostgreSQL externo; quando definida, substitui o SQLite local. */
  databaseUrl: process.env.DATABASE_URL?.trim() || null,
  /** Defina TRUST_PROXY=true quando o site estiver atrás do proxy de uma hospedagem (para ler o IP real). */
  trustProxy: process.env.TRUST_PROXY === "true",
  /** Grupos mais antigos que isso (em dias) são apagados automaticamente; 0 desativa a limpeza. */
  retentionDays: nonNegative(process.env.RETENTION_DAYS, 0),
  /** Limite de participantes por grupo. */
  maxParticipants: positive(process.env.MAX_PARTICIPANTS, 60),
  /** Pasta com o site (HTML, CSS, JS). */
  publicDir: resolve(import.meta.dir, "../public"),
};

export type Config = typeof config;

export const dbPathOf = (c: Config): string => join(c.dataDir, "amigo-secreto.db");
