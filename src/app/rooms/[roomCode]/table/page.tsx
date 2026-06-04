import GameClient from "@/components/game-client";

export default async function TablePage({
  params,
}: {
  params: Promise<{ roomCode: string }>;
}) {
  const { roomCode } = await params;
  return <GameClient initialRoomCode={roomCode.toUpperCase()} view="table" />;
}
