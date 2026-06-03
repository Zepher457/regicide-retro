"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Crown, DoorOpen, RotateCw, Shield, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";
import { apiCreateRoom, apiFetchRoom, apiRoomAction } from "@/lib/api";
import { getBrowserRealtimeClient, getClientId } from "@/lib/client";
import { buildPublicSignals, handLimitForPlayerCount } from "@/lib/game/engine";
import type { Card, GameMove, RoomSnapshot, SignalType } from "@/lib/game/types";
import { CrownIcon, JesterIcon, SuitIcon } from "@/components/icons";

type LocalIdentity = {
  clientId: string;
  displayName: string;
};

const savedNameKey = "regicide-retro.nickname";

function suitClass(card: Card) {
  if (card.suit === "joker") return "text-[color:var(--accent)]";
  return card.suit === "hearts"
    ? "suit-heart"
    : card.suit === "diamonds"
      ? "suit-diamond"
      : card.suit === "clubs"
        ? "suit-club"
        : "suit-spade";
}

function formatRank(card: Card) {
  return card.rank === "JOKER" ? "J" : String(card.rank);
}

function cardBackdrop(card: Card) {
  if (card.suit === "joker") return "bg-[#20170f]";
  return card.suit === "hearts" || card.suit === "diamonds" ? "bg-[#241510]" : "bg-[#171916]";
}

function moveFromSelection(selectedCards: Card[]): GameMove | null {
  if (selectedCards.length === 0) return null;
  if (selectedCards.length === 1) {
    const [card] = selectedCards;
    if (card.rank === "JOKER") return { type: "playJester", playerId: "", cardId: card.id };
    return { type: "playSingle", playerId: "", cardId: card.id };
  }
  if (selectedCards.length === 2 && selectedCards.some((card) => card.rank === "A")) {
    const ace = selectedCards.find((card) => card.rank === "A") as Card;
    const other = selectedCards.find((card) => card.id !== ace.id) as Card;
    return { type: "playAcePair", playerId: "", aceId: ace.id, otherCardId: other.id };
  }
  if (selectedCards.every((card) => card.rank === selectedCards[0].rank) && selectedCards[0].rank !== "A") {
    return { type: "playCombo", playerId: "", cardIds: selectedCards.map((card) => card.id) };
  }
  return null;
}

