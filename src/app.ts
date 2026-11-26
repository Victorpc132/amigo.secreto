import type { Config } from "./config";
import { createRepo, type AppDatabase, type GroupRow, type PersonRow } from "./db";
import { drawNames } from "./draw";
import { RateLimiter } from "./ratelimit";
import { StaticFiles } from "./static";
import { HttpError, escapeHtml, isoDate, text } from "./util";

/* ------------------------------------------------------------------ *
 * Aqui ficam as rotas da API e a entrega das páginas.
 *
 * Segurança em resumo:
 *  - não existe login: cada link tem um código secreto longo e impossível de adivinhar;
 *  - o organizador NUNCA recebe o resultado do sorteio de ninguém;
 *  - cada participante só enxerga quem tirou depois de clicar em "revelar";
 *  - todo texto é validado e limitado; o site só exibe texto (nunca HTML).
 * ------------------------------------------------------------------ */

const MAX_BODY = 16 * 1024;
const nowSec = () => Math.floor(Date.now() / 1000);

type Body = Record<string, unknown>;
interface Ctx {
  req: Request;
  url: URL;
  params: Record<string, string>;
  body: () => Promise<Body>;
}
type Handler = (c: Ctx) => Response | Promise<Response>;
interface Limit {
  name: string;
  max: number;
  windowMs: number;
}
interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  handler: Handler;
  limit?: Limit;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

async function readJson(req: Request): Promise<Body> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) throw new HttpError(413, "Pedido grande demais.");
  const raw = await req.text();
  if (raw.length > MAX_BODY) throw new HttpError(413, "Pedido grande demais.");
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Pedido inválido.");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new HttpError(400, "Pedido inválido.");
  return data as Body;
}

const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
  "manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export interface AppOptions {
  /** Desligue só nos testes. */
  rateLimit?: boolean;
}

