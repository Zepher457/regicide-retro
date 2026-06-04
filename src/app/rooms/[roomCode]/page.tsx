import GameClient from "@/components/game-client";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomCode: string }>;
}) {
  const { roomCode } = await params;
  return <GameClient initialRoomCode={roomCode.toUpperCase()} view="room" />;
}