export default function GameClient() {
  const [identity, setIdentity] = useState<LocalIdentity | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [nickname, setNickname] = useState("");
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [busy, setBusy] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [discardSelection, setDiscardSelection] = useState<string[]>([]);

  const client = getBrowserRealtimeClient();
  const viewerPlayer = snapshot?.players.find((player) => player.id === snapshot.viewerPlayerId) ?? null;
  const currentEnemy = snapshot?.game?.currentEnemy ?? null;
  const myHand = snapshot?.self?.hand ?? [];
  const activePlayer = snapshot?.game?.players.find((player) => player.seat === snapshot.game?.activeSeat) ?? null;
  const isMyTurn = Boolean(snapshot?.game && snapshot.viewerPlayerId && activePlayer?.id === snapshot.viewerPlayerId);
  const canChooseNext = Boolean(snapshot?.game?.turn.nextPlayerChoiceOpen && snapshot.viewerPlayerId === snapshot.game.turn.jesterChooserPlayerId);
  const waitingDamage = Boolean(snapshot?.game?.phase === "awaiting-damage" && snapshot.viewerPlayerId === snapshot.game.turn.pendingDamageForPlayerId);
  const pendingDamage = snapshot?.game?.turn.pendingDamageAmount ?? 0;
  const discardTotal = discardSelection.reduce((sum, id) => {
    const card = myHand.find((entry) => entry.id === id);
    return sum + (card?.value ?? 0);
  }, 0);
  const selectedPlayCards = selectedCards.map((id) => myHand.find((card) => card.id === id)).filter(Boolean) as Card[];
  const selectedMove = moveFromSelection(selectedPlayCards);
  const canStart = Boolean(snapshot && snapshot.players.length >= 2);

  useEffect(() => {
    const saved = window.localStorage.getItem(savedNameKey);
    if (saved) setNickname(saved);
    const clientId = getClientId();
    const displayName = saved || "Guest";
    setIdentity({ clientId, displayName });
    setAuthReady(!client);
    const roomCode = window.localStorage.getItem("regicide-retro.room-code");
    if (roomCode) setRoomCodeInput(roomCode);

    if (!client) return;
    let cancelled = false;

    (async () => {
      try {
        const { data } = await client.auth.getSession();
        if (!data.session) {
          const signIn = await client.auth.signInAnonymously();
          const nextClientId = signIn.data.user?.id ?? clientId;
          if (!cancelled) setIdentity({ clientId: nextClientId, displayName });
        } else {
          const nextClientId = data.session.user.id;
          if (!cancelled) setIdentity({ clientId: nextClientId, displayName });
        }
      } catch {
        if (!cancelled) setIdentity({ clientId, displayName });
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    if (!snapshot?.roomCode) return;
    const interval = window.setInterval(() => {
      void refreshRoom();
    }, 3500);

    if (!client) return () => window.clearInterval(interval);

    const channel = client
      .channel(`regicide-room-${snapshot.roomCode}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `room_code=eq.${snapshot.roomCode}` }, () => {
        void refreshRoom();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "games", filter: `room_code=eq.${snapshot.roomCode}` }, () => {
        void refreshRoom();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "room_members", filter: `room_code=eq.${snapshot.roomCode}` }, () => {
        void refreshRoom();
      })
      .subscribe();

    return () => {
      window.clearInterval(interval);
      void client.removeChannel(channel);
    };
  }, [client, snapshot?.roomCode]);

  useEffect(() => {
    if (snapshot) {
      window.localStorage.setItem("regicide-retro.room-code", snapshot.roomCode);
    }
  }, [snapshot]);

  useEffect(() => {
    setSelectedCards([]);
    setDiscardSelection([]);
  }, [snapshot?.roomCode, snapshot?.game?.turnNumber, snapshot?.game?.phase]);

  async function refreshRoom() {
    if (!snapshot?.roomCode || !identity) return;
    try {
      const response = await apiFetchRoom(snapshot.roomCode, identity.clientId);
      setSnapshot(response.snapshot);
    } catch {
      // Keep the last good state and let the toast surface when the user acts.
    }
  }

  async function submitAction(action: Parameters<typeof apiRoomAction>[1]) {
    if (!snapshot?.roomCode || !identity) return;
    setBusy(true);
    try {
      const response = await apiRoomAction(snapshot.roomCode, action);
      setSnapshot(response.snapshot);
      if (action.action === "restart") {
        toast.success("Room restarted.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That action was rejected.");
    } finally {
      setBusy(false);
    }
  }

  async function createRoom() {
    if (!identity || !nickname.trim()) {
      toast.error("Enter a nickname first.");
      return;
    }
    setBusy(true);
    try {
      const response = await apiCreateRoom({
        nickname: nickname.trim(),
        clientId: identity.clientId,
        maxPlayers,
      });
      setSnapshot(response.snapshot);
      window.localStorage.setItem(savedNameKey, nickname.trim());
      toast.success(`Room ${response.snapshot.roomCode} created.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create room.");
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom() {
    if (!identity || !nickname.trim() || !roomCodeInput.trim()) {
      toast.error("Enter a room code and nickname.");
      return;
    }
    setBusy(true);
    try {
      const response = await apiRoomAction(roomCodeInput.trim().toUpperCase(), {
        action: "join",
        nickname: nickname.trim(),
        clientId: identity.clientId,
      });
      setSnapshot(response.snapshot);
      window.localStorage.setItem(savedNameKey, nickname.trim());
      toast.success("Joined the room.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not join room.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleSeat(seat: number) {
    if (!snapshot || !identity) return;
    await submitAction({ action: "claim-seat", clientId: identity.clientId, seat });
  }

  async function toggleReady() {
    if (!identity) return;
    const current = snapshot?.players.find((player) => player.id === snapshot.viewerPlayerId);
    await submitAction({ action: "ready", clientId: identity.clientId, ready: !current?.ready });
  }

  async function startGame() {
    if (!identity) return;
    await submitAction({ action: "start", clientId: identity.clientId });
  }

  async function sendSignal(signal: SignalType) {
    if (!identity) return;
    await submitAction({ action: "signal", clientId: identity.clientId, signal });
  }

  async function chooseNext(nextPlayerId: string) {
    if (!identity) return;
    await submitAction({ action: "choose-next", clientId: identity.clientId, nextPlayerId });
  }

  async function playCards() {
    if (!identity || !selectedMove) {
      toast.error("Select a legal card combination first.");
      return;
    }
    const payload: GameMove = {
      ...selectedMove,
      playerId: snapshot?.viewerPlayerId ?? "",
    } as GameMove;
    setSelectedCards([]);
    await submitAction({ action: "move", clientId: identity.clientId, move: payload });
  }

  async function yieldTurn() {
    if (!identity) return;
    await submitAction({ action: "move", clientId: identity.clientId, move: { type: "yield", playerId: snapshot?.viewerPlayerId ?? "" } });
  }

  async function submitDamage() {
    if (!identity) return;
    if (discardTotal < pendingDamage) {
      toast.error("Discard cards worth at least the pending damage.");
      return;
    }
    await submitAction({
      action: "discard-for-damage",
      clientId: identity.clientId,
      cardIds: discardSelection,
    });
    setDiscardSelection([]);
  }

  async function restart() {
    if (!identity) return;
    await submitAction({ action: "restart", clientId: identity.clientId });
  }

  function toggleCard(cardId: string, mode: "play" | "discard") {
    if (mode === "play") {
      setSelectedCards((current) => (current.includes(cardId) ? current.filter((id) => id !== cardId) : [...current, cardId]));
      return;
    }
    setDiscardSelection((current) => (current.includes(cardId) ? current.filter((id) => id !== cardId) : [...current, cardId]));
  }

  const sortedPlayers = snapshot?.players.slice().sort((a, b) => a.seat - b.seat) ?? [];
  const roomReady = snapshot ? snapshot.players.every((player) => player.ready || player.id === snapshot.viewerPlayerId) : false;
  const handCap = snapshot?.maxHandSize ?? handLimitForPlayerCount(snapshot?.players.length ?? 2);

  return (
    <main className="min-h-screen px-4 py-5 text-[15px] md:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] max-w-7xl flex-col gap-4">
        <header className="panel flex flex-col gap-4 rounded-[1rem] p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-1">
            <div className="pixel-font text-[0.7rem] tracking-[0.2em] text-[color:var(--accent)]">REGICIDE RETRO</div>
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Dark cooperative card combat with real room sync.</h1>
            <p className="subtle max-w-3xl">
              Guest nicknames, room codes, realtime table state, and the classic suit powers wrapped in a darker 90s arcade shell.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="chip">
              <Users className="h-4 w-4" />
              <span>{snapshot ? `${snapshot.players.length}/${snapshot.maxPlayers}` : "2-4 players"}</span>
            </div>
            <div className="chip">
              <Shield className="h-4 w-4" />
              <span>{snapshot?.game?.phase ?? "Lobby"}</span>
            </div>
            <div className="chip">
              <Sparkles className="h-4 w-4" />
              <span>{snapshot?.game?.lastEvent ?? "Create or join a room."}</span>
            </div>
          </div>
        </header>

        {!snapshot ? (
          <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="panel rounded-[1rem] p-5">
              <h2 className="text-xl font-semibold">Create a room</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-[1.4fr_0.7fr]">
                <input className="input" placeholder="Nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} />
                <select className="input" value={maxPlayers} onChange={(event) => setMaxPlayers(Number(event.target.value))}>
                  <option value={2}>2 players</option>
                  <option value={3}>3 players</option>
                  <option value={4}>4 players</option>
                </select>
              </div>
              <button className="btn btn-primary mt-4" onClick={() => void createRoom()} disabled={busy || !authReady}>
                <DoorOpen className="h-4 w-4" />
                Create room
              </button>
            </div>
            <div className="panel rounded-[1rem] p-5">
              <h2 className="text-xl font-semibold">Join a room</h2>
              <div className="mt-4 grid gap-3">
                <input className="input uppercase tracking-[0.3em]" placeholder="Room code" value={roomCodeInput} onChange={(event) => setRoomCodeInput(event.target.value.toUpperCase())} />
                <input className="input" placeholder="Nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} />
              </div>
              <button className="btn mt-4" onClick={() => void joinRoom()} disabled={busy || !authReady}>
                <ArrowRight className="h-4 w-4" />
                Join room
              </button>
            </div>
          </section>
        ) : (
          <section className="grid flex-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="flex min-h-0 flex-col gap-4">
              <div className="panel rounded-[1rem] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="pixel-font text-[0.65rem] tracking-[0.28em] text-[color:var(--accent)]">ROOM {snapshot.roomCode}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-semibold">Lobby and table</h2>
                      <span className="chip">
                        {viewerPlayer?.name ?? identity?.displayName ?? "Guest"}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button className="btn" onClick={() => void toggleReady()} disabled={busy || snapshot.phase !== "lobby"}>
                      <RotateCw className="h-4 w-4" />
                      {viewerPlayer?.ready ? "Unready" : "Ready"}
                    </button>
                    <button className="btn btn-primary" onClick={() => void startGame()} disabled={busy || !canStart || snapshot.phase !== "lobby" || !roomReady}>
                      <Crown className="h-4 w-4" />
                      Start game
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                <div className="panel rounded-[1rem] p-4">
                  <h3 className="text-lg font-semibold">Seats</h3>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    {Array.from({ length: snapshot.maxPlayers }, (_, seat) => {
                      const player = sortedPlayers.find((entry) => entry.seat === seat);
                      return (
                        <button key={seat} className={`panel-soft rounded-[0.9rem] p-3 text-left ${player?.id === snapshot.viewerPlayerId ? "ring-2 ring-[color:var(--accent)]" : ""}`} onClick={() => void toggleSeat(seat)} disabled={busy || snapshot.phase !== "lobby"}>
                          <div className="flex items-center justify-between">
                            <span className="pixel-font text-[0.6rem] text-[color:var(--accent)]">SEAT {seat + 1}</span>
                            {player?.isHost ? <CrownIcon className="h-4 w-4 text-[color:var(--accent)]" /> : null}
                          </div>
                          <div className="mt-2 font-medium">{player?.name ?? "Open seat"}</div>
                          <div className="subtle mt-1 text-sm">{player ? `${player.handCount} cards` : "Tap to claim"}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="panel rounded-[1rem] p-4">
                  <h3 className="text-lg font-semibold">Public signals</h3>
                  {snapshot.phase !== "lobby" ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {buildPublicSignals().map((signal) => (
                        <button key={signal.type} className="btn btn-ghost" disabled={busy} onClick={() => void sendSignal(signal.type)}>
                          {signal.type === "jester_ready" ? <JesterIcon className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                          {signal.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {canChooseNext ? (
                    <div className="mt-4 rounded-[0.8rem] border border-[color:var(--panel-border)] bg-[#171311] p-3">
                      <div className="subtle text-sm">Jester is active. The room can now signal who should go next.</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button className="btn" onClick={() => void sendSignal("can_go_next")} disabled={busy}>
                          I can go next
                        </button>
                        <button className="btn" onClick={() => void sendSignal("rather_not_next")} disabled={busy}>
                          I’d rather not
                        </button>
                      </div>
                      <div className="mt-3 grid gap-2">
                        {sortedPlayers.map((player) => (
                          <button key={player.id} className="btn btn-ghost justify-between" disabled={busy} onClick={() => void chooseNext(player.id)}>
                            <span>{player.name}</span>
                            <span className="subtle">seat {player.seat + 1}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="panel rounded-[1rem] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold">{snapshot.phase === "lobby" ? "Ready room" : "Table"}</h3>
                  <div className="flex items-center gap-2">
                    <button className="btn btn-ghost" onClick={() => void refreshRoom()} disabled={busy}>
                      Refresh
                    </button>
                    <button className="btn btn-ghost" onClick={() => void restart()} disabled={busy || snapshot.phase === "lobby" || !viewerPlayer?.isHost}>
                      Restart
                    </button>
                  </div>
                </div>

                {snapshot.phase === "lobby" ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="panel-soft rounded-[0.9rem] p-3">
                      <div className="subtle text-sm">Rules locked</div>
                      <div className="mt-1">2-4 players, jokers for 3/4 only, suit powers and damage flow are enforced by the engine.</div>
                    </div>
                    <div className="panel-soft rounded-[0.9rem] p-3">
                      <div className="subtle text-sm">Hand limits</div>
                      <div className="mt-1">2 players: 7 cards, 3 players: 6 cards, 4 players: 5 cards.</div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                    <div className="panel-soft rounded-[0.9rem] p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="subtle text-sm">Enemy</div>
                          <div className="mt-1 flex items-center gap-2 text-xl font-semibold">
                            <CrownIcon className="h-5 w-5 text-[color:var(--accent)]" />
                            {currentEnemy?.label ?? "None"}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="pixel-font text-[0.6rem] text-[color:var(--accent)]">HP</div>
                          <div className="text-2xl font-semibold">{currentEnemy?.remainingHealth ?? 0}</div>
                        </div>
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                        <div className="panel rounded-[0.7rem] p-3">
                          <div className="subtle">Attack</div>
                          <div className="text-lg font-semibold">{currentEnemy?.attack ?? 0}</div>
                        </div>
                        <div className="panel rounded-[0.7rem] p-3">
                          <div className="subtle">Shield</div>
                          <div className="text-lg font-semibold">{currentEnemy?.shield ?? 0}</div>
                        </div>
                        <div className="panel rounded-[0.7rem] p-3">
                          <div className="subtle">Immunity</div>
                          <div className="text-lg font-semibold">{currentEnemy?.suitImmune ?? "none"}</div>
                        </div>
                      </div>
                      <div className="mt-4 text-sm subtle">
                        Current turn: {activePlayer?.name ?? "Unknown"} · Hand cap {handCap} · Tavern {snapshot.game?.tavernCount ?? 0} · Discard {snapshot.game?.discardCount ?? 0}
                      </div>
                    </div>

                    <div className="panel-soft rounded-[0.9rem] p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="subtle text-sm">Turn log</div>
                          <div className="mt-1 text-lg font-semibold">What just happened</div>
                        </div>
                        <div className="chip">
                          <ArrowRight className="h-4 w-4" />
                          <span>{snapshot.game?.phase}</span>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-2">
                        {snapshot.game?.actionLog.slice(0, 6).map((entry) => (
                          <div key={entry.id} className="panel rounded-[0.7rem] p-3 text-sm">
                            {entry.message}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <aside className="flex min-h-0 flex-col gap-4">
              <div className="panel rounded-[1rem] p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold">Your hand</h3>
                  <div className="chip">
                    <span>{myHand.length}/{handCap}</span>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {myHand.map((card) => {
                    const selected = selectedCards.includes(card.id) || discardSelection.includes(card.id);
                    const mode = waitingDamage ? "discard" : "play";
                    return (
                      <button
                        key={card.id}
                        className={`group relative flex min-h-[6.5rem] w-[4.8rem] flex-col justify-between rounded-[0.85rem] border p-2 text-left transition-transform ${cardBackdrop(card)} ${selected ? "border-[color:var(--accent)] translate-y-[-2px]" : "border-[color:var(--panel-border)]"}`}
                        onClick={() => toggleCard(card.id, mode)}
                      >
                        <div className="flex items-center justify-between text-[0.7rem] font-semibold">
                          <span className={suitClass(card)}>{formatRank(card)}</span>
                          {card.suit === "joker" ? <JesterIcon className="h-4 w-4 text-[color:var(--accent)]" /> : <SuitIcon suit={card.suit as "hearts" | "diamonds" | "clubs" | "spades"} className={`h-4 w-4 ${suitClass(card)}`} />}
                        </div>
                        <div className="flex flex-1 items-center justify-center">
                          <div className={`pixel-font text-lg ${suitClass(card)}`}>{card.value}</div>
                        </div>
                        <div className={`text-[0.55rem] leading-tight ${suitClass(card)}`}>{card.label}</div>
                      </button>
                    );
                  })}
                </div>

                {waitingDamage ? (
                  <div className="mt-4 rounded-[0.85rem] border border-[color:var(--panel-border)] bg-[#171310] p-3">
                    <div className="subtle text-sm">You must discard cards worth at least {pendingDamage} damage.</div>
                    <div className="mt-2 text-sm">
                      Selected: {discardTotal} damage
                    </div>
                    <button className="btn btn-primary mt-3" onClick={() => void submitDamage()} disabled={busy}>
                      Shield damage
                    </button>
                  </div>
                ) : null}

                {isMyTurn && snapshot.phase === "playing" ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button className="btn btn-primary" onClick={() => void playCards()} disabled={busy || !selectedMove}>
                      Play selected
                    </button>
                    <button className="btn" onClick={() => void yieldTurn()} disabled={busy}>
                      Yield
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="panel rounded-[1rem] p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Signals</h3>
                  <div className="chip">
                    <Users className="h-4 w-4" />
                    <span>Public only</span>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {snapshot.phase !== "lobby"
                    ? buildPublicSignals().map((signal) => (
                        <button key={signal.type} className="btn btn-ghost" onClick={() => void sendSignal(signal.type)} disabled={busy}>
                          {signal.label}
                        </button>
                      ))
                    : null}
                </div>
              </div>

              <div className="panel rounded-[1rem] p-4">
                <h3 className="text-lg font-semibold">Rules snapshot</h3>
                <div className="mt-3 grid gap-2 text-sm subtle">
                  <div>Clubs double damage.</div>
                  <div>Spades add shield against the current royal.</div>
                  <div>Hearts recycle discard into the bottom of the Tavern deck.</div>
                  <div>Diamonds draw in turn order up to the attack total.</div>
                  <div>Aces can pair with one other card and keep both suit effects.</div>
                  <div>Combos must share the same rank and stay at 10 or less total value.</div>
                </div>
              </div>
            </aside>
          </section>
        )}
      </div>
    </main>
  );
}
