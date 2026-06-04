export type Suit = "hearts" | "diamonds" | "clubs" | "spades";
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | "A" | "J" | "Q" | "K" | "JOKER";

export type GamePhase =
  | "lobby"
  | "playing"
  | "awaiting-next-player"
  | "awaiting-damage"
  | "won"
  | "lost";

export type SignalType =
  | "need_help"
  | "need_draw"
  | "can_go_next"
  | "rather_not_next"
  | "hand_count"
  | "tavern_low"
  | "danger"
  | "jester_ready";

export interface Card {
  id: string;
  suit: Suit | "joker";
  rank: Rank;
  value: number;
  label: string;
  color: Suit | "joker";
}

export interface EnemyCard extends Card {
  attack: number;
  health: number;
  remainingHealth: number;
  shield: number;
  suitImmune: Suit | null;
  defeated: boolean;
}

export interface PlayerState {
  id: string;
  name: string;
  seat: number;
  isHost: boolean;
  isConnected: boolean;
  ready: boolean;
  hand: Card[];
  shield: number;
  lastActionWasYield: boolean;
  signal: SignalType | null;
  handLimit: number;
}

export interface PublicPlayerState {
  id: string;
  name: string;
  seat: number;
  isHost: boolean;
  isConnected: boolean;
  ready: boolean;
  handCount: number;
  shield: number;
  lastActionWasYield: boolean;
  signal: SignalType | null;
  handLimit: number;
}

export interface TurnContext {
  pendingDamageForPlayerId: string | null;
  pendingDamageAmount: number;
  nextPlayerChoiceOpen: boolean;
  jesterChooserPlayerId: string | null;
  chosenNextPlayerId: string | null;
}

export interface GameState {
  id: string;
  roomCode: string;
  phase: GamePhase;
  activeSeat: number;
  currentEnemy: EnemyCard | null;
  castle: EnemyCard[];
  tavern: Card[];
  discard: Card[];
  table: Card[];
  players: PlayerState[];
  turn: TurnContext;
  turnNumber: number;
  winner: "players" | "enemies" | null;
  lastEvent: string;
  actionLog: GameLogEntry[];
}

export interface PublicGameState {
  id: string;
  roomCode: string;
  phase: GamePhase;
  activeSeat: number;
  currentEnemy: EnemyCard | null;
  castle: EnemyCard[];
  tavernCount: number;
  discardCount: number;
  discardTop: Card | null;
  discard: Card[];
  table: Card[];
  players: PublicPlayerState[];
  turn: TurnContext;
  turnNumber: number;
  winner: "players" | "enemies" | null;
  lastEvent: string;
  actionLog: GameLogEntry[];
}

export interface GameLogEntry {
  id: string;
  type: string;
  message: string;
  at: string;
  actorPlayerId: string | null;
}

export type GameMove =
  | { type: "playSingle"; playerId: string; cardId: string }
  | { type: "playCombo"; playerId: string; cardIds: string[] }
  | { type: "playAcePair"; playerId: string; aceId: string; otherCardId: string }
  | { type: "playJester"; playerId: string; cardId: string }
  | { type: "yield"; playerId: string }
  | { type: "discardForDamage"; playerId: string; cardIds: string[] }
  | { type: "chooseNextPlayer"; playerId: string; nextPlayerId: string }
  | { type: "sendSignal"; playerId: string; signal: SignalType }
  | { type: "restart"; playerId: string };

export interface RoomSnapshot {
  roomCode: string;
  maxPlayers: number;
  createdAt: string;
  updatedAt: string;
  game: PublicGameState | null;
  players: PublicPlayerState[];
  self?: {
    playerId: string;
    hand: Card[];
  } | null;
  viewerPlayerId: string | null;
  maxHandSize: number;
  phase: GamePhase;
  nextAction: string;
  toast?: { tone: "info" | "success" | "warning" | "error"; message: string } | null;
}
