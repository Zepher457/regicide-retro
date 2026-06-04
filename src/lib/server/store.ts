import { getAdminSupabaseClient } from "@/lib/supabase";
import { applyMove, createInitialGameState, handLimitForPlayerCount, makeRoomCode, toPublicGameState } from "@/lib/game/engine";
import type {
  GameMove,
  GameState,
  PublicPlayerState,
  RoomSnapshot,
  SignalType,
  PlayerState,
} from "@/lib/game/types";

interface MemberRecord {
  id: string;
  clientId: string;
  name: string;
  seat: number;
  isHost: boolean;
  isConnected: boolean;
  ready: boolean;
}

interface RoomRecord {
  roomCode: string;
  createdAt: string;
  updatedAt: string;
  maxPlayers: number;
  hostMemberId: string;
  phase: GameSnapshotPhase;
  members: MemberRecord[];
  game: GameState | null;
}

type GameSnapshotPhase = RoomSnapshot["phase"];

const memory = globalThis as typeof globalThis & {
  __regicideRooms?: Map<string, RoomRecord>;
};

memory.__regicideRooms ??= new Map<string, RoomRecord>();

function now() {
  return new Date().toISOString();
}

function uid(prefix: string) {
  return `${prefix}_${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10)}`;
}

function sortMembers(members: MemberRecord[]) {
  return [...members].sort((a, b) => a.seat - b.seat);
}

function isFinishedGame(game: GameState | null) {
  return game?.phase === "won" || game?.phase === "lost";
}

function isRoomEditable(room: RoomRecord) {
  return !room.game || isFinishedGame(room.game);
}

function assertRoomEditable(room: RoomRecord, message = "Room settings cannot be changed while a game is active.") {
  if (!isRoomEditable(room)) throw new Error(message);
}

function normalizePlayers(members: MemberRecord[]) {
  return sortMembers(members).map((entry, index) => ({
    id: entry.id,
    name: entry.name,
    seat: index,
    isHost: entry.isHost,
    isConnected: entry.isConnected,
    ready: entry.ready,
    hand: [],
    shield: 0,
    lastActionWasYield: false,
    signal: null,
    handLimit: handLimitForPlayerCount(members.length),
  })) as PlayerState[];
}

function toPublicPlayers(room: RoomRecord): PublicPlayerState[] {
  if (isRoomEditable(room)) {
    return sortMembers(room.members).map((member) => ({
      id: member.id,
      name: member.name,
      seat: member.seat,
      isHost: member.isHost,
      isConnected: member.isConnected,
      ready: member.ready,
      handCount: 0,
      shield: 0,
      lastActionWasYield: false,
      signal: null,
      handLimit: handLimitForPlayerCount(room.members.length),
    }));
  }
  const game = room.game as GameState;
  return game.players
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((player) => ({
      id: player.id,
      name: player.name,
      seat: player.seat,
      isHost: player.isHost,
      isConnected: player.isConnected,
      ready: player.ready,
      handCount: player.hand.length,
      shield: player.shield,
      lastActionWasYield: player.lastActionWasYield,
      signal: player.signal,
      handLimit: player.handLimit,
    }));
}

function findMember(room: RoomRecord, clientId: string) {
  const member = room.members.find((entry) => entry.clientId === clientId);
  if (!member) throw new Error("You are not in this room.");
  return member;
}

function roomSnapshot(room: RoomRecord, clientId: string | null): RoomSnapshot {
  const viewerMember = clientId ? room.members.find((member) => member.clientId === clientId) ?? null : null;
  const game = room.game ? toPublicGameState(room.game) : null;
  return {
    roomCode: room.roomCode,
    maxPlayers: room.maxPlayers,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    game,
    players: toPublicPlayers(room),
    self:
      viewerMember && room.game
        ? {
            playerId: viewerMember.id,
            hand: room.game.players.find((player) => player.id === viewerMember.id)?.hand ?? [],
          }
        : null,
    viewerPlayerId: viewerMember?.id ?? null,
    maxHandSize: room.game?.players[0]?.handLimit ?? handLimitForPlayerCount(room.members.length || 2),
    phase: room.game?.phase ?? room.phase,
    nextAction: room.game?.lastEvent ?? "Create or join a room.",
    toast: null,
  };
}

function createRoomRecord(nickname: string, clientId: string, maxPlayers: number) {
  const roomCode = makeRoomCode();
  const hostId = uid("player");
  const room: RoomRecord = {
    roomCode,
    createdAt: now(),
    updatedAt: now(),
    maxPlayers,
    hostMemberId: hostId,
    phase: "lobby",
    members: [
      {
        id: hostId,
        clientId,
        name: nickname,
        seat: 0,
        isHost: true,
        isConnected: true,
        ready: false,
      },
    ],
    game: null,
  };
  memory.__regicideRooms!.set(roomCode, room);
  return room;
}

function cloneRoom(room: RoomRecord): RoomRecord {
  return JSON.parse(JSON.stringify(room)) as RoomRecord;
}

