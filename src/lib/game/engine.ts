import {
  type Card,
  type EnemyCard,
  type GameLogEntry,
  type GameMove,
  type GameState,
  type PublicGameState,
  type PlayerState,
  type SignalType,
  type Suit,
} from "./types";

const suitOrder: Suit[] = ["hearts", "diamonds", "clubs", "spades"];
const rankOrder = [2, 3, 4, 5, 6, 7, 8, 9, 10, "A", "J", "Q", "K"] as const;

const cardValues: Record<string, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  A: 1,
  J: 10,
  Q: 15,
  K: 20,
  JOKER: 0,
};

export function handLimitForPlayerCount(playerCount: number): number {
  if (playerCount <= 1) return 8;
  if (playerCount === 2) return 7;
  if (playerCount === 3) return 6;
  return 5;
}

export function jokersForPlayerCount(playerCount: number): number {
  if (playerCount <= 2) return 0;
  if (playerCount === 3) return 1;
  return 2;
}

function uid(prefix = "id") {
  return `${prefix}_${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10)}`;
}

function shuffle<T>(items: T[], random = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function cardLabel(rank: string, suit: string) {
  if (rank === "JOKER") return "Joker";
  return `${rank} of ${suit}`;
}

function createCard(rank: string, suit: string): Card {
  const normalizedSuit = suit as Suit | "joker";
  const color = normalizedSuit === "hearts" || normalizedSuit === "diamonds" ? normalizedSuit : normalizedSuit === "joker" ? "joker" : normalizedSuit;
  return {
    id: uid("card"),
    suit: normalizedSuit,
    rank: rank as Card["rank"],
    value: cardValues[rank],
    label: cardLabel(rank, suit),
    color,
  };
}

function createEnemy(rank: "J" | "Q" | "K", suit: Suit): EnemyCard {
  const base = rank === "J" ? { attack: 10, health: 20 } : rank === "Q" ? { attack: 15, health: 30 } : { attack: 20, health: 40 };
  return {
    ...createCard(rank, suit),
    ...base,
    remainingHealth: base.health,
    shield: 0,
    suitImmune: suit,
    defeated: false,
  };
}

export function buildTavernDeck(playerCount: number, random = Math.random) {
  const cards: Card[] = [];
  for (const suit of suitOrder) {
    for (const rank of rankOrder.slice(0, 9)) {
      cards.push(createCard(String(rank), suit));
    }
    cards.push(createCard("A", suit));
  }
  for (let i = 0; i < jokersForPlayerCount(playerCount); i += 1) {
    cards.push(createCard("JOKER", "joker"));
  }
  return shuffle(cards, random);
}

export function buildCastleDeck(random = Math.random) {
  const cards: EnemyCard[] = [];
  for (const suit of suitOrder) {
    cards.push(createEnemy("J", suit));
    cards.push(createEnemy("Q", suit));
    cards.push(createEnemy("K", suit));
  }
  return shuffle(cards, random);
}

function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

function addLog(state: GameState, type: string, message: string, actorPlayerId: string | null = null) {
  const entry: GameLogEntry = {
    id: uid("log"),
    type,
    message,
    at: new Date().toISOString(),
    actorPlayerId,
  };
  state.actionLog.unshift(entry);
  state.lastEvent = message;
}

function currentPlayer(state: GameState): PlayerState {
  const player = state.players.find((entry) => entry.seat === state.activeSeat);
  if (!player) throw new Error("Active player is missing.");
  return player;
}

function nextOccupiedSeat(state: GameState, fromSeat: number) {
  const seats = state.players
    .filter((player) => player.isConnected)
    .map((player) => player.seat)
    .sort((a, b) => a - b);
  if (seats.length === 0) return fromSeat;
  const currentIndex = Math.max(0, seats.indexOf(fromSeat));
  return seats[(currentIndex + 1) % seats.length];
}

function allOtherPlayersYielded(state: GameState, playerId: string) {
  const others = state.players.filter((player) => player.id !== playerId && player.isConnected);
  return others.length > 0 && others.every((player) => player.lastActionWasYield);
}

function pickCardsByIds(cards: Card[], ids: string[]) {
  const set = new Set(ids);
  const picked: Card[] = [];
  const remaining: Card[] = [];
  for (const card of cards) {
    if (set.has(card.id)) {
      picked.push(card);
      set.delete(card.id);
    } else {
      remaining.push(card);
    }
  }
  if (set.size > 0) throw new Error("One or more cards could not be found.");
  return { picked, remaining };
}

function totalValue(cards: Card[]) {
  return cards.reduce((sum, card) => sum + card.value, 0);
}

function ensurePlaying(state: GameState) {
  if (state.phase !== "playing" && state.phase !== "awaiting-damage" && state.phase !== "awaiting-next-player") {
    throw new Error("Game is not in a playable state.");
  }
}

function ensureCurrentEnemy(state: GameState) {
  if (!state.currentEnemy) throw new Error("There is no current enemy.");
  return state.currentEnemy;
}

function resolveHearts(state: GameState, value: number) {
  if (state.discard.length === 0 || value <= 0) return;
  const shuffled = shuffle(state.discard);
  const returned = shuffled.slice(0, Math.min(value, shuffled.length));
  state.discard = shuffled.slice(returned.length);
  state.tavern.push(...returned);
}

function resolveDiamonds(state: GameState, value: number, actingSeat: number) {
  let drawn = 0;
  const seats = state.players
    .filter((player) => player.isConnected)
    .sort((a, b) => a.seat - b.seat);
  let pointer = seats.findIndex((player) => player.seat === actingSeat);
  if (pointer < 0) pointer = 0;
  while (drawn < value && state.tavern.length > 0) {
    const player = seats[pointer % seats.length];
    pointer += 1;
    if (player.hand.length >= player.handLimit) {
      if (seats.every((entry) => entry.hand.length >= entry.handLimit)) break;
      continue;
    }
    player.hand.push(state.tavern.shift() as Card);
    drawn += 1;
  }
}

function resolveSpades(state: GameState, value: number) {
  const enemy = ensureCurrentEnemy(state);
  enemy.shield += value;
}

function applySuitPowers(state: GameState, cards: Card[], total: number, jesterUsed: boolean, actorSeat: number) {
  const enemy = ensureCurrentEnemy(state);
  const suits = new Set(cards.filter((card) => card.suit !== "joker").map((card) => card.suit as Suit));
  if (jesterUsed) {
    enemy.suitImmune = null;
  }
  if (suits.has("hearts") && enemy.suitImmune !== "hearts") resolveHearts(state, total);
  if (suits.has("diamonds") && enemy.suitImmune !== "diamonds") resolveDiamonds(state, total, actorSeat);
  if (suits.has("clubs") && enemy.suitImmune !== "clubs") {
    // Club bonus applies during damage calculation.
  }
  if (suits.has("spades") && enemy.suitImmune !== "spades") resolveSpades(state, total);
}

function applyDamageToEnemy(state: GameState, cards: Card[], total: number) {
  const enemy = ensureCurrentEnemy(state);
  const usesClub = cards.some((card) => card.suit === "clubs");
  const damage = usesClub ? total * 2 : total;
  enemy.remainingHealth = Math.max(0, enemy.remainingHealth - damage);
  return { damage, exactKill: enemy.remainingHealth === 0, usesClub };
}

function defeatEnemy(state: GameState, playedCards: Card[], actorPlayerId: string) {
  const enemy = ensureCurrentEnemy(state);
  enemy.defeated = true;
  state.discard.push(...playedCards, enemy);
  state.table = [];
  state.players.forEach((player) => {
    player.lastActionWasYield = false;
    if (player.id === actorPlayerId) {
      player.signal = player.signal;
    }
  });
  const nextEnemy = state.castle.shift() ?? null;
  if (nextEnemy) {
    state.currentEnemy = nextEnemy;
    state.turn.pendingDamageAmount = 0;
    state.turn.pendingDamageForPlayerId = null;
    state.turn.nextPlayerChoiceOpen = false;
    state.turn.jesterChooserPlayerId = null;
    state.phase = "playing";
    addLog(state, "enemy-defeated", `${enemy.label} defeated. ${nextEnemy.label} emerges from the castle.`);
  } else {
    state.currentEnemy = null;
    state.phase = "won";
    state.winner = "players";
    addLog(state, "game-won", `${enemy.label} was the final royal. The players win.`);
  }
}

function finishTurnToNextPlayer(state: GameState) {
  const nextSeat = nextOccupiedSeat(state, state.activeSeat);
  state.activeSeat = nextSeat;
  state.turn.pendingDamageAmount = 0;
  state.turn.pendingDamageForPlayerId = null;
  state.turn.nextPlayerChoiceOpen = false;
  state.turn.jesterChooserPlayerId = null;
  state.turn.chosenNextPlayerId = null;
  if (state.phase !== "won" && state.phase !== "lost") {
    state.phase = "playing";
  }
}

function damageEnemyOrAdvance(state: GameState, playedCards: Card[], actor: PlayerState) {
  const enemy = ensureCurrentEnemy(state);
  if (enemy.remainingHealth === 0) {
    defeatEnemy(state, playedCards, actor.id);
    return;
  }
  const dealt = Math.max(0, enemy.attack - enemy.shield);
  if (dealt > 0) {
    state.phase = "awaiting-damage";
    state.turn.pendingDamageAmount = dealt;
    state.turn.pendingDamageForPlayerId = actor.id;
    state.turn.nextPlayerChoiceOpen = false;
    state.turn.jesterChooserPlayerId = null;
    addLog(state, "enemy-attack", `${enemy.label} hits for ${dealt}. ${actor.name} must discard cards.`);
  } else {
    state.table = [];
    finishTurnToNextPlayer(state);
    addLog(state, "turn-pass", `${actor.name} survived ${enemy.label}'s attack.`);
  }
}

function validateCombo(cards: Card[]) {
  if (cards.length < 2) throw new Error("A combo needs at least two cards.");
  const hasAce = cards.some((card) => card.rank === "A");
  if (hasAce && cards.length !== 2) throw new Error("An ace may only be paired with one other card.");
  const nonAces = cards.filter((card) => card.rank !== "A");
  if (nonAces.length > 0 && nonAces.some((card) => card.rank !== nonAces[0].rank)) {
    throw new Error("Combo cards must share the same rank.");
  }
  if (!hasAce) {
    const total = totalValue(cards);
    if (total > 10) throw new Error("Combo total must be 10 or less.");
  }
  if (hasAce && cards.length === 2 && totalValue(cards) > 10) {
    throw new Error("Ace pair total must be 10 or less.");
  }
}

export function createInitialGameState(roomCode: string, players: PlayerState[], random = Math.random): GameState {
  const handLimit = handLimitForPlayerCount(players.length);
  const tavern = buildTavernDeck(players.length, random);
  const castle = buildCastleDeck(random);
  const hydratedPlayers = players.map((player, index) => ({
    ...player,
    seat: index,
    handLimit,
    hand: tavern.splice(0, handLimit),
    shield: 0,
    lastActionWasYield: false,
    signal: null,
  }));
  return {
    id: uid("game"),
    roomCode,
    phase: "playing",
    activeSeat: 0,
    currentEnemy: castle.shift() ?? null,
    castle,
    tavern,
    discard: [],
    table: [],
    players: hydratedPlayers,
    turn: {
      pendingDamageForPlayerId: null,
      pendingDamageAmount: 0,
      nextPlayerChoiceOpen: false,
      jesterChooserPlayerId: null,
      chosenNextPlayerId: null,
    },
    turnNumber: 1,
    winner: null,
    lastEvent: "The first royal is revealed.",
    actionLog: [],
  };
}

export function toPublicGameState(state: GameState): PublicGameState {
  return {
    id: state.id,
    roomCode: state.roomCode,
    phase: state.phase,
    activeSeat: state.activeSeat,
    currentEnemy: state.currentEnemy,
    castle: state.castle,
    tavernCount: state.tavern.length,
    discardCount: state.discard.length,
    discardTop: state.discard.at(-1) ?? null,
    table: state.table,
    players: state.players.map((player) => ({
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
    })),
    turn: state.turn,
    turnNumber: state.turnNumber,
    winner: state.winner,
    lastEvent: state.lastEvent,
    actionLog: state.actionLog,
  };
}

function findPlayer(state: GameState, playerId: string) {
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) throw new Error("Player not found.");
  return player;
}