export function createApp(db: AppDatabase, config: Config, opts: AppOptions = {}) {
  const repo = createRepo(db);
  const files = new StaticFiles(config.publicDir);
  const limiter = new RateLimiter();
  const useLimit = opts.rateLimit ?? true;

  /* ---------- registro de rotas ---------- */
  const routes: Route[] = [];
  const route = (method: string, pattern: string, handler: Handler, limit?: Limit) => {
    const keys: string[] = [];
    const source = pattern.replace(/:([a-z]+)/gi, (_, k: string) => {
      keys.push(k);
      return "([^/]+)";
    });
    routes.push({ method, re: new RegExp(`^${source}/?$`), keys, handler, limit });
  };

  /* ---------- formatos de resposta ---------- */
  const publicGroup = (g: GroupRow) => ({
    name: g.name,
    amount: g.amount,
    eventDate: g.event_date,
    location: g.location,
    note: g.note,
    drawn: g.drawn_at !== null,
  });

  const groupFields = (b: Body, current?: GroupRow) => ({
    name: text(b.name ?? current?.name, "o nome do grupo", { min: 1, max: 60 }),
    amount: text(b.amount ?? current?.amount, "o valor", { max: 30 }),
    eventDate: isoDate(b.eventDate ?? current?.event_date),
    location: text(b.location ?? current?.location, "o local", { max: 80 }),
    note: text(b.note ?? current?.note, "as observações", { max: 300, multiline: true }),
  });

  const wishesOf = (v: unknown) => text(v, "as dicas de presente", { max: 300, multiline: true });

  /* ---------- buscas que já recusam links inválidos ---------- */
  const adminGroup = async (token: string): Promise<GroupRow> => {
    const group = await repo.groupByAdmin(token);
    if (!group) throw new HttpError(404, "Link do organizador inválido (ou o grupo foi apagado).");
    return group;
  };

  const inviteGroup = async (code: string): Promise<GroupRow> => {
    const group = await repo.groupByInvite(code);
    if (!group) throw new HttpError(404, "Convite não encontrado (ou o grupo foi apagado).");
    return group;
  };

  const meCtx = async (token: string): Promise<{ person: PersonRow; group: GroupRow }> => {
    const person = await repo.personByToken(token);
    const group = person ? await repo.groupById(person.group_id) : null;
    if (!person || !group) throw new HttpError(404, "Link inválido (ou o grupo foi apagado).");
    return { person, group };
  };

  const notDrawn = (g: GroupRow) => {
    if (g.drawn_at) throw new HttpError(409, "O sorteio já foi feito. Refaça o sorteio se quiser mudar a lista.");
  };

  const mePayload = async (p: PersonRow, g: GroupRow) => {
    const [giftee, giver, people] = await Promise.all([
      p.giftee_id ? repo.personById(p.giftee_id) : null,
      g.drawn_at ? repo.giverOf(p.id) : null,
      repo.listPeople(g.id),
    ]);
    const [unreadGiftee, unreadGiver] = await Promise.all([
      giftee ? repo.unread(p.id, giftee.id) : 0,
      giver ? repo.unread(p.id, giver.id) : 0,
    ]);
    return {
      group: publicGroup(g),
      me: { name: p.name, wishes: p.wishes, isOrganizer: p.is_organizer === 1 },
      count: people.length,
      drawn: g.drawn_at !== null,
      revealed: p.revealed_at !== null,
      // O nome só sai daqui depois que a pessoa clicou em "revelar".
      giftee: p.revealed_at !== null && giftee ? { name: giftee.name, wishes: giftee.wishes } : null,
      unread: {
        giftee: unreadGiftee,
        giver: unreadGiver,
      },
    };
  };

  /* ================================================================ *
   *  CRIAR GRUPO
   * ================================================================ */
  route(
    "POST",
    "/api/groups",
    async (c) => {
      const b = await c.body();
      const fields = groupFields(b);
      const participates = b.organizerParticipates !== false;
      const organizer = participates
        ? {
            name: text(b.organizerName, "seu nome", { min: 1, max: 40 }),
            wishes: wishesOf(b.wishes),
          }
        : null;
      const { group, person } = await repo.createGroup(fields, organizer, nowSec());
      return json({ adminToken: group.admin_token, inviteCode: group.invite_code, participantToken: person?.token ?? null }, 201);
    },
    { name: "create", max: 8, windowMs: 3_600_000 },
  );

  /* ================================================================ *
   *  CONVITE (qualquer pessoa com o link de convite)
   * ================================================================ */
  route("GET", "/api/invite/:code", async (c) => {
    const g = await inviteGroup(c.params.code!);
    return json({ group: publicGroup(g), count: (await repo.listPeople(g.id)).length });
  });

  route(
    "POST",
    "/api/invite/:code/join",
    async (c) => {
      const b = await c.body();
      const g = await inviteGroup(c.params.code!);
      notDrawn(g);
      const name = text(b.name, "seu nome", { min: 1, max: 40 });
      const person = await repo.addPersonWithinLimit(g.id, name, wishesOf(b.wishes), false, nowSec(), config.maxParticipants);
      return json({ participantToken: person.token }, 201);
    },
    { name: "join", max: 20, windowMs: 3_600_000 },
  );

  /* ================================================================ *
   *  ORGANIZADOR
   * ================================================================ */
  route("GET", "/api/admin/:token", async (c) => {
    const g = await adminGroup(c.params.token!);
    const [people, exclusions] = await Promise.all([repo.listPeople(g.id), repo.listExclusions(g.id)]);
    return json({
      group: { ...publicGroup(g), inviteCode: g.invite_code },
      // Repare: NÃO enviamos quem tirou quem. O organizador também não pode saber.
      participants: people.map((p) => ({
        id: p.id,
        name: p.name,
        wishes: p.wishes,
        token: p.token,
        isOrganizer: p.is_organizer === 1,
        revealed: p.revealed_at !== null,
      })),
      exclusions,
    });
  });

  route("PATCH", "/api/admin/:token", async (c) => {
    const b = await c.body();
    const g = await adminGroup(c.params.token!);
    await repo.updateGroup(g.id, groupFields(b, g));
    return json({ ok: true });
  });

  route("POST", "/api/admin/:token/invite/rotate", async (c) => {
    const g = await adminGroup(c.params.token!);
    notDrawn(g);
    return json({ inviteCode: await repo.rotateInviteCode(g.id) });
  });

  route("DELETE", "/api/admin/:token", async (c) => {
    await repo.deleteGroup((await adminGroup(c.params.token!)).id);
    return json({ ok: true });
  });

  route("POST", "/api/admin/:token/participants", async (c) => {
    const b = await c.body();
    const g = await adminGroup(c.params.token!);
    notDrawn(g);
    const name = text(b.name, "o nome", { min: 1, max: 40 });
    await repo.addPersonWithinLimit(g.id, name, wishesOf(b.wishes), false, nowSec(), config.maxParticipants);
    return json({ ok: true }, 201);
  });

  route("DELETE", "/api/admin/:token/participants/:id", async (c) => {
    const g = await adminGroup(c.params.token!);
    notDrawn(g);
    if (!(await repo.removePerson(Number(c.params.id), g.id))) throw new HttpError(404, "Participante não encontrado.");
    return json({ ok: true });
  });

  route("PUT", "/api/admin/:token/exclusions", async (c) => {
    const b = await c.body();
    const g = await adminGroup(c.params.token!);
    notDrawn(g);
    if (!Array.isArray(b.pairs) || b.pairs.length > 200) throw new HttpError(400, "Pedido inválido.");
    const valid = new Set((await repo.listPeople(g.id)).map((p) => p.id));
    const seen = new Set<string>();
    const pairs: Array<[number, number]> = [];
    for (const raw of b.pairs as unknown[]) {
      if (!Array.isArray(raw) || raw.length !== 2) throw new HttpError(400, "Par inválido.");
      const [x, y] = raw as number[];
      if (!Number.isInteger(x) || !Number.isInteger(y) || x === y || !valid.has(x!) || !valid.has(y!)) {
        throw new HttpError(400, "Par inválido.");
      }
      const a = Math.min(x!, y!);
      const z = Math.max(x!, y!);
      if (!seen.has(`${a}:${z}`)) {
        seen.add(`${a}:${z}`);
        pairs.push([a, z]);
      }
    }
    await repo.setExclusions(g.id, pairs);
    return json({ ok: true });
  });

  route("POST", "/api/admin/:token/draw", async (c) => {
    const g = await adminGroup(c.params.token!);
    notDrawn(g);
    const people = await repo.listPeople(g.id);
    if (people.length < 3) throw new HttpError(422, "Precisa de pelo menos 3 pessoas para sortear.");
    const result = drawNames(people.map((p) => p.id), await repo.listExclusions(g.id));
    if (!result) {
      throw new HttpError(422, "Com essas restrições não dá para sortear. Tire alguma restrição e tente de novo.");
    }
    await repo.applyDraw(g.id, result, nowSec());
    return json({ ok: true });
  });

  route("POST", "/api/admin/:token/reset", async (c) => {
    const g = await adminGroup(c.params.token!);
    await repo.resetDraw(g.id);
    return json({ ok: true });
  });

  /* ================================================================ *
   *  PARTICIPANTE (link pessoal)
   * ================================================================ */
  route("GET", "/api/me/:token", async (c) => {
    const { person, group } = await meCtx(c.params.token!);
    return json(await mePayload(person, group));
  });

  route("PATCH", "/api/me/:token", async (c) => {
    const b = await c.body();
    const { person } = await meCtx(c.params.token!);
    await repo.setWishes(person.id, wishesOf(b.wishes));
    return json({ ok: true });
  });

  route("POST", "/api/me/:token/reveal", async (c) => {
    const { person, group } = await meCtx(c.params.token!);
    if (!group.drawn_at || !person.giftee_id) throw new HttpError(409, "O sorteio ainda não foi feito.");
    await repo.reveal(person.id, nowSec());
    const fresh = (await repo.personByToken(c.params.token!))!;
    return json(await mePayload(fresh, group));
  });

  route("GET", "/api/me/:token/messages", async (c) => {
    const { person, group } = await meCtx(c.params.token!);
    if (!group.drawn_at) throw new HttpError(409, "O sorteio ainda não foi feito.");
    const [giftee, giver] = await Promise.all([
      person.giftee_id ? repo.personById(person.giftee_id) : null,
      repo.giverOf(person.id),
    ]);
    // Só devolvemos "minha" ou "do outro": ninguém descobre identidades por aqui.
    const view = async (other: PersonRow | null) =>
      other
        ? (await repo.thread(person.id, other.id)).map((m) => ({ mine: m.from_id === person.id, body: m.body, at: m.created_at }))
        : [];
    const which = c.url.searchParams.get("thread");
    if (which === "giftee" && giftee) await repo.markRead(person.id, giftee.id, nowSec());
    if (which === "giver" && giver) await repo.markRead(person.id, giver.id, nowSec());
    const [gifteeMessages, giverMessages] = await Promise.all([view(giftee), view(giver)]);
    return json({ giftee: gifteeMessages, giver: giverMessages });
  });

  route(
    "POST",
    "/api/me/:token/messages",
    async (c) => {
      const b = await c.body();
      const { person, group } = await meCtx(c.params.token!);
      if (!group.drawn_at) throw new HttpError(409, "O sorteio ainda não foi feito.");
      if (b.thread !== "giftee" && b.thread !== "giver") throw new HttpError(400, "Pedido inválido.");
      const body = text(b.body, "a mensagem", { min: 1, max: 500, multiline: true });
      const other =
        b.thread === "giftee"
          ? person.giftee_id
            ? await repo.personById(person.giftee_id)
            : null
          : await repo.giverOf(person.id);
      if (!other) throw new HttpError(409, "Conversa indisponível.");
      await repo.addMessage(group.id, person.id, other.id, body, nowSec());
      return json({ ok: true }, 201);
    },
    { name: "msg", max: 40, windowMs: 600_000 },
  );

  /* ================================================================ *
   *  API: despacho
   * ================================================================ */
  async function handleApi(req: Request, url: URL, path: string, ip: string): Promise<Response> {
    let pathMatched = false;
    for (const r of routes) {
      const m = r.re.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== req.method) continue;

      if (useLimit) {
        const ok =
          limiter.hit(`api:${ip}`, 300, 60_000) && (!r.limit || limiter.hit(`${r.limit.name}:${ip}`, r.limit.max, r.limit.windowMs));
        if (!ok) throw new HttpError(429, "Muitas tentativas seguidas. Espere um pouquinho e tente de novo.");
      }

      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]!]));
      let cached: Promise<Body> | undefined;
      return await r.handler({ req, url, params, body: () => (cached ??= readJson(req)) });
    }
    throw pathMatched ? new HttpError(405, "Método não permitido.") : new HttpError(404, "Não encontrado.");
  }

  /* ================================================================ *
   *  PÁGINAS
   * ================================================================ */
  // "/", "/g/<convite>", "/a/<organizador>", "/p/<participante>" usam a mesma página (o JS decide o que mostrar).
  const APP_PATHS = /^\/(?:$|[gap]\/[^/]+\/?$)/;

  async function indexPage(path: string, status = 200): Promise<Response> {
    let title = "Amigo Secreto de Natal";
    let description = "Crie seu grupo, sorteie e descubra quem você tirou. Grátis, rápido e sem cadastro.";
    const invite = /^\/g\/([^/]+)\/?$/.exec(path);
    if (invite) {
      const g = await repo.groupByInvite(invite[1]!);
      if (g) {
        title = `Amigo Secreto: ${g.name}`;
        description = "Você foi convidado! Entre no grupo e deixe suas dicas de presente.";
      }
    }
    const asset = await files.get("index.html");
    if (!asset) throw new HttpError(500, "Página não encontrada no servidor.");
    const html = new TextDecoder()
      .decode(asset.body)
      .replaceAll("__TITLE__", escapeHtml(title))
      .replaceAll("__DESC__", escapeHtml(description));
    return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
  }

  async function handlePage(req: Request, path: string): Promise<Response> {
    if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Método não permitido.");
    if (APP_PATHS.test(path)) return indexPage(path);
    const asset = await files.get(path.slice(1));
    if (asset && path !== "/index.html") return files.respond(asset, req);
    return indexPage(path, 404); // o site mostra a tela "página não encontrada"
  }

  /* ================================================================ *
   *  Cabeçalhos de segurança em TODAS as respostas
   * ================================================================ */
  function secure(res: Response, req: Request, path: string): Response {
    const h = res.headers;
    h.set("content-security-policy", CSP);
    h.set("x-content-type-options", "nosniff");
    h.set("x-frame-options", "DENY");
    // Os links secretos ficam no endereço: não podem vazar para outros sites.
    h.set("referrer-policy", "no-referrer");
    h.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
    if (/^\/[gap]\//.test(path)) h.set("x-robots-tag", "noindex, nofollow");
    if (config.trustProxy && req.headers.get("x-forwarded-proto") === "https") {
      h.set("strict-transport-security", "max-age=31536000");
    }
    return res;
  }

  function errorResponse(e: unknown): Response {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error("Erro inesperado:", e);
    return json({ error: "Erro interno. Tente de novo em instantes." }, 500);
  }

  return async function handle(req: Request, ip: string): Promise<Response> {
    const url = new URL(req.url);
    let path: string;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return secure(new Response("Endereço inválido", { status: 400 }), req, url.pathname);
    }

    let res: Response;
    try {
      if (path.startsWith("/api/")) res = await handleApi(req, url, path, ip);
      else if (path === "/healthz") {
        await repo.ping();
        res = new Response("ok", { headers: { "cache-control": "no-store" } });
      } else res = await handlePage(req, path);
    } catch (e) {
      res = errorResponse(e);
    }
    return secure(res, req, path);
  };
}
