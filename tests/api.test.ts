import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { config } from "../src/config";
import { openDb, purgeOldGroups } from "../src/db";

describe("retenção de grupos", () => {
  test("0 mantém grupos antigos; um limite positivo os apaga", async () => {
    const db = openDb(":memory:");
    db.query(
      "INSERT INTO groups (admin_token, invite_code, name, created_at) VALUES (?, ?, ?, ?)",
    ).run("admin", "invite", "Antigo", 1);

    expect(await purgeOldGroups(db, 0)).toBe(0);
    expect(db.query("SELECT COUNT(*) AS count FROM groups").get()).toEqual({ count: 1 });
    expect(await purgeOldGroups(db, 1)).toBe(1);
    expect(db.query("SELECT COUNT(*) AS count FROM groups").get()).toEqual({ count: 0 });
    db.close();
  });
});

function setup(rateLimit = false, maxParticipants = config.maxParticipants) {
  const handle = createApp(openDb(":memory:"), { ...config, maxParticipants }, { rateLimit });
  const call = async (method: string, path: string, body?: unknown, ip = "9.9.9.9") => {
    const res = await handle(
      new Request(`http://teste${path}`, {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      ip,
    );
    const isJson = (res.headers.get("content-type") ?? "").includes("json");
    return { status: res.status, headers: res.headers, data: (isJson ? await res.json() : await res.text()) as any };
  };

  /** Cria grupo com organizador + 3 convidados. */
  const makeGroup = async (guests = ["Ana", "Bruno", "Carla"]) => {
    const created = await call("POST", "/api/groups", { name: "Natal da Família", organizerName: "Victor", amount: "R$ 50" });
    expect(created.status).toBe(201);
    const { adminToken, inviteCode, participantToken } = created.data;
    const tokens: Record<string, string> = { Victor: participantToken };
    for (const name of guests) {
      const j = await call("POST", `/api/invite/${inviteCode}/join`, { name, wishes: `presente da ${name}` });
      expect(j.status).toBe(201);
      tokens[name] = j.data.participantToken;
    }
    return { adminToken, inviteCode, tokens };
  };

  return { call, makeGroup };
}

describe("fluxo completo", () => {
  test("participante removido perde o link pessoal e pode entrar novamente pelo convite", async () => {
    const { call, makeGroup } = setup();
    const { adminToken, inviteCode, tokens } = await makeGroup();
    const admin = await call("GET", `/api/admin/${adminToken}`);
    const anaId = admin.data.participants.find((p: any) => p.name === "Ana").id;

    expect((await call("DELETE", `/api/admin/${adminToken}/participants/${anaId}`)).status).toBe(200);
    expect((await call("GET", `/api/me/${tokens.Ana}`)).status).toBe(404);

    const invite = await call("GET", `/api/invite/${inviteCode}`);
    expect(invite.status).toBe(200);
    const rejoin = await call("POST", `/api/invite/${inviteCode}/join`, { name: "Ana", wishes: "novas dicas" });
    expect(rejoin.status).toBe(201);
    expect(rejoin.data.participantToken).not.toBe(tokens.Ana);
  });

  test("organizador pode girar o convite e invalidar o link anterior", async () => {
    const { call, makeGroup } = setup();
    const { adminToken, inviteCode } = await makeGroup();

    const rotated = await call("POST", `/api/admin/${adminToken}/invite/rotate`);
    expect(rotated.status).toBe(200);
    expect(rotated.data.inviteCode).not.toBe(inviteCode);
    expect((await call("GET", `/api/invite/${inviteCode}`)).status).toBe(404);
    expect((await call("GET", `/api/invite/${rotated.data.inviteCode}`)).status).toBe(200);
    expect((await call("POST", `/api/invite/${inviteCode}/join`, { name: "Atrasado" })).status).toBe(404);
    expect((await call("POST", `/api/invite/${rotated.data.inviteCode}/join`, { name: "Atrasado" })).status).toBe(201);
  });

  test("rotação do convite é restrita ao organizador e bloqueada após o sorteio", async () => {
    const { call, makeGroup } = setup();
    const { adminToken, inviteCode, tokens } = await makeGroup();
    expect((await call("POST", `/api/admin/${tokens.Ana}/invite/rotate`)).status).toBe(404);
    await call("POST", `/api/admin/${adminToken}/draw`);
    expect((await call("POST", `/api/admin/${adminToken}/invite/rotate`)).status).toBe(409);
    expect((await call("GET", `/api/invite/${inviteCode}`)).status).toBe(200);
  });

  test("duas entradas simultâneas não excedem o limite do grupo", async () => {
    const { call } = setup(false, 3);
    const created = await call("POST", "/api/groups", { name: "Pequeno", organizerName: "Dona" });
    const { inviteCode, adminToken } = created.data;
    expect((await call("POST", `/api/invite/${inviteCode}/join`, { name: "Convidado" })).status).toBe(201);

    const results = await Promise.all([
      call("POST", `/api/invite/${inviteCode}/join`, { name: "Pessoa A" }),
      call("POST", `/api/invite/${inviteCode}/join`, { name: "Pessoa B" }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect((await call("GET", `/api/admin/${adminToken}`)).data.participants).toHaveLength(3);
  });

  test("cria, convida, sorteia e cada um descobre alguém diferente", async () => {
    const { call, makeGroup } = setup();
    const { adminToken, tokens } = await makeGroup();

    const draw = await call("POST", `/api/admin/${adminToken}/draw`);
    expect(draw.status).toBe(200);

    const names = Object.keys(tokens);
    const drawn = new Set<string>();
    for (const name of names) {
      const before = await call("GET", `/api/me/${tokens[name]}`);
      expect(before.data.drawn).toBe(true);
      expect(before.data.giftee).toBeNull(); // ainda não revelou

      const reveal = await call("POST", `/api/me/${tokens[name]}/reveal`);
      expect(reveal.status).toBe(200);
      const friend = reveal.data.giftee.name as string;
      expect(friend).not.toBe(name);
      expect(names).toContain(friend);
      drawn.add(friend);
    }
    expect(drawn.size).toBe(names.length);
  });

  test("o organizador não recebe o resultado do sorteio", async () => {
    const { call, makeGroup } = setup();
    const { adminToken } = await makeGroup();
    await call("POST", `/api/admin/${adminToken}/draw`);
    const admin = await call("GET", `/api/admin/${adminToken}`);
    const raw = JSON.stringify(admin.data);
    expect(raw).not.toContain("giftee");
    expect(admin.data.participants.every((p: any) => p.revealed === false)).toBe(true);
  });

  test("depois do sorteio ninguém entra nem sai; refazer libera de novo", async () => {
    const { call, makeGroup } = setup();
    const { adminToken, inviteCode } = await makeGroup();
    await call("POST", `/api/admin/${adminToken}/draw`);

    expect((await call("POST", `/api/invite/${inviteCode}/join`, { name: "Atrasado" })).status).toBe(409);
    expect((await call("POST", `/api/admin/${adminToken}/participants`, { name: "Outro" })).status).toBe(409);
    expect((await call("POST", `/api/admin/${adminToken}/draw`)).status).toBe(409);

    expect((await call("POST", `/api/admin/${adminToken}/reset`)).status).toBe(200);
    expect((await call("POST", `/api/invite/${inviteCode}/join`, { name: "Atrasado" })).status).toBe(201);
  });

  test("precisa de 3 pessoas e nomes repetidos são recusados", async () => {
    const { call } = setup();
    const created = await call("POST", "/api/groups", { name: "Pequeno", organizerName: "Ana" });
    const { adminToken, inviteCode } = created.data;
    await call("POST", `/api/invite/${inviteCode}/join`, { name: "Bia" });
    expect((await call("POST", `/api/admin/${adminToken}/draw`)).status).toBe(422);
    const dup = await call("POST", `/api/invite/${inviteCode}/join`, { name: "  bía " });
    expect(dup.status).toBe(409);
  });

  test("restrições são respeitadas em vários sorteios seguidos", async () => {
    const { call, makeGroup } = setup();
    const { adminToken, tokens } = await makeGroup(["Ana", "Bruno", "Carla", "Davi"]);
    const admin = await call("GET", `/api/admin/${adminToken}`);
    const id = (n: string) => admin.data.participants.find((p: any) => p.name === n).id as number;
    const put = await call("PUT", `/api/admin/${adminToken}/exclusions`, { pairs: [[id("Victor"), id("Ana")]] });
    expect(put.status).toBe(200);

    for (let i = 0; i < 25; i++) {
      await call("POST", `/api/admin/${adminToken}/reset`);
      expect((await call("POST", `/api/admin/${adminToken}/draw`)).status).toBe(200);
      const v = await call("POST", `/api/me/${tokens.Victor}/reveal`);
      const a = await call("POST", `/api/me/${tokens.Ana}/reveal`);
      expect(v.data.giftee.name).not.toBe("Ana");
      expect(a.data.giftee.name).not.toBe("Victor");
    }
  });

  test("restrição impossível dá erro claro", async () => {
    const { call, makeGroup } = setup();
    const { adminToken } = await makeGroup(["Ana", "Bruno"]);
    const admin = await call("GET", `/api/admin/${adminToken}`);
    const ids = admin.data.participants.map((p: any) => p.id as number);
    // o primeiro não pode tirar ninguém
    await call("PUT", `/api/admin/${adminToken}/exclusions`, { pairs: [[ids[0], ids[1]], [ids[0], ids[2]]] });
    const draw = await call("POST", `/api/admin/${adminToken}/draw`);
    expect(draw.status).toBe(422);
    expect(draw.data.error).toContain("restrições");
  });
});

describe("mensagens anônimas", () => {
  test("quem tirou escreve, o amigo lê e responde sem ninguém descobrir identidades", async () => {
    const { call, makeGroup } = setup();
    const { adminToken, tokens } = await makeGroup();
    await call("POST", `/api/admin/${adminToken}/draw`);

    // descobre quem Ana tirou
    const reveal = await call("POST", `/api/me/${tokens.Ana}/reveal`);
    const friend = reveal.data.giftee.name as string;

    const send = await call("POST", `/api/me/${tokens.Ana}/messages`, { thread: "giftee", body: "Você gosta de chocolate?" });
    expect(send.status).toBe(201);

    // o amigo vê a mensagem na conversa "giver", sem nome de ninguém
    const inbox = await call("GET", `/api/me/${tokens[friend]}`);
    expect(inbox.data.unread.giver).toBe(1);
    const read = await call("GET", `/api/me/${tokens[friend]}/messages?thread=giver`);
    expect(read.data.giver).toHaveLength(1);
    expect(read.data.giver[0].mine).toBe(false);
    expect(JSON.stringify(read.data)).not.toContain("Ana");
    expect((await call("GET", `/api/me/${tokens[friend]}`)).data.unread.giver).toBe(0);

    // resposta anônima volta para a Ana
    await call("POST", `/api/me/${tokens[friend]}/messages`, { thread: "giver", body: "Adoro!" });
    const back = await call("GET", `/api/me/${tokens.Ana}/messages?thread=giftee`);
    expect(back.data.giftee.map((m: any) => m.mine)).toEqual([true, false]);
  });

  test("não dá para mandar mensagem antes do sorteio", async () => {
    const { call, makeGroup } = setup();
    const { tokens } = await makeGroup();
    const r = await call("POST", `/api/me/${tokens.Ana}/messages`, { thread: "giftee", body: "oi" });
    expect(r.status).toBe(409);
  });
});

describe("validação e segurança", () => {
  test("links inexistentes dão 404", async () => {
    const { call } = setup();
    expect((await call("GET", "/api/admin/naoexiste")).status).toBe(404);
    expect((await call("GET", "/api/me/naoexiste")).status).toBe(404);
    expect((await call("GET", "/api/invite/naoexiste")).status).toBe(404);
  });

  test("um link de participante não abre o painel do organizador", async () => {
    const { call, makeGroup } = setup();
    const { tokens } = await makeGroup();
    expect((await call("GET", `/api/admin/${tokens.Ana}`)).status).toBe(404);
  });

  test("entradas inválidas são recusadas", async () => {
    const { call } = setup();
    expect((await call("POST", "/api/groups", { name: "", organizerName: "x" })).status).toBe(400);
    expect((await call("POST", "/api/groups", { name: "a".repeat(61), organizerName: "x" })).status).toBe(400);
    expect((await call("POST", "/api/groups", { name: "ok", organizerName: "x", eventDate: "2026-13-40" })).status).toBe(400);
    expect((await call("POST", "/api/groups", { name: "ok" })).status).toBe(400); // organizador participa mas sem nome
    expect((await call("POST", "/api/groups", { name: 123, organizerName: "x" })).status).toBe(400);
    const ok = await call("POST", "/api/groups", { name: "ok", organizerParticipates: false });
    expect(ok.status).toBe(201);
    expect(ok.data.participantToken).toBeNull();
  });

  test("HTML digitado vira texto puro (o site só usa textContent), e o convite escapa o título", async () => {
    const { call } = setup();
    const created = await call("POST", "/api/groups", { name: `<img src=x onerror=alert(1)>`, organizerName: "x" });
    const page = await call("GET", `/g/${created.data.inviteCode}`);
    expect(page.status).toBe(200);
    expect(page.data).not.toContain("<img src=x");
    expect(page.data).toContain("&lt;img");
  });

  test("cabeçalhos de segurança e privacidade", async () => {
    const { call, makeGroup } = setup();
    const { adminToken } = await makeGroup();
    const home = await call("GET", "/");
    expect(home.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(home.headers.get("x-content-type-options")).toBe("nosniff");
    expect(home.headers.get("referrer-policy")).toBe("no-referrer");
    expect(home.headers.get("x-robots-tag")).toBeNull();
    const priv = await call("GET", `/a/${adminToken}`);
    expect(priv.headers.get("x-robots-tag")).toContain("noindex");
    const api = await call("GET", `/api/admin/${adminToken}`);
    expect(api.headers.get("cache-control")).toBe("no-store");
  });

  test("não dá para sair da pasta pública", async () => {
    const { call } = setup();
    for (const p of ["/%2e%2e/src/app.ts", "/..%2fsrc%2fapp.ts", "/src/app.ts", "/data/amigo-secreto.db"]) {
      const r = await call("GET", p);
      expect(r.status).toBe(404);
      expect(String(r.data)).not.toContain("createApp");
    }
  });

  test("arquivos estáticos: gzip e ETag", async () => {
    const handle = createApp(openDb(":memory:"), config, { rateLimit: false });
    const get = (headers: Record<string, string> = {}) =>
      handle(new Request("http://teste/app.js", { headers }), "1.1.1.1");
    const first = await get({ "accept-encoding": "gzip" });
    expect(first.status).toBe(200);
    expect(first.headers.get("content-encoding")).toBe("gzip");
    const etag = first.headers.get("etag")!;
    const second = await get({ "if-none-match": etag });
    expect(second.status).toBe(304);
  });

  test("limitador de pedidos barra abuso na criação de grupos", async () => {
    const { call } = setup(true);
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      statuses.push((await call("POST", "/api/groups", { name: "g", organizerParticipates: false }, "7.7.7.7")).status);
    }
    expect(statuses.filter((s) => s === 201)).toHaveLength(8);
    expect(statuses.filter((s) => s === 429)).toHaveLength(2);
    // outro IP continua livre
    expect((await call("POST", "/api/groups", { name: "g", organizerParticipates: false }, "8.8.8.8")).status).toBe(201);
  });

  test("/healthz responde ok", async () => {
    const { call } = setup();
    const r = await call("GET", "/healthz");
    expect(r.status).toBe(200);
    expect(r.data).toBe("ok");
  });
});
