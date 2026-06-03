import { fetchJson } from "@/lib/client";
import type { GameMove, RoomSnapshot, SignalType } from "@/lib/game/types";

export async function apiCreateRoom(payload: { nickname: string; clientId: string; maxPlayers?: number }) {
  return fetchJson<{ snapshot: RoomSnapshot }>("/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function apiRoomAction(
  roomCode: string,
  action:
    | { action: "join"; nickname: string; clientId: string }
    | { action: "claim-seat"; clientId: string; seat: number }
    | { action: "ready"; clientId: string; ready: boolean }
    | { action: "start"; clientId: string }
    | { action: "move"; clientId: string; move: GameMove }
    | { action: "signal"; clientId: string; signal: SignalType }
    | { action: "choose-next"; clientId: string; nextPlayerId: string }
    | { action: "discard-for-damage"; clientId: string; cardIds: string[] }
    | { action: "restart"; clientId: string },
) {
  return fetchJson<{ snapshot: RoomSnapshot }>(`/api/rooms/${roomCode}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action),
  });
}

export async function apiFetchRoom(roomCode: string, clientId?: string) {
  const suffix = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";
  return fetchJson<{ snapshot: RoomSnapshot }>(`/api/rooms/${roomCode}${suffix}`);
}
