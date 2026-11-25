import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { HttpError, newInviteCode, newToken, nameKey } from "./util";

/* ------------------------------------------------------------------ *
 * Banco de dados (SQLite): um único arquivo, sem instalar nada.
 *
 *  groups        -> o grupo (nome, valor, data, local...) e os 2 códigos secretos
 *                   (admin_token = link do organizador, invite_code = link de convite)
 *  participants  -> cada pessoa, com o próprio token secreto (link pessoal),
 *                   a lista de desejos e quem ela tirou (giftee_id)
 *  exclusions    -> pares que não podem se tirar (ex.: casais)
 *  messages      -> mensagens anônimas entre quem tirou e quem foi tirado
 * ------------------------------------------------------------------ */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS groups (
  id          INTEGER PRIMARY KEY,
  admin_token TEXT    NOT NULL UNIQUE,
  invite_code TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  amount      TEXT    NOT NULL DEFAULT '',
  event_date  TEXT    NOT NULL DEFAULT '',
  location    TEXT    NOT NULL DEFAULT '',
  note        TEXT    NOT NULL DEFAULT '',
  drawn_at    INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
  id           INTEGER PRIMARY KEY,
  group_id     INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  token        TEXT    NOT NULL UNIQUE,
  name         TEXT    NOT NULL,
  name_key     TEXT    NOT NULL,
  wishes       TEXT    NOT NULL DEFAULT '',
  is_organizer INTEGER NOT NULL DEFAULT 0,
  giftee_id    INTEGER REFERENCES participants(id) ON DELETE SET NULL,
  revealed_at  INTEGER,
  created_at   INTEGER NOT NULL,
  UNIQUE (group_id, name_key)
);
CREATE INDEX IF NOT EXISTS idx_participants_group  ON participants(group_id);
CREATE INDEX IF NOT EXISTS idx_participants_giftee ON participants(giftee_id);

