"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ClipboardList,
  Crown,
  DoorOpen,
  Maximize2,
  RotateCw,
  Shield,
  Sparkles,
  Swords,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { CrownIcon, JesterIcon, SuitIcon } from "@/components/icons";
import { apiCreateRoom, apiFetchRoom, apiRoomAction } from "@/lib/api";
import { getBrowserRealtimeClient, getClientId } from "@/lib/client";
import { buildPublicSignals, handLimitForPlayerCount } from "@/lib/game/engine";
import type {
  Card,
  GameMove,
  PublicGameState,
  PublicPlayerState,
  RoomSnapshot,
  SignalType,
} from "@/lib/game/types";

type GameClientProps = {
  initialRoomCode?: string;
  view: "landing" | "room" | "table";
};

type LocalIdentity = {
  clientId: string;
  displayName: string;
};

const savedNameKey = "regicide-retro.nickname";
const activeGamePhases = new Set(["playing", "awaiting-next-player", "awaiting-damage"]);

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

function royalCount(game: PublicGameState | null) {
  if (!game?.currentEnemy) return 0;
  return game.castle.length + 1;
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

function roomPath(roomCode: string) {
  return `/rooms/${roomCode}`;
}

function tablePath(roomCode: string) {
  return `/rooms/${roomCode}/table`;
}

function PublicCard({
  card,
  compact = false,
  accent = false,
}: {
  card: Card;
  compact?: boolean;
  accent?: boolean;
}) {
  return (
    <div
      className={`flex flex-col justify-between rounded-[0.95rem] border p-2 ${
        compact ? "min-h-[5.1rem] w-[3.7rem]" : "min-h-[7.9rem] w-[5.4rem]"
      } ${accent ? "border-[color:var(--accent)]" : "border-[color:var(--panel-border)]"} ${cardBackdrop(card)}`}
    >
      <div className="flex items-center justify-between text-[0.72rem] font-semibold">
        <span className={suitClass(card)}>{formatRank(card)}</span>
        {card.suit === "joker" ? (
          <JesterIcon className={`h-4 w-4 ${suitClass(card)}`} />
        ) : (
          <SuitIcon suit={card.suit} className={`h-4 w-4 ${suitClass(card)}`} />
        )}
      </div>
      <div className="flex flex-1 items-center justify-center">
        <div className={`pixel-font ${compact ? "text-sm" : "text-lg"} ${suitClass(card)}`}>{card.value}</div>
      </div>
      <div className={`text-[0.55rem] leading-tight ${suitClass(card)}`}>{card.label}</div>
    </div>
  );
}

function HiddenHandFan({ count }: { count: number }) {
  const visible = Math.max(count, 0);
  return (
    <div className="flex min-h-[4.2rem] max-w-full items-end overflow-x-auto pb-1 -space-x-4">
      {Array.from({ length: visible }, (_, index) => (
        <div
          key={index}
          className="h-[4.1rem] w-[2.9rem] rounded-[0.8rem] border border-[rgba(255,255,255,0.1)] bg-[linear-gradient(160deg,#4d3728,#221814)] shadow-[0_10px_16px_rgba(0,0,0,0.32)]"
        >
          <div className="m-1 h-[calc(100%-0.5rem)] rounded-[0.6rem] border border-[rgba(216,177,91,0.22)] bg-[radial-gradient(circle_at_top,rgba(216,177,91,0.18),transparent_55%),linear-gradient(180deg,rgba(255,255,255,0.06),rgba(0,0,0,0.14))]" />
        </div>
      ))}
    </div>
  );
}

function PlayerSeatCard({
  player,
  active,
  isViewer,
  pendingDamage,
}: {
  player: PublicPlayerState | null;
  active: boolean;
  isViewer?: boolean;
  pendingDamage?: number;
}) {
  if (!player) {
    return (
      <div className="panel-soft rounded-[1.15rem] p-3 text-center subtle">
        <div className="text-xs">Open seat</div>
      </div>
    );
  }

  return (
    <div className={`panel-soft rounded-[1rem] p-3 ${active ? "ring-2 ring-[color:var(--accent)]" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="pixel-font text-[0.5rem] tracking-[0.22em] text-[color:var(--accent)]">
            {isViewer ? "YOU" : `SEAT ${player.seat + 1}`}
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm font-semibold">
            <span>{player.name}</span>
            {player.isHost ? <CrownIcon className="h-4 w-4 text-[color:var(--accent)]" /> : null}
          </div>
        </div>
        <div className="chip text-xs">
          <span>{player.handCount}</span>
        </div>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <HiddenHandFan count={player.handCount} />
        <div className="text-right text-[0.7rem] subtle">
          <div>{active ? "Active" : "Waiting"}</div>
          <div>{player.signal ? player.signal.replaceAll("_", " ") : "Silent"}</div>
          {pendingDamage ? <div className="text-[color:var(--accent)]">Taking {pendingDamage} damage</div> : null}
        </div>
      </div>
    </div>
  );
}

function EnemyPanel({ game }: { game: PublicGameState | null }) {
  const enemy = game?.currentEnemy ?? null;
  if (!enemy) {
    return (
      <div className="panel-soft rounded-[1.2rem] p-4">
        <div className="subtle">No royal is active.</div>
      </div>
    );
  }

  return (
    <div className="panel-soft rounded-[1.2rem] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="pixel-font text-[0.55rem] tracking-[0.22em] text-[color:var(--accent)]">CURRENT ROYAL</div>
          <div className="mt-2 flex items-center gap-3">
            <PublicCard card={enemy} compact accent />
            <div>
              <div className="text-xl font-semibold">{enemy.label}</div>
              <div className="subtle mt-1 text-sm">Immune suit: {enemy.suitImmune ?? "none"}</div>
            </div>
          </div>
        </div>
        <div className="grid gap-2 text-right">
          <div className="chip">
            <Crown className="h-4 w-4" />
            <span>{royalCount(game)} left</span>
          </div>
          <div className="panel rounded-[0.8rem] px-3 py-2">
            <div className="pixel-font text-[0.55rem] text-[color:var(--accent)]">HP</div>
            <div className="text-xl font-semibold">{enemy.remainingHealth}</div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[0.8rem]">
            <div className="panel rounded-[0.8rem] p-2">
              <div className="subtle">Attack</div>
              <div className="font-semibold">{enemy.attack}</div>
            </div>
            <div className="panel rounded-[0.8rem] p-2">
              <div className="subtle">Shield</div>
              <div className="font-semibold">{enemy.shield}</div>
            </div>
          </div>
          <div className="chip justify-center text-xs">
            <span>Tavern {game?.tavernCount ?? 0}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function CardStackPanel({
  title,
  subtitle,
  cards,
  expanded = false,
  empty,
  onToggle,
  onOpen,
  live = false,
}: {
  title: string;
  subtitle: string;
  cards: Card[];
  expanded?: boolean;
  empty: string;
  onToggle?: () => void;
  onOpen?: () => void;
  live?: boolean;
}) {
  const visibleCards = expanded || live ? cards : cards.slice(-6);
  const hiddenCount = !expanded && !live ? Math.max(0, cards.length - visibleCards.length) : 0;
  const content = cards.length === 0 ? (
    <div className="mt-4 subtle text-sm">{empty}</div>
  ) : (
    <div className={`mt-4 flex items-end ${expanded && !live ? "flex-wrap gap-2 overflow-visible" : "flex-nowrap gap-0 overflow-x-auto pb-2"}`}>
      {visibleCards.map((card, index) => (
        <div
          key={card.id}
          className={`${index > 0 && !expanded ? "-ml-4" : ""} shrink-0`}
          style={{ zIndex: index + 1 }}
        >
          <PublicCard card={card} compact accent={index === visibleCards.length - 1} />
        </div>
      ))}
      {hiddenCount > 0 ? <div className="chip ml-2 shrink-0 text-xs">+{hiddenCount}</div> : null}
    </div>
  );

  return (
    <div className="panel-soft rounded-[1rem] p-4 text-left">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="subtle text-sm">{subtitle}</div>
          <div className="text-lg font-semibold">{title}</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="chip text-xs">
            <span>{cards.length}</span>
          </div>
          {onToggle ? (
            <button className="btn btn-ghost px-3 py-2" type="button" onClick={onToggle} aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}>
              <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
            </button>
          ) : null}
          {onOpen ? (
            <button className="btn btn-ghost px-3 py-2" type="button" onClick={onOpen} aria-label={`Open ${title}`}>
              <Maximize2 className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
      {content}
    </div>
  );
}

function CardPileModal({
  title,
  cards,
  empty,
  onClose,
}: {
  title: string;
  cards: Card[];
  empty: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="panel max-h-[86vh] w-full max-w-5xl overflow-hidden rounded-[1rem] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="subtle text-sm">{cards.length} cards</div>
            <div className="text-xl font-semibold">{title}</div>
          </div>
          <button className="btn btn-ghost px-3 py-2" type="button" onClick={onClose} aria-label="Close card pile">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 max-h-[68vh] overflow-y-auto">
          {cards.length === 0 ? (
            <div className="subtle text-sm">{empty}</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {cards.map((card) => (
                <PublicCard key={card.id} card={card} compact />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LoadingState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <section className="panel rounded-[1.2rem] p-6">
      <div className="text-xl font-semibold">{message}</div>
      {action ? <div className="mt-4">{action}</div> : null}
    </section>
  );
}

export default function GameClient({ initialRoomCode, view }: GameClientProps) {
  const router = useRouter();
  const [identity, setIdentity] = useState<LocalIdentity | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [nickname, setNickname] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(savedNameKey) ?? "";
  });
  const [roomCodeInput, setRoomCodeInput] = useState(() => {
    if (initialRoomCode) return initialRoomCode;
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("regicide-retro.room-code") ?? "";
  });
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [busy, setBusy] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [selectedCardState, setSelectedCardState] = useState<{ context: string; ids: string[] }>({ context: "", ids: [] });
  const [discardState, setDiscardState] = useState<{ context: string; ids: string[] }>({ context: "", ids: [] });
  const [discardExpanded, setDiscardExpanded] = useState(false);
  const [tableExpanded, setTableExpanded] = useState(false);
  const [actionLogExpanded, setActionLogExpanded] = useState(false);
  const [modalPile, setModalPile] = useState<"table" | "discard" | null>(null);
  const [roomLoadError, setRoomLoadError] = useState<string | null>(null);

  const client = getBrowserRealtimeClient();
  const viewerPlayer = snapshot?.players.find((player) => player.id === snapshot.viewerPlayerId) ?? null;
  const myHand = snapshot?.self?.hand ?? [];
  const selectionContext = `${snapshot?.roomCode ?? initialRoomCode ?? "none"}:${snapshot?.game?.turnNumber ?? 0}:${snapshot?.game?.phase ?? snapshot?.phase ?? "idle"}`;
  const selectedCards = selectedCardState.context === selectionContext ? selectedCardState.ids : [];
  const discardSelection = discardState.context === selectionContext ? discardState.ids : [];
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
  const sortedPlayers = snapshot?.players.slice().sort((a, b) => a.seat - b.seat) ?? [];
  const roomReady = snapshot ? snapshot.players.every((player) => player.ready) : false;
  const activeGame = Boolean(snapshot?.game && activeGamePhases.has(snapshot.game.phase));
  const roomEditable = Boolean(snapshot && !activeGame);
  const handCap = snapshot?.maxHandSize ?? handLimitForPlayerCount(snapshot?.players.length ?? 2);
  const loadingRoom = view !== "landing" && !snapshot && !roomLoadError;
  const canAddDiscardCard = waitingDamage && discardTotal < pendingDamage;

  const refreshRoom = useCallback(async (roomCodeOverride?: string) => {
    const roomCode = roomCodeOverride ?? snapshot?.roomCode ?? initialRoomCode;
    if (!roomCode || !identity) return;
    try {
      const response = await apiFetchRoom(roomCode, identity.clientId);
      setSnapshot(response.snapshot);
      setRoomLoadError(null);
    } catch (error) {
      setRoomLoadError(error instanceof Error ? error.message : "Could not refresh room.");
    }
  }, [identity, initialRoomCode, snapshot?.roomCode]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const saved = typeof window === "undefined" ? "" : window.localStorage.getItem(savedNameKey) ?? "";
      const clientId = getClientId();
      const displayName = saved || "Guest";

      if (!client) {
        if (!cancelled) {
          setIdentity({ clientId, displayName });
          setAuthReady(true);
        }
        return;
      }

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
    if (!initialRoomCode || !identity || !authReady) return;
    if (snapshot?.roomCode === initialRoomCode) return;

    let cancelled = false;

    (async () => {
      try {
        const response = await apiFetchRoom(initialRoomCode, identity.clientId);
        if (!cancelled) {
          setSnapshot(response.snapshot);
          setRoomLoadError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setRoomLoadError(error instanceof Error ? error.message : "Could not load the room.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authReady, identity, initialRoomCode, snapshot?.roomCode]);

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
  }, [client, refreshRoom, snapshot?.roomCode]);

  useEffect(() => {
    if (snapshot) {
      window.localStorage.setItem("regicide-retro.room-code", snapshot.roomCode);
    }
  }, [snapshot]);

  useEffect(() => {
    if (!snapshot?.roomCode) return;
    if (view === "room" && activeGame) {
      router.replace(tablePath(snapshot.roomCode));
    }
    if (view === "table" && !snapshot.game) {
      router.replace(roomPath(snapshot.roomCode));
    }
  }, [activeGame, router, snapshot?.game, snapshot?.roomCode, view]);

  async function submitAction(action: Parameters<typeof apiRoomAction>[1]) {
    const roomCode = snapshot?.roomCode ?? initialRoomCode;
    if (!roomCode || !identity) return null;
    setBusy(true);
    try {
      const response = await apiRoomAction(roomCode, action);
      setSnapshot(response.snapshot);
      setRoomLoadError(null);
      if (action.action === "restart") {
        toast.success("Room restarted.");
      }
      return response.snapshot;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That action was rejected.");
      return null;
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
      router.push(roomPath(response.snapshot.roomCode));
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
      router.push(roomPath(response.snapshot.roomCode));
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

  async function updateRoomSize(nextMaxPlayers: number) {
    if (!identity) return;
    await submitAction({ action: "set-max-players", clientId: identity.clientId, maxPlayers: nextMaxPlayers });
  }

  async function startGame() {
    if (!identity) return;
    const nextSnapshot = await submitAction({ action: "start", clientId: identity.clientId });
    if (nextSnapshot && nextSnapshot.phase !== "lobby") {
      router.push(tablePath(nextSnapshot.roomCode));
    }
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
    setSelectedCardState({ context: selectionContext, ids: [] });
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
    setDiscardState({ context: selectionContext, ids: [] });
  }

  async function restart() {
    if (!identity) return;
    await submitAction({ action: "restart", clientId: identity.clientId });
  }

  function toggleCard(cardId: string, mode: "play" | "discard") {
    if (mode === "play") {
      setSelectedCardState((current) => {
        const ids = current.context === selectionContext ? current.ids : [];
        return {
          context: selectionContext,
          ids: ids.includes(cardId) ? ids.filter((id) => id !== cardId) : [...ids, cardId],
        };
      });
      return;
    }
    setDiscardState((current) => {
      const ids = current.context === selectionContext ? current.ids : [];
      if (!ids.includes(cardId) && discardTotal >= pendingDamage) {
        return current;
      }
      return {
        context: selectionContext,
        ids: ids.includes(cardId) ? ids.filter((id) => id !== cardId) : [...ids, cardId],
      };
    });
  }

  function renderLanding() {
    return (
      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="panel rounded-[1rem] p-5">
          <div className="pixel-font text-[0.65rem] tracking-[0.25em] text-[color:var(--accent)]">CREATE</div>
          <h2 className="mt-3 text-xl font-semibold">Create room</h2>
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
          <div className="pixel-font text-[0.65rem] tracking-[0.25em] text-[color:var(--accent)]">JOIN</div>
          <h2 className="mt-3 text-xl font-semibold">Join room</h2>
          <div className="mt-4 grid gap-3">
            <input
              className="input uppercase tracking-[0.3em]"
              placeholder="Room code"
              value={roomCodeInput}
              onChange={(event) => setRoomCodeInput(event.target.value.toUpperCase())}
            />
            <input className="input" placeholder="Nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} />
          </div>
          <button className="btn mt-4" onClick={() => void joinRoom()} disabled={busy || !authReady}>
            <ArrowRight className="h-4 w-4" />
            Join room
          </button>
        </div>
      </section>
    );
  }

  function renderRoomLobby() {
    if (!snapshot) return null;

    return (
      <section className="grid flex-1 gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="flex min-h-0 flex-col gap-4">
          <div className="panel rounded-[1rem] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="pixel-font text-[0.65rem] tracking-[0.28em] text-[color:var(--accent)]">ROOM {snapshot.roomCode}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <h2 className="text-2xl font-semibold">Choose seats</h2>
                  <span className="chip">{viewerPlayer?.name ?? identity?.displayName ?? "Guest"}</span>
                </div>
                <p className="subtle mt-2 text-sm">
                  {snapshot.game && !activeGame ? "Adjust seats or room size, then deal a fresh game." : "Ready everyone, then start."}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn" onClick={() => router.push("/")} disabled={busy}>
                  <ArrowLeft className="h-4 w-4" />
                  Home
                </button>
                <select
                  className="input w-auto min-w-36"
                  value={snapshot.maxPlayers}
                  onChange={(event) => void updateRoomSize(Number(event.target.value))}
                  disabled={busy || !viewerPlayer?.isHost || !roomEditable}
                  aria-label="Room size"
                >
                  <option value={2}>2 players</option>
                  <option value={3}>3 players</option>
                  <option value={4}>4 players</option>
                </select>
                <button className="btn" onClick={() => void toggleReady()} disabled={busy || !roomEditable}>
                  <RotateCw className="h-4 w-4" />
                  {viewerPlayer?.ready ? "Unready" : "Ready"}
                </button>
                <button className="btn btn-primary" onClick={() => void startGame()} disabled={busy || !canStart || !roomEditable || !roomReady}>
                  <Crown className="h-4 w-4" />
                  Start game
                </button>
              </div>
            </div>
          </div>

          <div className="panel rounded-[1rem] p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold">Seats</h3>
              <div className="chip">
                <Users className="h-4 w-4" />
                <span>{snapshot.players.length}/{snapshot.maxPlayers}</span>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {Array.from({ length: snapshot.maxPlayers }, (_, seat) => {
                const player = sortedPlayers.find((entry) => entry.seat === seat);
                return (
                  <button
                    key={seat}
                    className={`panel-soft rounded-[1rem] p-4 text-left ${player?.id === snapshot.viewerPlayerId ? "ring-2 ring-[color:var(--accent)]" : ""}`}
                    onClick={() => void toggleSeat(seat)}
                    disabled={busy || !roomEditable}
                  >
                    <div className="flex items-center justify-between">
                      <span className="pixel-font text-[0.55rem] text-[color:var(--accent)]">SEAT {seat + 1}</span>
                      {player?.isHost ? <CrownIcon className="h-4 w-4 text-[color:var(--accent)]" /> : null}
                    </div>
                    <div className="mt-3 text-lg font-semibold">{player?.name ?? "Open seat"}</div>
                    <div className="subtle mt-1 text-sm">
                      {player ? `${player.ready ? "Ready" : "Not ready"} · ${player.handCount} card slots` : "Tap to claim"}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="panel hidden rounded-[1rem] p-4 md:block">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="subtle text-sm">Royal order</div>
                <div className="text-lg font-semibold">Jacks, then Queens, then Kings</div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {["Jacks", "Queens", "Kings"].map((label) => (
                  <span key={label} className="chip">{label}</span>
                ))}
              </div>
            </div>
          </div>

          <div className="panel rounded-[1rem] p-4 md:hidden">
            <div className="subtle text-sm">Flow</div>
            <div className="mt-2 grid gap-2 text-sm">
              <div className="panel-soft rounded-[0.85rem] px-3 py-2">1. Claim a seat</div>
              <div className="panel-soft rounded-[0.85rem] px-3 py-2">2. Toggle ready</div>
              <div className="panel-soft rounded-[0.85rem] px-3 py-2">3. Host starts</div>
            </div>
          </div>
        </div>

        <aside className="hidden min-h-0 flex-col gap-4 md:flex">
          <div className="panel rounded-[1rem] p-4">
            <h3 className="text-lg font-semibold">Signals</h3>
            <div className="mt-3 grid gap-2">
              {buildPublicSignals().map((signal) => (
                <div key={signal.type} className="panel-soft rounded-[0.9rem] p-3">
                  <div className="font-medium">{signal.label}</div>
                  <div className="subtle mt-1 text-sm">{signal.type.replaceAll("_", " ")}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel rounded-[1rem] p-4">
            <h3 className="text-lg font-semibold">Quick tips</h3>
            <div className="mt-3 grid gap-2 text-sm subtle">
              <div>Other players keep their hands hidden; only card counts stay public.</div>
              <div>Clubs double damage. Spades add shield. Hearts recycle discard. Diamonds draw in turn order.</div>
              <div>2 players hold 7 cards, 3 players hold 6, and 4 players hold 5.</div>
            </div>
          </div>
        </aside>
      </section>
    );
  }

  function renderTableView() {
    if (!snapshot?.game) return null;
    const game = snapshot.game;
    const occupiedPlayers = game.players.slice().sort((a, b) => a.seat - b.seat);
    const modalCards = modalPile === "table" ? game.table : modalPile === "discard" ? game.discard : [];
    const modalTitle = modalPile === "table" ? "Cards played" : "Discard pile";
    const modalEmpty = modalPile === "table" ? "No cards are on the table yet." : "Discard pile is empty.";
    const logEntries = actionLogExpanded ? game.actionLog : game.actionLog.slice(0, 4);
    const chooserPlayer = game.players.find((player) => player.id === game.turn.jesterChooserPlayerId) ?? null;

    return (
      <section className="grid flex-1 gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="flex min-h-0 flex-col gap-4">
          <div className="panel rounded-[1rem] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="pixel-font text-[0.65rem] tracking-[0.28em] text-[color:var(--accent)]">TABLE {snapshot.roomCode}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <h2 className="text-2xl font-semibold">Shared table state</h2>
                  <span className="chip">{activePlayer?.name ?? "Unknown"} to act</span>
                </div>
                <p className="subtle mt-2">Every teammate is visible by count only. The board keeps current pressure, public piles, and royal order in one place.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn" onClick={() => void refreshRoom()} disabled={busy}>
                  Refresh
                </button>
                <button className="btn btn-ghost" onClick={() => router.push(roomPath(snapshot.roomCode))} disabled={busy}>
                  <ArrowLeft className="h-4 w-4" />
                  Room
                </button>
                <button className="btn btn-ghost" onClick={() => void restart()} disabled={busy || !viewerPlayer?.isHost}>
                  Restart
                </button>
              </div>
            </div>
          </div>

          <div className="panel rounded-[1rem] p-4">
            <button
              className="flex w-full items-center justify-between gap-3 text-left"
              type="button"
              onClick={() => setActionLogExpanded((value) => !value)}
            >
              <div>
                <div className="subtle text-sm">Turn log</div>
                <div className="text-lg font-semibold">What just happened</div>
              </div>
              <div className="flex items-center gap-2">
                <div className="chip text-xs">
                  <ClipboardList className="h-4 w-4" />
                  <span>{game.actionLog.length}</span>
                </div>
                <ChevronDown className={`h-4 w-4 transition-transform ${actionLogExpanded ? "rotate-180" : ""}`} />
              </div>
            </button>
            {actionLogExpanded ? (
              <div className="mt-4 grid gap-2">
                {logEntries.map((entry) => (
                  <div key={entry.id} className="panel-soft rounded-[0.9rem] p-3 text-sm">
                    {entry.message}
                  </div>
                ))}
                {game.actionLog.length === 0 ? <div className="subtle text-sm">No moves logged yet.</div> : null}
              </div>
            ) : null}
          </div>

          <div className="rounded-[1.8rem] border border-[rgba(216,177,91,0.25)] bg-[radial-gradient(circle_at_top,rgba(95,122,84,0.22),transparent_40%),radial-gradient(circle_at_center,rgba(28,63,47,0.85),rgba(16,30,24,0.96))] p-4 shadow-[0_18px_44px_rgba(0,0,0,0.4)] md:p-6">
            <div className="grid gap-4">
              <EnemyPanel game={snapshot.game} />
              {canChooseNext ? (
                <div className="rounded-[1rem] border border-[color:var(--accent)] bg-[#171311] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="pixel-font text-[0.55rem] tracking-[0.22em] text-[color:var(--accent)]">JESTER ACTION</div>
                      <div className="mt-2 text-lg font-semibold">Choose who goes next</div>
                      <div className="subtle mt-1 text-sm">
                        {chooserPlayer?.name ? `${chooserPlayer.name} played the Jester. Pick the next active player.` : "Pick the next active player."}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button className="btn" onClick={() => void sendSignal("can_go_next")} disabled={busy}>
                        I can go next
                      </button>
                      <button className="btn" onClick={() => void sendSignal("rather_not_next")} disabled={busy}>
                        I’d rather not
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {occupiedPlayers.map((player) => (
                      <button
                        key={player.id}
                        className={`btn justify-between text-left ${player.id === snapshot.viewerPlayerId ? "border-[color:var(--accent)]" : ""}`}
                        onClick={() => void chooseNext(player.id)}
                        disabled={busy}
                      >
                        <span className="flex flex-col items-start">
                          <span>{player.name}</span>
                          <span className="text-xs subtle">seat {player.seat + 1}</span>
                        </span>
                        <span className="text-xs subtle">{player.id === snapshot.viewerPlayerId ? "You" : ""}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="grid gap-4 lg:grid-cols-2">
                <CardStackPanel
                  title="Cards played"
                  subtitle="Live table stack"
                  cards={snapshot.game.table}
                  expanded={tableExpanded}
                  onToggle={() => setTableExpanded((value) => !value)}
                  onOpen={() => setModalPile("table")}
                  empty="No cards are on the table yet."
                />
                <CardStackPanel
                  title="Cards used"
                  subtitle={`Discard pile · ${snapshot.game.discardCount} cards`}
                  cards={snapshot.game.discard}
                  expanded={discardExpanded}
                  onToggle={() => setDiscardExpanded((value) => !value)}
                  onOpen={() => setModalPile("discard")}
                  empty="Discard pile is empty."
                />
              </div>
            </div>
          </div>

          <div className="panel rounded-[1rem] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="subtle text-sm">Your hand</div>
                <div className="text-lg font-semibold">
                  {myHand.length}/{handCap} cards
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="chip">
                  <Shield className="h-4 w-4" />
                  <span>{snapshot.game.phase}</span>
                </div>
                <div className="chip">
                  <Swords className="h-4 w-4" />
                  <span>{isMyTurn ? "Your turn" : "Waiting"}</span>
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 md:gap-3">
              {myHand.map((card) => {
                const selected = selectedCards.includes(card.id) || discardSelection.includes(card.id);
                const mode = waitingDamage ? "discard" : "play";
                const lockedDiscardCard = waitingDamage && !selected && !canAddDiscardCard;
                return (
                  <button
                    key={card.id}
                    className={`group relative flex min-h-[6.4rem] w-[4.6rem] flex-col justify-between rounded-[0.9rem] border p-2 text-left transition-transform disabled:cursor-not-allowed disabled:opacity-50 md:min-h-[7.2rem] md:w-[5rem] ${cardBackdrop(card)} ${
                      selected ? "translate-y-[-2px] border-[color:var(--accent)]" : "border-[color:var(--panel-border)]"
                    }`}
                    disabled={lockedDiscardCard}
                    onClick={() => toggleCard(card.id, mode)}
                  >
                    <div className="flex items-center justify-between text-[0.72rem] font-semibold">
                      <span className={suitClass(card)}>{formatRank(card)}</span>
                      {card.suit === "joker" ? (
                        <JesterIcon className="h-4 w-4 text-[color:var(--accent)]" />
                      ) : (
                        <SuitIcon suit={card.suit} className={`h-4 w-4 ${suitClass(card)}`} />
                      )}
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
              <div className="mt-4 rounded-[0.9rem] border border-[color:var(--panel-border)] bg-[#171310] p-3">
                <div className="subtle text-sm">You must discard cards worth at least {pendingDamage} damage.</div>
                <div className="mt-2 text-sm">Selected: {discardTotal} damage</div>
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
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="subtle text-sm">Players</div>
                <div className="text-lg font-semibold">Hands stay hidden</div>
              </div>
              <div className="chip text-xs">
                <Users className="h-4 w-4" />
                <span>{occupiedPlayers.length}</span>
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {occupiedPlayers.map((player) => (
                <PlayerSeatCard
                  key={player.id}
                  player={player}
                  active={player.seat === game.activeSeat}
                  isViewer={player.id === snapshot.viewerPlayerId}
                  pendingDamage={player.id === game.turn.pendingDamageForPlayerId ? pendingDamage : 0}
                />
              ))}
            </div>
          </div>
        </div>

        <aside className="hidden min-h-0 flex-col gap-4 xl:flex">
          <div className="panel rounded-[1rem] p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold">Signals</h3>
              <div className="chip">
                <Users className="h-4 w-4" />
                <span>Public only</span>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {buildPublicSignals().map((signal) => (
                <button key={signal.type} className="btn btn-ghost" disabled={busy} onClick={() => void sendSignal(signal.type)}>
                  {signal.type === "jester_ready" ? <JesterIcon className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                  {signal.label}
                </button>
              ))}
            </div>
          </div>
        </aside>
        {modalPile ? (
          <CardPileModal title={modalTitle} cards={modalCards} empty={modalEmpty} onClose={() => setModalPile(null)} />
        ) : null}
      </section>
    );
  }

  let content: ReactNode;

  if (view === "landing") {
    content = renderLanding();
  } else if (loadingRoom) {
    content = <LoadingState message="Loading room..." />;
  } else if (roomLoadError || !snapshot) {
    content = (
      <LoadingState
        message={roomLoadError ?? "Room not found."}
        action={
          <button className="btn" onClick={() => router.push("/")}>
            <ArrowLeft className="h-4 w-4" />
            Back home
          </button>
        }
      />
    );
  } else if (view === "room") {
    content = renderRoomLobby();
  } else {
    content = renderTableView();
  }

  return (
    <main className="min-h-screen px-4 py-5 text-[15px] md:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] max-w-7xl flex-col gap-4">
        <header className="panel flex flex-col gap-4 rounded-[1rem] p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-1">
            <div className="pixel-font text-[0.7rem] tracking-[0.2em] text-[color:var(--accent)]">REGICIDE RETRO</div>
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Co-op card combat with a dedicated table view.</h1>
            <p className="subtle max-w-3xl">
              Realtime rooms, hidden teammate hands, and a cleaner board once the game starts.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="chip">
              <Users className="h-4 w-4" />
              <span>{snapshot ? `${snapshot.players.length}/${snapshot.maxPlayers}` : "2-4 players"}</span>
            </div>
            <div className="chip">
              <Shield className="h-4 w-4" />
              <span>{snapshot?.game?.phase ?? snapshot?.phase ?? "Lobby"}</span>
            </div>
            <div className="chip">
              <Sparkles className="h-4 w-4" />
              <span>{snapshot?.game?.lastEvent ?? "Create or join a room."}</span>
            </div>
          </div>
        </header>

        {content}
      </div>
    </main>
  );
}
