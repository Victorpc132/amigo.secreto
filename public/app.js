/* Amigo Secreto de Natal - site (sem frameworks, para carregar rápido).
 *
 * Como ler este arquivo:
 *  1. utilidades (criar elementos, falar com o servidor, copiar link...)
 *  2. "telas": início, convite, organizador, participante
 *  3. roteador: olha o endereço e decide qual tela mostrar
 *
 * Segurança: todo texto vindo do servidor entra na página como TEXTO
 * (nunca como HTML), então ninguém consegue injetar código no site.
 */
(() => {
  "use strict";

  const $app = document.getElementById("app");
  const $toasts = document.getElementById("toasts");
  let gen = 0; // número da "tela atual": evita desenhar resposta atrasada de uma tela antiga
  let timers = [];

  /* ============================ 1. utilidades ============================ */

  /** Cria um elemento: h("div", {class: "card"}, "texto", outroElemento) */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value == null || value === false) continue;
      if (key === "class") el.className = value;
      else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
      else if (value === true) el.setAttribute(key, "");
      else el.setAttribute(key, value);
    }
    append(el, kids);
    return el;
  }
  function append(el, kids) {
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : String(kid));
    }
  }

  const abs = (path) => location.origin + path;
  const waLink = (msg) => "https://wa.me/?text=" + encodeURIComponent(msg);
  const fmtDate = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
  const fmtTime = (s) =>
    new Date(s * 1000).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  function toast(message, kind) {
    const el = h("div", { class: "toast" + (kind === "error" ? " error" : "") }, message);
    $toasts.append(el);
    setTimeout(() => el.remove(), 3500);
  }

  /** Fala com o servidor. Em caso de erro, lança um Error com mensagem amigável. */
  async function api(method, path, body) {
    let res;
    try {
      res = await fetch("/api" + path, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error("Sem conexão com o servidor. Confira sua internet e tente de novo.");
    }
    let data = null;
    try { data = await res.json(); } catch { /* resposta sem JSON */ }
    if (!res.ok) throw new Error((data && data.error) || "Algo deu errado. Tente de novo.");
    return data;
  }

  /** Roda uma ação travando o botão e mostrando qualquer erro num aviso. */
  async function run(button, action) {
    if (button) button.disabled = true;
    try {
      return await action();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = h("textarea", { class: "offscreen", "aria-hidden": "true" });
      ta.value = value;
      document.body.append(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* sem suporte */ }
      ta.remove();
    }
    toast("Link copiado! 📋");
  }

  const copyButton = (value, label) =>
    h("button", { type: "button", class: "btn ghost sm", onclick: () => copyText(value) }, label || "Copiar link");

  const waButton = (message, label) =>
    h("a", { class: "btn green sm", href: waLink(message), target: "_blank", rel: "noopener noreferrer" }, label || "WhatsApp");

  const field = (label, input, hint) =>
    h("label", { class: "field" }, h("span", { class: "label" }, label), input, hint && h("span", { class: "hint" }, hint));

  const textInput = (props) => h("input", { type: "text", autocomplete: "off", maxlength: 60, ...props });
  const area = (props, value) => h("textarea", { maxlength: 300, ...props }, value || "");

  /** Lembra, neste aparelho, os links que a pessoa já usou (para voltar depois). */
  const MEM_KEY = "amigo-secreto:v1";
  const mem = {
    load() {
      try { return JSON.parse(localStorage.getItem(MEM_KEY)) || []; } catch { return []; }
    },
    write(list) {
      try { localStorage.setItem(MEM_KEY, JSON.stringify(list.slice(0, 20))); } catch { /* modo privado */ }
    },
    save(item) {
      const list = this.load();
      const i = list.findIndex((x) => x.path === item.path);
      const merged = Object.assign(i >= 0 ? list.splice(i, 1)[0] : {}, item);
      this.write([merged, ...list]);
    },
    remove(path) {
      this.write(this.load().filter((x) => x.path !== path));
    },
  };

  function groupChips(group) {
    const items = [];
    if (group.amount) items.push("💰 " + group.amount);
    if (group.eventDate) items.push("📅 " + fmtDate(group.eventDate));
    if (group.location) items.push("📍 " + group.location);
    return items.length ? h("div", { class: "chips" }, items.map((t) => h("span", { class: "chip" }, t))) : null;
  }

  function show(...nodes) {
    $app.replaceChildren(...nodes.flat().filter(Boolean));
  }

  function viewError(message) {
    document.title = "Ops! · Amigo Secreto";
    show(
      h("div", { class: "card center stack" },
        h("div", { class: "emoji" }, "🙈"),
        h("h1", {}, "Ops!"),
        h("p", {}, message || "Não encontramos essa página."),
        h("a", { class: "btn", href: "/", "data-link": true }, "Ir para o início"),
      ),
    );
  }

  /* ============================ 2. telas ============================ */

  /* ---------- Início: criar grupo ---------- */
  function viewHome() {
    document.title = "Amigo Secreto de Natal";
    const saved = mem.load();

    const participates = h("input", { type: "checkbox", name: "participates", checked: true });
    const nameBox = h("div", {}, field("Seu nome", textInput({ name: "organizerName", maxlength: 40, placeholder: "Como seus amigos te chamam" })));
    participates.addEventListener("change", () => { nameBox.hidden = !participates.checked; });

    const submit = h("button", { class: "btn block", type: "submit" }, "Criar grupo", h("span", { class: "btn-arrow", "aria-hidden": true }, "→"));
    const form = h("form", { class: "card stack home-form", novalidate: true },
      h("div", { class: "form-heading" },
        h("span", { class: "form-heading-icon", "aria-hidden": true }, "✦"),
        h("div", {},
          h("h2", {}, "Comece por aqui"),
          h("p", {}, "Seu grupo fica pronto em instantes."),
        ),
      ),
      field("Nome do grupo", textInput({ name: "name", placeholder: "Ex.: Natal da família 2026", required: true })),
      h("label", { class: "check" }, participates, "Eu também vou participar do sorteio"),
      nameBox,
      h("details", {},
        h("summary", {}, "Mais opções (valor, data, local)"),
        h("div", { class: "stack" },
          h("div", { class: "split" },
            field("Valor do presente", textInput({ name: "amount", maxlength: 30, placeholder: "Ex.: R$ 50" })),
            field("Data da troca", h("input", { type: "date", name: "eventDate" })),
          ),
          field("Local", textInput({ name: "location", maxlength: 80, placeholder: "Ex.: casa da vó" })),
          field("Recado para a turma", area({ name: "note", placeholder: "Ex.: levar o presente embrulhado!" })),
        ),
      ),
      submit,
    );

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const f = new FormData(form);
      run(submit, async () => {
        const body = {
          name: f.get("name"),
          organizerParticipates: participates.checked,
          organizerName: f.get("organizerName"),
          amount: f.get("amount"),
          eventDate: f.get("eventDate"),
          location: f.get("location"),
          note: f.get("note"),
        };
        const r = await api("POST", "/groups", body);
        mem.save({ kind: "a", path: "/a/" + r.adminToken, name: body.name });
        if (r.participantToken) mem.save({ kind: "p", path: "/p/" + r.participantToken, name: body.name });
        navigate("/a/" + r.adminToken);
      });
    });

    show(
      h("div", { class: "home-layout" },
        h("section", { class: "hero" },
          h("span", { class: "hero-eyebrow" }, "UMA SURPRESA BOA COMEÇA AQUI"),
          h("h1", {}, "Amigo secreto, ", h("span", {}, "sem complicação.")),
          h("p", {}, "Junte a família e os amigos para um sorteio leve, divertido e cheio de expectativa. Você cria o grupo; a surpresa fica por nossa conta."),
          h("div", { class: "hero-points" },
            h("span", {}, "Sem cadastro"),
            h("span", {}, "Convite fácil"),
            h("span", {}, "Resultado secreto"),
          ),
          h("div", { class: "hero-art", "aria-hidden": true },
            h("span", { class: "art-sparkle sparkle-one" }, "✦"),
            h("span", { class: "art-sparkle sparkle-two" }, "✧"),
            h("div", { class: "gift-illustration" },
              h("span", { class: "gift-box gift-box-back" },
                h("span", { class: "gift-lid" }),
                h("span", { class: "gift-ribbon" }),
                h("span", { class: "gift-bow" }),
              ),
              h("span", { class: "gift-box gift-box-front" },
                h("span", { class: "gift-lid" }),
                h("span", { class: "gift-ribbon" }),
                h("span", { class: "gift-bow" }),
              ),
            ),
            h("span", { class: "art-caption" }, "A brincadeira começa com você"),
          ),
        ),
        h("div", { class: "home-side" },
          form,
          h("section", { class: "card home-steps" },
            h("h2", {}, "Simples assim"),
            h("ol", { class: "steps" },
              h("li", {}, h("span", {}, h("b", {}, "Crie o grupo "), "e receba o link de convite.")),
              h("li", {}, h("span", {}, h("b", {}, "Chame a turma: "), "cada um entra e deixa suas dicas de presente.")),
              h("li", {}, h("span", {}, h("b", {}, "Sorteie! "), "Cada pessoa recebe um link secreto e descobre quem tirou. Nem você, organizador, vê.")),
            ),
          ),
          saved.length ? savedList(saved) : null,
        ),
      ),
    );
  }

  function savedList(saved) {
    return h("section", { class: "card" },
      h("h2", {}, "Seus grupos neste aparelho"),
      h("ul", { class: "people" },
        saved.map((s) =>
          h("li", { class: "person" },
            h("a", { class: "grow", href: s.path, "data-link": true }, s.name, h("span", { class: "badge" }, s.kind === "a" ? "organizador" : "participante")),
            h("button", { type: "button", class: "btn ghost sm", "aria-label": "Esquecer " + s.name, onclick: () => { mem.remove(s.path); viewHome(); } }, "✕"),
          ),
        ),
      ),
    );
  }

  /* ---------- Convite: entrar no grupo ---------- */
  async function viewInvite(code) {
    const g = gen;
    let d;
    try { d = await api("GET", "/invite/" + code); } catch (e) { if (g === gen) viewError(e.message); return; }
    if (g !== gen) return;

    document.title = "Convite: " + d.group.name;
    const already = mem.load().find((x) => x.invite === location.pathname);

    const head = [
      h("section", { class: "hero" },
        h("h1", {}, "Você foi convidado! 🎁"),
        h("p", {}, `Amigo secreto "${d.group.name}" · ${plural(d.count, "pessoa", "pessoas")} no grupo`),
      ),
      groupChips(d.group),
      d.group.note && h("p", { class: "note" }, d.group.note),
    ];

    if (already) {
      return show(head, h("div", { class: "card stack center" },
        h("p", {}, "Você já entrou neste grupo neste aparelho."),
        h("a", { class: "btn block", href: already.path, "data-link": true }, "Abrir meu link"),
      ));
    }
    if (d.group.drawn) {
      return show(head, h("div", { class: "card center" }, "O sorteio já foi feito 😕 Peça ao organizador para refazer, se quiser entrar."));
    }

    const submit = h("button", { class: "btn block", type: "submit" }, "Entrar no grupo");
    const form = h("form", { class: "card stack", novalidate: true },
      field("Seu nome", textInput({ name: "name", maxlength: 40, placeholder: "Como a turma te conhece", required: true })),
      field("Dicas de presente (opcional)", area({ name: "wishes", placeholder: "Ex.: gosto de livros, chocolate, meias" }), "Quem te tirar vai ver isso."),
      submit,
    );
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const f = new FormData(form);
      run(submit, async () => {
        const r = await api("POST", `/invite/${code}/join`, { name: f.get("name"), wishes: f.get("wishes") });
        mem.save({ kind: "p", path: "/p/" + r.participantToken, name: d.group.name, invite: location.pathname });
        toast("Você entrou! Guarde este link 🎄");
        navigate("/p/" + r.participantToken);
      });
    });
    show(head, form);
  }

  /* ---------- Organizador ---------- */
  async function viewAdmin(token) {
    const g = gen;
    let d;
    try { d = await api("GET", "/admin/" + token); } catch (e) { if (g === gen) viewError(e.message); return; }
    if (g !== gen) return;

    mem.save({ kind: "a", path: "/a/" + token, name: d.group.name });
    const openSections = new Set();
    let focusAdd = false;

    const reload = async () => {
      const fresh = await api("GET", "/admin/" + token);
      if (g !== gen) return;
      d = fresh;
      paint();
    };
    /** Chama a API, avisa e redesenha a tela. */
    const call = async (method, path, body, okMessage) => {
      await api(method, "/admin/" + token + path, body);
      if (okMessage) toast(okMessage);
      await reload();
    };
    const section = (key, title, ...children) =>
      h("details", { open: openSections.has(key), ontoggle: (e) => (e.target.open ? openSections.add(key) : openSections.delete(key)) },
        h("summary", {}, title),
        h("div", { class: "stack" }, children),
      );

    const inviteUrl = () => abs("/g/" + d.group.inviteCode);
    const personUrl = (p) => abs("/p/" + p.token);

    function paint() {
      document.title = d.group.name + " · Organizador";
      const people = d.participants;
      const drawn = d.group.drawn;

      /* convite */
      const invite = h("section", { class: "card stack" },
        h("h2", {}, "1. Chame a turma"),
        drawn ? h("p", { class: "muted" }, "O sorteio já foi feito, então o convite está fechado.") : [
          h("p", { class: "muted" }, "Mande este convite no grupo da família ou dos amigos. Cada um entra e deixa as próprias dicas de presente."),
          h("input", { type: "text", readonly: true, value: inviteUrl(), "aria-label": "Link de convite", onfocus: (e) => e.target.select() }),
          h("div", { class: "row wrap" },
            copyButton(inviteUrl(), "Copiar convite"),
            waButton(`Vamos fazer o amigo secreto "${d.group.name}"! 🎁 Entre pelo link e deixe suas dicas de presente: ${inviteUrl()}`, "Enviar no WhatsApp"),
          ),
        ],
      );

      /* participantes */
      const addName = textInput({ name: "name", maxlength: 40, placeholder: "Nome", "aria-label": "Nome da pessoa" });
      const addWishes = textInput({ name: "wishes", maxlength: 300, placeholder: "Dicas de presente (opcional)", "aria-label": "Dicas de presente" });
      const addBtn = h("button", { class: "btn", type: "submit" }, "Adicionar");
      const addForm = h("form", { class: "stack", novalidate: true }, addName, addWishes, addBtn);
      addForm.addEventListener("submit", (e) => {
        e.preventDefault();
        run(addBtn, async () => {
          focusAdd = true;
          await call("POST", "/participants", { name: addName.value, wishes: addWishes.value });
        });
      });

      const list = people.length
        ? h("ul", { class: "people" }, people.map((p) =>
            h("li", { class: "person" },
              h("div", { class: "grow" },
                h("strong", {}, p.name),
                p.isOrganizer && h("span", { class: "badge" }, "organizador"),
                p.wishes && h("span", { class: "wishes" }, "💡 " + p.wishes),
              ),
              drawn
                ? h("div", { class: "actions" },
                    h("span", { class: "badge " + (p.revealed ? "ok" : "") }, p.revealed ? "✓ já viu" : "ainda não viu"),
                    p.isOrganizer
                      ? h("a", { class: "btn green sm", href: "/p/" + p.token, "data-link": true }, "Ver o meu")
                      : [
                          copyButton(personUrl(p)),
                          waButton(`Oi, ${p.name}! 🎅 O sorteio do amigo secreto "${d.group.name}" foi feito. Seu link secreto: ${personUrl(p)}`),
                        ],
                  )
                : h("button", {
                    type: "button", class: "btn ghost sm", "aria-label": "Remover " + p.name,
                    onclick: (e) => run(e.currentTarget, () => call("DELETE", "/participants/" + p.id)),
                  }, "✕"),
            ),
          ))
        : h("p", { class: "empty" }, "Ninguém ainda. Compartilhe o convite ou adicione pessoas aqui.");

      const peopleCard = h("section", { class: "card stack" },
        h("h2", {}, `2. Participantes (${people.length})`),
        drawn && h("p", { class: "muted" }, "Envie para cada pessoa o link dela. Você não vê quem tirou quem."),
        list,
        !drawn && section("add", "Adicionar alguém manualmente", addForm),
      );

      /* restrições */
      let restrictions = null;
      if (!drawn && people.length >= 3) {
        const byId = new Map(people.map((p) => [p.id, p.name]));
        const options = () => people.map((p) => h("option", { value: p.id }, p.name));
        const a = h("select", { "aria-label": "Primeira pessoa" }, options());
        const b = h("select", { "aria-label": "Segunda pessoa" }, options());
        b.selectedIndex = 1;
        const addPair = h("button", { type: "button", class: "btn ghost sm" }, "Adicionar restrição");
        addPair.addEventListener("click", () =>
          run(addPair, async () => {
            if (a.value === b.value) throw new Error("Escolha duas pessoas diferentes.");
            openSections.add("rules");
            await call("PUT", "/exclusions", { pairs: [...d.exclusions, [Number(a.value), Number(b.value)]] });
          }),
        );
        restrictions = section("rules", `Quem não pode tirar quem? (${d.exclusions.length})`,
          h("p", { class: "muted" }, "Útil para casais, por exemplo. Vale nos dois sentidos."),
          d.exclusions.length
            ? h("ul", { class: "people" }, d.exclusions.map(([x, y]) =>
                h("li", { class: "person" },
                  h("span", { class: "grow" }, `${byId.get(x)} ↔ ${byId.get(y)}`),
                  h("button", {
                    type: "button", class: "btn ghost sm", "aria-label": "Remover restrição",
                    onclick: (e) => run(e.currentTarget, () => call("PUT", "/exclusions", { pairs: d.exclusions.filter(([p, q]) => !(p === x && q === y)) })),
                  }, "✕"),
                ),
              ))
            : null,
          h("div", { class: "split" }, a, b),
          addPair,
        );
      }

      /* sorteio */
      let drawCard;
      if (!drawn) {
        const ready = people.length >= 3;
        const btn = h("button", { class: "btn block", type: "button", disabled: !ready }, "🎁 Sortear agora");
        btn.addEventListener("click", () => {
          if (!confirm(`Sortear com ${plural(people.length, "pessoa", "pessoas")}? Depois disso ninguém entra nem sai sem refazer o sorteio.`)) return;
          run(btn, () => call("POST", "/draw", undefined, "Sorteio feito! 🎉"));
        });
        drawCard = h("section", { class: "card stack" },
          h("h2", {}, "3. Sortear"),
          ready ? h("p", { class: "muted" }, "Quando todo mundo entrou, é só sortear.") : h("p", { class: "muted" }, `Precisa de pelo menos 3 pessoas (agora: ${people.length}).`),
          restrictions,
          btn,
        );
      } else {
        const redo = h("button", { class: "btn danger sm", type: "button" }, "Refazer sorteio");
        redo.addEventListener("click", () => {
          if (!confirm("Refazer o sorteio? O resultado atual e as mensagens secretas serão apagados. Os links de cada pessoa continuam os mesmos.")) return;
          run(redo, () => call("POST", "/reset", undefined, "Sorteio desfeito. Você pode sortear de novo."));
        });
        drawCard = h("section", { class: "card stack success" },
          h("h2", {}, "3. Sorteio feito! 🎉"),
          h("p", {}, "Agora é só mandar para cada pessoa o link dela (botões acima). Cada um descobre quem tirou ao abrir o próprio link."),
          h("p", { class: "muted" }, `${people.filter((p) => p.revealed).length} de ${people.length} já viram o resultado.`),
          redo,
        );
      }

      /* editar grupo */
      const eName = textInput({ name: "name", value: d.group.name });
      const eAmount = textInput({ name: "amount", maxlength: 30, value: d.group.amount, placeholder: "Ex.: R$ 50" });
      const eDate = h("input", { type: "date", name: "eventDate", value: d.group.eventDate });
      const eLoc = textInput({ name: "location", maxlength: 80, value: d.group.location });
      const eNote = area({ name: "note" }, d.group.note);
      const saveBtn = h("button", { class: "btn sm", type: "submit" }, "Salvar");
      const editForm = h("form", { class: "stack", novalidate: true },
        field("Nome do grupo", eName),
        h("div", { class: "split" }, field("Valor do presente", eAmount), field("Data da troca", eDate)),
        field("Local", eLoc),
        field("Recado para a turma", eNote),
        saveBtn,
      );
      editForm.addEventListener("submit", (e) => {
        e.preventDefault();
        run(saveBtn, () => call("PATCH", "", { name: eName.value, amount: eAmount.value, eventDate: eDate.value, location: eLoc.value, note: eNote.value }, "Salvo ✓"));
      });

      const adminUrl = abs("/a/" + token);
      const del = h("button", { class: "btn danger sm", type: "button" }, "Apagar grupo");
      del.addEventListener("click", () => {
        if (!confirm("Apagar o grupo para sempre? Todos os links deixam de funcionar.")) return;
        run(del, async () => {
          await api("DELETE", "/admin/" + token);
          mem.remove("/a/" + token);
          for (const p of d.participants) mem.remove("/p/" + p.token);
          toast("Grupo apagado.");
          navigate("/");
        });
      });

      const tools = h("section", { class: "card stack" },
        h("div", { class: "keybox stack" },
          h("strong", {}, "🔑 Seu link de organizador"),
          h("p", { class: "muted" }, "Guarde! É a única forma de voltar aqui. Não compartilhe com os participantes."),
          copyButton(adminUrl, "Copiar link do organizador"),
        ),
        section("edit", "Editar dados do grupo", editForm),
        section("danger", "Apagar grupo", h("p", { class: "muted" }, "Remove o grupo e tudo dentro dele."), del),
      );

      show(
        h("h1", {}, d.group.name),
        groupChips(d.group),
        h("p", { class: "muted" }, drawn ? "Sorteio feito ✅" : "Sorteio ainda não feito"),
        invite, peopleCard, drawCard, tools,
      );
      if (focusAdd) {
        focusAdd = false;
        const input = $app.querySelector('input[aria-label="Nome da pessoa"]');
        if (input) input.focus();
      }
    }
    paint();
  }

  /* ---------- Participante ---------- */
  async function viewMe(token) {
    const g = gen;
    let d;
    try { d = await api("GET", "/me/" + token); } catch (e) { if (g === gen) viewError(e.message); return; }
    if (g !== gen) return;

    mem.save({ kind: "p", path: "/p/" + token, name: d.group.name });
    document.title = d.group.name + " · Amigo Secreto";

    let tab = "giftee";
    let msgs = { giftee: [], giver: [] };
    let $thread = null;
    let $tabs = null;

    const typing = () => document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);

    /* --- cartões --- */
    const waiting = () =>
      h("section", { class: "card center stack" },
        h("div", { class: "emoji" }, "⏳"),
        h("h2", {}, "O sorteio ainda não foi feito"),
        h("p", { class: "muted" }, `${plural(d.count, "pessoa", "pessoas")} no grupo. Guarde este link: é por ele que você vai descobrir quem tirou.`),
      );

    const giftCard = () => {
      const btn = h("button", { class: "gift", type: "button" }, h("span", { class: "emoji" }, "🎁"), "Descobrir meu amigo secreto");
      btn.addEventListener("click", () =>
        run(btn, async () => {
          d = await api("POST", `/me/${token}/reveal`);
          paint(true);
        }),
      );
      return h("div", { class: "card stack" }, h("p", { class: "center muted" }, "O sorteio foi feito! Toque para revelar. Dica: faça isso longe de olhares curiosos 👀"), btn);
    };

    const resultCard = (animate) =>
      h("section", { class: "card result stack" + (animate ? " pop" : "") },
        h("div", { class: "emoji" }, "🎅"),
        h("p", { class: "muted" }, "Você tirou:"),
        h("div", { class: "big" }, d.giftee.name),
        d.giftee.wishes
          ? h("p", { class: "note" }, "💡 Dicas de presente: " + d.giftee.wishes)
          : h("p", { class: "muted" }, `${d.giftee.name} ainda não deixou dicas de presente. Que tal perguntar por mensagem anônima?`),
        h("p", { class: "muted" }, "🤫 Segredo! Não conte para ninguém."),
      );

    const tabLabel = (key, text) =>
      h("button", { type: "button", role: "tab", class: "tab", "data-tab": key, onclick: () => { tab = key; loadMessages(); } },
        text, d.unread[key] > 0 && h("span", { class: "badge unread" }, String(d.unread[key])));

    function paintThread() {
      if (!$thread) return;
      $tabs.replaceChildren(
        tabLabel("giftee", "💌 Para " + d.giftee.name),
        tabLabel("giver", "🤫 Quem me tirou"),
      );
      for (const b of $tabs.children) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
      const list = msgs[tab];
      const otherName = tab === "giftee" ? d.giftee.name : "Seu amigo secreto";
      const atBottom = $thread.scrollHeight - $thread.scrollTop - $thread.clientHeight < 40;
      $thread.replaceChildren(
        ...(list.length
          ? list.map((m) => h("div", { class: "bubble" + (m.mine ? " mine" : "") }, m.body, h("small", {}, `${m.mine ? "Você" : otherName} · ${fmtTime(m.at)}`)))
          : [h("p", { class: "empty" }, tab === "giftee"
              ? `Mande uma pista ou pergunta para ${d.giftee.name}. Ele(a) vê como "Seu amigo secreto", sem saber que é você.`
              : "Ainda sem mensagens. Quando seu amigo secreto escrever, aparece aqui. Você pode responder sem saber quem é.")]),
      );
      if (atBottom) $thread.scrollTop = $thread.scrollHeight;
    }

    async function loadMessages() {
      try {
        const r = await api("GET", `/me/${token}/messages?thread=${tab}`);
        if (g !== gen) return;
        msgs = r;
        d.unread[tab] = 0;
        paintThread();
      } catch (e) { /* tenta de novo no próximo ciclo */ }
    }

    const messagesCard = () => {
      $tabs = h("div", { class: "tabs", role: "tablist" });
      $thread = h("div", { class: "thread", "aria-live": "polite" });
      const input = area({ name: "body", maxlength: 500, placeholder: "Escreva uma mensagem secreta…", "aria-label": "Mensagem" });
      const send = h("button", { class: "btn block", type: "submit" }, "Enviar mensagem");
      const form = h("form", { class: "stack", novalidate: true }, input, send);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        run(send, async () => {
          await api("POST", `/me/${token}/messages`, { thread: tab, body: input.value });
          input.value = "";
          await loadMessages();
          $thread.scrollTop = $thread.scrollHeight;
        });
      });
      return h("section", { class: "card stack" }, h("h2", {}, "Mensagens secretas"), $tabs, $thread, form);
    };

    const wishesCard = () => {
      const input = area({ name: "wishes", placeholder: "Ex.: gosto de livros, chocolate, meias tamanho 40" }, d.me.wishes);
      const save = h("button", { class: "btn sm", type: "submit" }, "Salvar dicas");
      const form = h("form", { class: "stack", novalidate: true }, input, save);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        run(save, async () => {
          await api("PATCH", "/me/" + token, { wishes: input.value });
          d.me.wishes = input.value.trim();
          toast("Dicas salvas ✓");
        });
      });
      return h("section", { class: "card stack" },
        h("h2", {}, "Minhas dicas de presente"),
        h("p", { class: "muted" }, "Quem te tirou vai ver isso. Pode mudar quando quiser."),
        form,
      );
    };

    /* --- desenho da tela --- */
    function paint(animate) {
      $thread = null;
      show(
        h("h1", {}, `Oi, ${d.me.name}! ${d.drawn ? "🎅" : "🎄"}`),
        h("p", { class: "muted" }, `Grupo: ${d.group.name}`),
        groupChips(d.group),
        d.group.note && h("p", { class: "note" }, d.group.note),
        !d.drawn ? waiting() : !d.revealed ? giftCard() : [resultCard(animate), messagesCard()],
        wishesCard(),
        h("p", { class: "center" }, h("a", { href: "/", "data-link": true }, "Criar meu próprio grupo")),
      );
      if (d.drawn && d.revealed) { paintThread(); loadMessages(); }
    }
    paint(false);

    /* --- atualização automática (a cada 20s, só com a aba visível) --- */
    timers.push(setInterval(async () => {
      if (document.hidden || g !== gen) return;
      try {
        const fresh = await api("GET", "/me/" + token);
        if (g !== gen) return;
        const changed = fresh.drawn !== d.drawn || fresh.revealed !== d.revealed || fresh.count !== d.count;
        d = fresh;
        if (changed && !typing()) paint(false);
        else if (d.revealed) loadMessages();
      } catch { /* sem internet agora: tenta depois */ }
    }, 20000));
  }

  /* ============================ 3. roteador ============================ */

  function navigate(path) {
    history.pushState(null, "", path);
    route();
  }

  function route() {
    gen++;
    timers.forEach(clearInterval);
    timers = [];
    window.scrollTo(0, 0);

    const path = location.pathname;
    let m;
    if (path === "/") return viewHome();
    if ((m = path.match(/^\/g\/([^/]+)\/?$/))) return viewInvite(m[1]);
    if ((m = path.match(/^\/a\/([^/]+)\/?$/))) return viewAdmin(m[1]);
    if ((m = path.match(/^\/p\/([^/]+)\/?$/))) return viewMe(m[1]);
    return viewError("Não encontramos essa página.");
  }

  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[data-link]");
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(a.getAttribute("href"));
  });
  window.addEventListener("popstate", route);

  /* neve decorativa (só CSS animando; respeita "reduzir movimento") */
  (function snow() {
    const box = document.getElementById("snow");
    for (let i = 0; i < 14; i++) {
      const f = document.createElement("span");
      f.textContent = "❄";
      f.style.left = Math.random() * 100 + "vw";
      f.style.fontSize = 10 + Math.random() * 14 + "px";
      f.style.opacity = String(0.35 + Math.random() * 0.5);
      f.style.animationDuration = 9 + Math.random() * 10 + "s";
      f.style.animationDelay = -Math.random() * 18 + "s";
      box.append(f);
    }
  })();

  route();
})();
