/** Erro "esperado": vira uma resposta com mensagem amigável para a pessoa. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Código secreto longo (128 bits) para links de organizador e participante. */
export function newToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url");
}

// Sem letras parecidas (0/o, 1/l/i) para o código do convite ser fácil de ler e digitar.
const CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";

export function newInviteCode(length = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

// Caracteres invisíveis de controle (menos tab e quebra de linha).
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

interface TextRules {
  min?: number;
  max: number;
  multiline?: boolean;
}

/** Valida e limpa um texto vindo do usuário. */
export function text(value: unknown, label: string, rules: TextRules): string {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") throw new HttpError(400, `Valor inválido em ${label}.`);

  let s = value.replace(CONTROL_CHARS, "").normalize("NFC");
  s = rules.multiline
    ? s.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
    : s.replace(/\s+/g, " ").trim();

  if (s.length < (rules.min ?? 0)) throw new HttpError(400, `Preencha ${label}.`);
  if ([...s].length > rules.max) {
    throw new HttpError(400, `Texto muito longo em ${label} (máximo de ${rules.max} caracteres).`);
  }
  return s;
}

/** Aceita "" (sem data) ou uma data real no formato AAAA-MM-DD. */
export function isoDate(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, "Data inválida.");
  }
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, "Data inválida.");
  }
  return value;
}

/** "João" e "joao" contam como o mesmo nome (evita duplicados). */
export const nameKey = (name: string): string =>
  name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