function getRoomRecord(roomCode: string) {
  const room = memory.__regicideRooms!.get(roomCode);
  if (!room) throw new Error("Room not found.");
  return room;
}

async function loadRoomRecordFromSupabase(roomCode: string) {
  const supabase = getAdminSupabaseClient();
  if (!supabase) return null;

  const { data: roomRow, error: roomError } = await supabase.from("rooms").select("*").eq("room_code", roomCode).maybeSingle();
  if (roomError || !roomRow) return null;

  const { data: members, error: membersError } = await supabase.from("room_members").select("*").eq("room_code", roomCode).order("seat", { ascending: true });
  if (membersError) throw new Error(membersError.message);

  const { data: gameRow } = await supabase.from("games").select("*").eq("room_code", roomCode).maybeSingle();
  const room: RoomRecord = {
    roomCode,
    createdAt: roomRow.created_at,
    updatedAt: roomRow.updated_at,
    maxPlayers: roomRow.max_players,
    hostMemberId: roomRow.host_member_id,
    phase: roomRow.phase,
    members: (members ?? []).map((member) => ({
      id: member.player_id,
      clientId: member.client_id,
      name: member.display_name,
      seat: member.seat,
      isHost: member.is_host,
      isConnected: member.is_connected,
      ready: member.ready,
    })),
    game: gameRow?.state as GameState | null,
  };
  return room;
}

async function loadRoomFromSupabase(roomCode: string, clientId: string | null) {
  const room = await loadRoomRecordFromSupabase(roomCode);
  if (!room) return null;
  memory.__regicideRooms!.set(roomCode, room);
  return roomSnapshot(room, clientId);
}

async function getMutableRoomRecord(roomCode: string) {
  const local = memory.__regicideRooms!.get(roomCode);
  if (local) return cloneRoom(local);

  const remote = await loadRoomRecordFromSupabase(roomCode);
  if (!remote) throw new Error("Room not found.");
  memory.__regicideRooms!.set(roomCode, remote);
  return cloneRoom(remote);
}

async function persistRoomToSupabase(room: RoomRecord) {
  const supabase = getAdminSupabaseClient();
  if (!supabase) return;

  await supabase.from("rooms").upsert({
    room_code: room.roomCode,
    host_member_id: room.hostMemberId,
    max_players: room.maxPlayers,
    phase: room.phase,
    updated_at: now(),
  });

  await supabase.from("room_members").delete().eq("room_code", room.roomCode);
  if (room.members.length > 0) {
    await supabase.from("room_members").insert(
      room.members.map((member) => ({
        room_code: room.roomCode,
        player_id: member.id,
        client_id: member.clientId,
        display_name: member.name,
        seat: member.seat,
        is_host: member.isHost,
        is_connected: member.isConnected,
        ready: member.ready,
      })),
    );
  }

  if (room.game) {
    await supabase.from("games").upsert({
      room_code: room.roomCode,
      state: room.game,
      version: room.game.turnNumber,
      updated_at: now(),
    });
    await supabase.from("game_actions").insert(
      room.game.actionLog.slice(0, 1).map((entry) => ({
        game_id: room.game?.id,
        player_id: entry.actorPlayerId,
        action_type: entry.type,
        payload: entry,
      })),
    );
  }
}

export async function getSnapshot(roomCode: string, clientId: string | null): Promise<RoomSnapshot> {
  const remote = await loadRoomFromSupabase(roomCode, clientId);
  if (remote) return remote;
  const room = getRoomRecord(roomCode);
  return roomSnapshot(room, clientId);
}

export async function createRoom(nickname: string, clientId: string, maxPlayers = 4): Promise<RoomSnapshot> {
  const room = createRoomRecord(nickname, clientId, maxPlayers);
  await persistRoomToSupabase(room);
  return roomSnapshot(room, clientId);
}

export async function joinRoom(roomCode: string, nickname: string, clientId: string): Promise<RoomSnapshot> {
  const room = await getMutableRoomRecord(roomCode);
  if (!isRoomEditable(room)) {
    throw new Error("The game has already started.");
  }
  if (room.members.length >= room.maxPlayers) {
    throw new Error("This room is full.");
  }
  const existing = room.members.find((member) => member.clientId === clientId);
  if (existing) {
    existing.name = nickname;
    existing.isConnected = true;
  } else {
    room.members.push({
      id: uid("player"),
      clientId,
      name: nickname,
      seat: room.members.length,
      isHost: false,
      isConnected: true,
      ready: false,
    });
  }
  room.updatedAt = now();
  memory.__regicideRooms!.set(roomCode, room);
  await persistRoomToSupabase(room);
  return roomSnapshot(room, clientId);
}

