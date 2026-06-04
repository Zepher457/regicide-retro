import { beforeEach, describe, expect, it, vi } from "vitest";

type RoomRow = {
  room_code: string;
  host_member_id: string;
  max_players: number;
  phase: string;
  created_at?: string;
  updated_at: string;
};

type MemberRow = {
  room_code: string;
  player_id: string;
  client_id: string;
  display_name: string;
  seat: number;
  is_host: boolean;
  is_connected: boolean;
  ready: boolean;
};

type GameRow = {
  room_code: string;
  state: unknown;
  version: number;
  updated_at: string;
};

const fakeDb = {
  rooms: new Map<string, RoomRow>(),
  roomMembers: new Map<string, MemberRow[]>(),
  games: new Map<string, GameRow>(),
  gameActions: [] as Array<Record<string, unknown>>,
};

type FakeTableName = "rooms" | "room_members" | "games" | "game_actions";

class FakeSupabaseQuery {
  private filters = new Map<string, string>();
  private deleteMode = false;

  constructor(private table: FakeTableName) {}

  select() {
    return this;
  }

  delete() {
    this.deleteMode = true;
    return this;
  }

  eq(column: string, value: string) {
    this.filters.set(column, value);

    if (this.deleteMode) {
      if (this.table === "room_members") {
        fakeDb.roomMembers.delete(value);
      }
      return Promise.resolve({ error: null });
    }

    return this;
  }

  order(column: string, options: { ascending: boolean }) {
    const roomCode = this.filters.get("room_code") ?? "";
    const rows = [...(fakeDb.roomMembers.get(roomCode) ?? [])].sort((a, b) => {
      const left = Number(a[column as keyof MemberRow]);
      const right = Number(b[column as keyof MemberRow]);
      return options.ascending ? left - right : right - left;
    });
    return Promise.resolve({ data: rows, error: null });
  }

  maybeSingle() {
    const roomCode = this.filters.get("room_code") ?? "";

    if (this.table === "rooms") {
      return Promise.resolve({ data: fakeDb.rooms.get(roomCode) ?? null, error: null });
    }

    if (this.table === "games") {
      return Promise.resolve({ data: fakeDb.games.get(roomCode) ?? null, error: null });
    }

    return Promise.resolve({ data: null, error: null });
  }

  upsert(payload: RoomRow | GameRow) {
    if (this.table === "rooms") {
      const roomPayload = payload as RoomRow;
      const existing = fakeDb.rooms.get(payload.room_code);
      fakeDb.rooms.set(payload.room_code, {
        ...(existing ?? {
          room_code: roomPayload.room_code,
          host_member_id: roomPayload.host_member_id,
          max_players: roomPayload.max_players,
          phase: roomPayload.phase,
          created_at: new Date().toISOString(),
          updated_at: roomPayload.updated_at,
        }),
        ...roomPayload,
      } as RoomRow);
    }

    if (this.table === "games") {
      fakeDb.games.set(payload.room_code, payload as GameRow);
    }

    return Promise.resolve({ error: null });
  }

  insert(payload: MemberRow[] | Array<Record<string, unknown>>) {
    if (this.table === "room_members") {
      const members = payload as MemberRow[];
      const roomCode = members[0]?.room_code;
      if (roomCode) {
        fakeDb.roomMembers.set(roomCode, members);
      }
    }

    if (this.table === "game_actions") {
      fakeDb.gameActions.push(...payload);
    }

    return Promise.resolve({ error: null });
  }
}

const fakeSupabaseClient = {
  from(table: FakeTableName) {
    return new FakeSupabaseQuery(table);
  },
};

vi.mock("@/lib/supabase", () => ({
  getAdminSupabaseClient: () => fakeSupabaseClient,
}));

import {
  claimSeat,
  createRoom,
  getSnapshot,
  joinRoom,
  setMaxPlayers,
  setReady,
  startGame,
  submitMove,
} from "./store";
import type { GameMove } from "@/lib/game/types";

function clearRoomMemory() {
  (globalThis as typeof globalThis & { __regicideRooms?: Map<string, unknown> }).__regicideRooms?.clear();
}