function findCard(hand: Card[], cardId: string) {
  const card = hand.find((entry) => entry.id === cardId);
  if (!card) throw new Error("Card not found in hand.");
  return card;
}

function ensurePlayerTurn(state: GameState, playerId: string) {
  const player = findPlayer(state, playerId);
  if (player.seat !== state.activeSeat) {
    throw new Error("It is not this player's turn.");
  }
  return player;
}

function canYield(state: GameState, playerId: string) {
  if (state.players.length <= 1) return false;
  return !allOtherPlayersYielded(state, playerId);
}

function markSignal(state: GameState, playerId: string, signal: SignalType) {
  const player = findPlayer(state, playerId);
  player.signal = signal;
  addLog(state, "signal", `${player.name} sent a public signal.`, playerId);
}

function resetSignals(state: GameState) {
  state.players.forEach((player) => {
    if (player.signal === "can_go_next" || player.signal === "rather_not_next") {
      player.signal = null;
    }
  });
}

export function applyMove(state: GameState, move: GameMove): GameState {
  const next = cloneState(state);
  ensurePlaying(next);

  if (move.type === "sendSignal") {
    markSignal(next, move.playerId, move.signal);
    return next;
  }

  if (move.type === "restart") {
    throw new Error("Restart requires a fresh room setup.");
  }

  const player = ensurePlayerTurn(next, move.playerId);
  const enemy = ensureCurrentEnemy(next);

  if (next.phase === "awaiting-damage" && move.type !== "discardForDamage") {
    throw new Error("Discard cards to resolve damage first.");
  }

  if (move.type === "yield") {
    if (!canYield(next, player.id)) {
      throw new Error("You cannot yield because every other player has already yielded.");
    }
    player.lastActionWasYield = true;
    addLog(next, "yield", `${player.name} yielded.`, player.id);
    if (enemy.remainingHealth > 0) {
      const dealt = Math.max(0, enemy.attack - enemy.shield);
      if (dealt > 0) {
        next.phase = "awaiting-damage";
        next.turn.pendingDamageAmount = dealt;
        next.turn.pendingDamageForPlayerId = player.id;
        addLog(next, "enemy-attack", `${enemy.label} attacks for ${dealt}.`);
      } else {
        finishTurnToNextPlayer(next);
      }
    }
    next.turnNumber += 1;
    return next;
  }

  if (move.type === "discardForDamage") {
    if (next.turn.pendingDamageForPlayerId !== player.id || next.phase !== "awaiting-damage") {
      throw new Error("No damage is waiting for this player.");
    }
    const { picked, remaining } = pickCardsByIds(player.hand, move.cardIds);
    const discardedValue = totalValue(picked);
    if (discardedValue < next.turn.pendingDamageAmount) {
      throw new Error("The discarded cards do not absorb enough damage.");
    }
    player.hand = remaining;
    next.discard.push(...picked);
    player.lastActionWasYield = false;
    addLog(next, "damage-paid", `${player.name} discarded ${picked.length} card(s) to absorb damage.`, player.id);
    finishTurnToNextPlayer(next);
    next.turnNumber += 1;
    resetSignals(next);
    return next;
  }

  const shouldChooseNext = next.phase === "awaiting-next-player";
  if (shouldChooseNext && move.type !== "chooseNextPlayer") {
    throw new Error("Choose the next player after a Jester.");
  }

  if (move.type === "chooseNextPlayer") {
    if (!next.turn.nextPlayerChoiceOpen || next.turn.jesterChooserPlayerId !== player.id) {
      throw new Error("Only the Jester player can choose the next player.");
    }
    const chosen = findPlayer(next, move.nextPlayerId);
    next.activeSeat = chosen.seat;
    next.turn.nextPlayerChoiceOpen = false;
    next.turn.jesterChooserPlayerId = null;
    next.turn.chosenNextPlayerId = chosen.id;
    next.phase = "playing";
    addLog(next, "next-player", `${player.name} chose ${chosen.name} to go next.`, player.id);
    next.turnNumber += 1;
    resetSignals(next);
    return next;
  }

  const cardIds =
    move.type === "playSingle"
      ? [move.cardId]
      : move.type === "playJester"
        ? [move.cardId]
        : move.type === "playAcePair"
          ? [move.aceId, move.otherCardId]
          : move.cardIds;
  const { picked: playedCards, remaining } = pickCardsByIds(player.hand, cardIds);
  player.hand = remaining;
  next.table = playedCards;
  player.lastActionWasYield = false;

  if (move.type === "playJester" || playedCards.every((card) => card.suit === "joker")) {
    next.phase = "awaiting-next-player";
    next.turn.nextPlayerChoiceOpen = true;
    next.turn.jesterChooserPlayerId = player.id;
    next.turn.pendingDamageForPlayerId = null;
    next.turn.pendingDamageAmount = 0;
    enemy.suitImmune = null;
    next.discard.push(...playedCards);
    addLog(next, "jester", `${player.name} played a Jester. The suit block is removed and the next player can be chosen.`, player.id);
    next.turnNumber += 1;
    return next;
  }

  if (move.type === "playCombo" || move.type === "playAcePair") {
    validateCombo(playedCards);
  }

  const total = totalValue(playedCards);
  const usesClub = playedCards.some((card) => card.suit === "clubs");
  const hasAce = playedCards.some((card) => card.rank === "A");

  applySuitPowers(next, playedCards, total, false, player.seat);
  const result = applyDamageToEnemy(next, playedCards, total);
  addLog(
    next,
    "attack",
    `${player.name} played ${playedCards.map((card) => card.label).join(" + ")}${hasAce ? " with an animal companion" : ""}${usesClub ? " for doubled damage" : ""}.`,
    player.id,
  );

  if (result.exactKill) {
    defeatEnemy(next, playedCards, player.id);
    next.turnNumber += 1;
    return next;
  }

  next.discard.push(...playedCards);
  damageEnemyOrAdvance(next, playedCards, player);
  next.turnNumber += 1;
  resetSignals(next);
  return next;
}

export function buildPublicSignals() {
  return [
    { type: "need_help", label: "Need help" },
    { type: "need_draw", label: "Need draw" },
    { type: "can_go_next", label: "I can go next" },
    { type: "rather_not_next", label: "I'd rather not" },
    { type: "hand_count", label: "Hand count" },
    { type: "tavern_low", label: "Tavern low" },
    { type: "danger", label: "Danger" },
    { type: "jester_ready", label: "Jester ready" },
  ] as const;
}

export function getPublicSignalLabel(signal: SignalType | null) {
  return buildPublicSignals().find((item) => item.type === signal)?.label ?? "Silent";
}

export function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}