CREATE TABLE IF NOT EXISTS exclusions (
  group_id INTEGER NOT NULL REFERENCES groups(id)       ON DELETE CASCADE,
  a_id     INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  b_id     INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  PRIMARY KEY (a_id, b_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY,
  group_id   INTEGER NOT NULL REFERENCES groups(id)       ON DELETE CASCADE,
  from_id    INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  to_id      INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  body       TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  read_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_pair  ON messages(from_id, to_id);
CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id);
`;

export interface GroupRow {
  id: number;
  admin_token: string;
  invite_code: string;
  name: string;
  amount: string;
  event_date: string;
  location: string;
  note: string;
  drawn_at: number | null;
  created_at: number;
}

export interface PersonRow {
  id: number;
  group_id: number;
  token: string;
  name: string;
  name_key: string;
  wishes: string;
  is_organizer: number;
  giftee_id: number | null;
  revealed_at: number | null;
  created_at: number;
}

export interface MessageRow {
  from_id: number;
  body: string;
  created_at: number;
}

export interface GroupFields {
  name: string;
  amount: string;
  eventDate: string;
  location: string;
  note: string;
}

export function openDb(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  return db;
}

/** Apaga grupos antigos (privacidade + banco sempre pequeno). Retorna quantos foram apagados. */
export function purgeOldGroups(db: Database, days: number): number {
  const cutoff = Math.floor(Date.now() / 1000) - days * 86_400;
  return db.query("DELETE FROM groups WHERE created_at < ?").run(cutoff).changes;
}

export const MAX_MESSAGES_PER_DIRECTION = 100;

export function createRepo(db: Database) {
  const st = {
    groupByAdmin: db.query("SELECT * FROM groups WHERE admin_token = ?"),
    groupByInvite: db.query("SELECT * FROM groups WHERE invite_code = ?"),
    groupById: db.query("SELECT * FROM groups WHERE id = ?"),
    insertGroup: db.query(
      "INSERT INTO groups (admin_token, invite_code, name, amount, event_date, location, note, created_at) VALUES (?,?,?,?,?,?,?,?) RETURNING *",
    ),
    updateGroup: db.query("UPDATE groups SET name = ?, amount = ?, event_date = ?, location = ?, note = ? WHERE id = ?"),
    deleteGroup: db.query("DELETE FROM groups WHERE id = ?"),
    setDrawn: db.query("UPDATE groups SET drawn_at = ? WHERE id = ?"),

    personByToken: db.query("SELECT * FROM participants WHERE token = ?"),
    people: db.query("SELECT * FROM participants WHERE group_id = ? ORDER BY id"),
    personInGroup: db.query("SELECT * FROM participants WHERE id = ? AND group_id = ?"),
    insertPerson: db.query(
      "INSERT INTO participants (group_id, token, name, name_key, wishes, is_organizer, created_at) VALUES (?,?,?,?,?,?,?) RETURNING *",
    ),
    deletePerson: db.query("DELETE FROM participants WHERE id = ? AND group_id = ?"),
    setWishes: db.query("UPDATE participants SET wishes = ? WHERE id = ?"),
    giverOf: db.query("SELECT * FROM participants WHERE giftee_id = ?"),
    personById: db.query("SELECT * FROM participants WHERE id = ?"),
    reveal: db.query("UPDATE participants SET revealed_at = COALESCE(revealed_at, ?) WHERE id = ?"),
    setGiftee: db.query("UPDATE participants SET giftee_id = ?, revealed_at = NULL WHERE id = ?"),
    clearGiftees: db.query("UPDATE participants SET giftee_id = NULL, revealed_at = NULL WHERE group_id = ?"),

    exclusions: db.query("SELECT a_id, b_id FROM exclusions WHERE group_id = ?"),
    clearExclusions: db.query("DELETE FROM exclusions WHERE group_id = ?"),
    insertExclusion: db.query("INSERT OR IGNORE INTO exclusions (group_id, a_id, b_id) VALUES (?,?,?)"),

    insertMessage: db.query("INSERT INTO messages (group_id, from_id, to_id, body, created_at) VALUES (?,?,?,?,?)"),
    thread: db.query(
      "SELECT from_id, body, created_at FROM messages WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?) ORDER BY id LIMIT 300",
    ),
    sentCount: db.query("SELECT COUNT(*) AS n FROM messages WHERE from_id = ? AND to_id = ?"),
    markRead: db.query("UPDATE messages SET read_at = ? WHERE to_id = ? AND from_id = ? AND read_at IS NULL"),
    unread: db.query("SELECT COUNT(*) AS n FROM messages WHERE to_id = ? AND from_id = ? AND read_at IS NULL"),
    clearMessages: db.query("DELETE FROM messages WHERE group_id = ?"),
    ping: db.query("SELECT 1 AS ok"),
  };

  const one = <T>(row: unknown): T | null => (row ?? null) as T | null;

  const addPerson = (groupId: number, name: string, wishes: string, isOrganizer: boolean, ts: number): PersonRow => {
    try {
      return st.insertPerson.get(groupId, newToken(), name, nameKey(name), wishes, isOrganizer ? 1 : 0, ts) as PersonRow;
    } catch (e) {
      if (String(e).includes("UNIQUE")) {
        throw new HttpError(409, "Já tem alguém com esse nome no grupo. Use o sobrenome ou um apelido.");
      }
      throw e;
    }
  };

  const createGroup = db.transaction(
    (fields: GroupFields, organizer: { name: string; wishes: string } | null, ts: number) => {
      const group = st.insertGroup.get(
        newToken(),
        newInviteCode(),
        fields.name,
        fields.amount,
        fields.eventDate,
        fields.location,
        fields.note,
        ts,
      ) as GroupRow;
      const person = organizer ? addPerson(group.id, organizer.name, organizer.wishes, true, ts) : null;
      return { group, person };
    },
  );

  const setExclusions = db.transaction((groupId: number, pairs: Array<[number, number]>) => {
    st.clearExclusions.run(groupId);
    for (const [a, b] of pairs) st.insertExclusion.run(groupId, a, b);
  });

  const applyDraw = db.transaction((groupId: number, assignment: Map<number, number>, ts: number) => {
    for (const [giver, giftee] of assignment) st.setGiftee.run(giftee, giver);
    st.setDrawn.run(ts, groupId);
  });

  const resetDraw = db.transaction((groupId: number) => {
    st.clearGiftees.run(groupId);
    st.clearMessages.run(groupId);
    st.setDrawn.run(null, groupId);
  });

  return {
    createGroup,
    addPerson,
    setExclusions,
    applyDraw,
    resetDraw,
    groupByAdmin: (token: string) => one<GroupRow>(st.groupByAdmin.get(token)),
    groupByInvite: (code: string) => one<GroupRow>(st.groupByInvite.get(code)),
    groupById: (id: number) => one<GroupRow>(st.groupById.get(id)),
    updateGroup: (id: number, f: GroupFields) =>
      void st.updateGroup.run(f.name, f.amount, f.eventDate, f.location, f.note, id),
    deleteGroup: (id: number) => void st.deleteGroup.run(id),

    personByToken: (token: string) => one<PersonRow>(st.personByToken.get(token)),
    personById: (id: number) => one<PersonRow>(st.personById.get(id)),
    personInGroup: (id: number, groupId: number) => one<PersonRow>(st.personInGroup.get(id, groupId)),
    listPeople: (groupId: number) => st.people.all(groupId) as PersonRow[],
    removePerson: (id: number, groupId: number) => st.deletePerson.run(id, groupId).changes > 0,
    setWishes: (id: number, wishes: string) => void st.setWishes.run(wishes, id),
    giverOf: (personId: number) => one<PersonRow>(st.giverOf.get(personId)),
    reveal: (id: number, ts: number) => void st.reveal.run(ts, id),

    listExclusions: (groupId: number) =>
      (st.exclusions.all(groupId) as Array<{ a_id: number; b_id: number }>).map((r): [number, number] => [r.a_id, r.b_id]),

    addMessage: (groupId: number, from: number, to: number, body: string, ts: number) => {
      const sent = (st.sentCount.get(from, to) as { n: number }).n;
      if (sent >= MAX_MESSAGES_PER_DIRECTION) {
        throw new HttpError(429, "Você já mandou muitas mensagens nessa conversa. Dê um tempinho pro seu amigo ler!");
      }
      st.insertMessage.run(groupId, from, to, body, ts);
    },
    thread: (me: number, other: number) => st.thread.all(me, other, other, me) as MessageRow[],
    markRead: (me: number, other: number, ts: number) => void st.markRead.run(ts, me, other),
    unread: (me: number, other: number) => (st.unread.get(me, other) as { n: number }).n,

    ping: () => void st.ping.get(),
  };
}

export type Repo = ReturnType<typeof createRepo>;
