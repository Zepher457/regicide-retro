import { NextResponse } from "next/server";
import { z } from "zod";
import { assertRateLimit } from "@/lib/server/rate-limit";
import {
  claimSeat,
  chooseNextPlayer,
  discardForDamage,
  getSnapshot,
  joinRoom,
  restartGame,
  sendSignal,
  setReady,
  startGame,
  submitMove,
} from "@/lib/server/store";
import type { GameMove } from "@/lib/game/types";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("join"),
    nickname: z.string().trim().min(1).max(24),
    clientId: z.string().min(1).max(128),
  }),
  z.object({
    action: z.literal("claim-seat"),
    clientId: z.string().min(1).max(128),
    seat: z.number().int().min(0).max(3),
  }),
  z.object({
    action: z.literal("ready"),
    clientId: z.string().min(1).max(128),
    ready: z.boolean(),
  }),
  z.object({
    action: z.literal("start"),
    clientId: z.string().min(1).max(128),
  }),
  z.object({
    action: z.literal("move"),
    clientId: z.string().min(1).max(128),
    move: z.any(),
  }),
  z.object({
    action: z.literal("signal"),
    clientId: z.string().min(1).max(128),
    signal: z.enum(["need_help", "need_draw", "can_go_next", "rather_not_next", "hand_count", "tavern_low", "danger", "jester_ready"]),
  }),
  z.object({
    action: z.literal("choose-next"),
    clientId: z.string().min(1).max(128),
    nextPlayerId: z.string().min(1).max(128),
  }),
  z.object({
    action: z.literal("discard-for-damage"),
    clientId: z.string().min(1).max(128),
    cardIds: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    action: z.literal("restart"),
    clientId: z.string().min(1).max(128),
  }),
]);

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message : "That action could not be completed.";
}

export async function GET(request: Request, { params }: { params: Promise<{ roomCode: string }> }) {
  try {
    await assertRateLimit(request, "get-room", 60, 60_000);
    const { roomCode } = await params;
    const clientId = new URL(request.url).searchParams.get("clientId");
    const snapshot = await getSnapshot(roomCode, clientId);
    return NextResponse.json({ snapshot });
  } catch (error) {
    return NextResponse.json({ error: safeMessage(error) }, { status: 400 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ roomCode: string }> }) {
  try {
    await assertRateLimit(request, "room-action", 18, 60_000);
    const { roomCode } = await params;
    const body = bodySchema.parse(await request.json());

    let snapshot;
    switch (body.action) {
      case "join":
        snapshot = await joinRoom(roomCode, body.nickname, body.clientId);
        break;
      case "claim-seat":
        snapshot = await claimSeat(roomCode, body.clientId, body.seat);
        break;
      case "ready":
        snapshot = await setReady(roomCode, body.clientId, body.ready);
        break;
      case "start":
        snapshot = await startGame(roomCode, body.clientId);
        break;
      case "move":
        snapshot = await submitMove(roomCode, body.clientId, body.move as GameMove);
        break;
      case "signal":
        snapshot = await sendSignal(roomCode, body.clientId, body.signal);
        break;
      case "choose-next":
        snapshot = await chooseNextPlayer(roomCode, body.clientId, body.nextPlayerId);
        break;
      case "discard-for-damage":
        snapshot = await discardForDamage(roomCode, body.clientId, body.cardIds);
        break;
      case "restart":
        snapshot = await restartGame(roomCode, body.clientId);
        break;
      default:
        throw new Error("Unsupported action.");
    }

    return NextResponse.json({ snapshot });
  } catch (error) {
    return NextResponse.json({ error: safeMessage(error) }, { status: 400 });
  }
}
