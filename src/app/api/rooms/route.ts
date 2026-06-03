import { NextResponse } from "next/server";
import { z } from "zod";
import { assertRateLimit } from "@/lib/server/rate-limit";
import { createRoom } from "@/lib/server/store";

const schema = z.object({
  nickname: z.string().trim().min(1).max(24),
  clientId: z.string().min(1).max(128),
  maxPlayers: z.number().int().min(2).max(4).optional(),
});

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong while creating the room.";
}

export async function POST(request: Request) {
  try {
    await assertRateLimit(request, "create-room", 8, 60_000);
    const body = schema.parse(await request.json());
    const snapshot = await createRoom(body.nickname, body.clientId, body.maxPlayers ?? 4);
    return NextResponse.json({ snapshot });
  } catch (error) {
    return NextResponse.json({ error: safeMessage(error) }, { status: 400 });
  }
}