describe.sequential("server store hydration", () => {
  beforeEach(() => {
    fakeDb.rooms.clear();
    fakeDb.roomMembers.clear();
    fakeDb.games.clear();
    fakeDb.gameActions.length = 0;
    clearRoomMemory();
  });

  it("rehydrates a room from Supabase for live game actions when memory is cold", async () => {
    const created = await createRoom("Host", "client-host", 2);
    await joinRoom(created.roomCode, "Guest", "client-guest");
    await setReady(created.roomCode, "client-guest", true);
    const started = await startGame(created.roomCode, "client-host");
    const firstCard = started.self?.hand[0];

    expect(firstCard).toBeDefined();

    clearRoomMemory();
    const rehydrated = await getSnapshot(created.roomCode, "client-host");
    expect(rehydrated.roomCode).toBe(created.roomCode);
    expect(rehydrated.self?.hand.length).toBe(started.self?.hand.length);

    clearRoomMemory();
    const move: GameMove =
      firstCard?.rank === "JOKER"
        ? { type: "playJester", playerId: started.self?.playerId ?? "", cardId: firstCard.id }
        : { type: "playSingle", playerId: started.self?.playerId ?? "", cardId: firstCard?.id ?? "" };
    const moved = await submitMove(created.roomCode, "client-host", move);

    expect(moved.roomCode).toBe(created.roomCode);
    expect(moved.self?.hand.some((card) => card.id === firstCard?.id)).toBe(false);
    expect(moved.phase).not.toBe("lobby");
  });

  it("lets the host change room size before the game starts", async () => {
    const created = await createRoom("Host", "client-host", 4);
    const resized = await setMaxPlayers(created.roomCode, "client-host", 3);

    expect(resized.maxPlayers).toBe(3);
    expect(fakeDb.rooms.get(created.roomCode)?.max_players).toBe(3);
  });

  it("blocks non-hosts and invalid reductions", async () => {
    const created = await createRoom("Host", "client-host", 4);
    await joinRoom(created.roomCode, "Guest", "client-guest");
    await joinRoom(created.roomCode, "Third", "client-third");

    await expect(setMaxPlayers(created.roomCode, "client-guest", 3)).rejects.toThrow("Only the host");
    await expect(setMaxPlayers(created.roomCode, "client-host", 2)).rejects.toThrow("too many players");
  });

  it("blocks reductions when an occupied seat is outside the new room size", async () => {
    const created = await createRoom("Host", "client-host", 4);
    await joinRoom(created.roomCode, "Guest", "client-guest");

    await claimSeat(created.roomCode, "client-guest", 2);
    await expect(setMaxPlayers(created.roomCode, "client-host", 2)).rejects.toThrow("Move players");
    await claimSeat(created.roomCode, "client-guest", 1);
    const resized = await setMaxPlayers(created.roomCode, "client-host", 2);
    expect(resized.maxPlayers).toBe(2);
  });

  it("blocks room edits during active play", async () => {
    const created = await createRoom("Host", "client-host", 2);
    await joinRoom(created.roomCode, "Guest", "client-guest");
    await setReady(created.roomCode, "client-guest", true);
    await startGame(created.roomCode, "client-host");

    await expect(setMaxPlayers(created.roomCode, "client-host", 3)).rejects.toThrow("active");
    await expect(claimSeat(created.roomCode, "client-guest", 0)).rejects.toThrow("active");
    await expect(setReady(created.roomCode, "client-guest", false)).rejects.toThrow("active");
  });

  it("allows room edits and a fresh start after the game ends", async () => {
    const created = await createRoom("Host", "client-host", 3);
    await joinRoom(created.roomCode, "Guest", "client-guest");
    await setReady(created.roomCode, "client-guest", true);
    const started = await startGame(created.roomCode, "client-host");
    const row = fakeDb.games.get(created.roomCode);
    expect(row).toBeDefined();
    fakeDb.games.set(created.roomCode, {
      ...row!,
      state: {
        ...(row!.state as Record<string, unknown>),
        phase: "lost",
        winner: "enemies",
      },
    });
    clearRoomMemory();

    const resized = await setMaxPlayers(created.roomCode, "client-host", 2);
    expect(resized.maxPlayers).toBe(2);
    expect(resized.players[0]?.handCount).toBe(0);

    const restarted = await startGame(created.roomCode, "client-host");
    expect(restarted.phase).toBe("playing");
    expect(restarted.game?.id).not.toBe(started.game?.id);
  });
});