export async function claimSeat(roomCode: string, clientId: string, seat: number): Promise<RoomSnapshot> {
  const room = await getMutableRoomRecord(roomCode);
  assertRoomEditable(room, "Seats cannot be changed while a game is active.");
  if (seat < 0 || seat >= room.maxPlayers) throw new Error("Invalid seat.");
  const target = room.members.find((member) => member.seat === seat);
  if (target && target.clientId !== clientId) throw new Error("That seat is taken.");
  const member = findMember(room, clientId);
  member.seat = seat;
  room.updatedAt = now();
  memory.__regicideRooms!.set(roomCode, room);
  await persistRoomToSupabase(room);
  return roomSnapshot(room, clientId);
}

export async function setReady(roomCode: string, clientId: string, ready: boolean): Promise<RoomSnapshot> {
  const room = await getMutableRoomRecord(roomCode);
  assertRoomEditable(room, "Ready state cannot be changed while a game is active.");
  const member = findMember(room, clientId);
  member.ready = ready;
  room.updatedAt = now();
  memory.__regicideRooms!.set(roomCode, room);
  await persistRoomToSupabase(room);
  return roomSnapshot(room, clientId);
}

export async function startGame(roomCode: string, clientId: string): Promise<RoomSnapshot> {
  const room = await getMutableRoomRecord(roomCode);
  assertRoomEditable(room, "The game has already started.");
  const member = findMember(room, clientId);
  if (!member.isHost) throw new Error("Only the host can start the game.");
  if (room.members.length < 2 || room.members.length > room.maxPlayers) {
    throw new Error("Room player count is invalid.");
  }
  if (!room.members.every((entry) => entry.ready || entry.id === member.id)) {
    throw new Error("Everyone else needs to ready up first.");
  }
  room.game = createInitialGameState(roomCode, normalizePlayers(room.members));
  room.phase = room.game.phase;
  room.updatedAt = now();
  memory.__regicideRooms!.set(roomCode, room);
  await persistRoomToSupabase(room);
  return roomSnapshot(room, clientId);
}

export async function setMaxPlayers(roomCode: string, clientId: string, maxPlayers: number): Promise<RoomSnapshot> {
  const room = await getMutableRoomRecord(roomCode);
  const member = findMember(room, clientId);
  if (!member.isHost) throw new Error("Only the host can change the room size.");
  assertRoomEditable(room);
  if (maxPlayers < 2 || maxPlayers > 4) throw new Error("Room size must be between 2 and 4 players.");
  if (room.members.length > maxPlayers) {
    throw new Error("The room has too many players for that size.");
  }
  if (room.members.some((entry) => entry.seat >= maxPlayers)) {
    throw new Error("Move players out of higher seats before reducing the room size.");
  }
  room.maxPlayers = maxPlayers;
  room.updatedAt = now();
  memory.__regicideRooms!.set(roomCode, room);
  await persistRoomToSupabase(room);
  return roomSnapshot(room, clientId);
}

export async function submitMove(roomCode: string, clientId: string, move: GameMove): Promise<RoomSnapshot> {
  const room = await getMutableRoomRecord(roomCode);
  if (!room.game) throw new Error("The game has not started yet.");
  const member = findMember(room, clientId);
  if (move.playerId !== member.id) throw new Error("You can only play your own turn.");
  room.game = applyMove(room.game, move);
  room.phase = room.game.phase;
  room.updatedAt = now();
  memory.__regicideRooms!.set(roomCode, room);
  await persistRoomToSupabase(room);
  return roomSnapshot(room, clientId);
}

export async function sendSignal(roomCode: string, clientId: string, signal: SignalType): Promise<RoomSnapshot> {
  const room = await getMutableRoomRecord(roomCode);
  return submitMove(roomCode, clientId, { type: "sendSignal", playerId: findMember(room, clientId).id, signal });
}

export async function chooseNextPlayer(roomCode: string, clientId: string, nextPlayerId: string): Promise<RoomSnapshot> {
  const room = await getMutableRoomRecord(roomCode);
  const member = findMember(room, clientId);
  if (!room.game) throw new Error("The game has not started yet.");
  return submitMove(roomCode, clientId, {
    type: "chooseNextPlayer",
    playerId: member.id,
    nextPlayerId,
  });
}

export async function discardForDamage(roomCode: string, clientId: string, cardIds: string[]): Promise<RoomSnapshot> {
  const room = await getMutableRoomRecord(roomCode);
  const member = findMember(room, clientId);
  if (!room.game) throw new Error("The game has not started yet.");
  return submitMove(roomCode, clientId, {
    type: "discardForDamage",
    playerId: member.id,
    cardIds,
  });
}

export async function restartGame(roomCode: string, clientId: string): Promise<RoomSnapshot> {
  const room = await getMutableRoomRecord(roomCode);
  const member = findMember(room, clientId);
  if (!member.isHost) throw new Error("Only the host can restart the game.");
  if (!room.members.every((entry) => entry.ready || entry.id === member.id)) {
    throw new Error("All players must be ready for a restart.");
  }
  room.game = createInitialGameState(roomCode, normalizePlayers(room.members));
  room.phase = room.game.phase;
  room.updatedAt = now();
  memory.__regicideRooms!.set(roomCode, room);
  await persistRoomToSupabase(room);
  return roomSnapshot(room, clientId);
}
