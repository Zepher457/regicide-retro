import { describe, expect, it } from "vitest";
import {
  applyMove,
  buildCastleDeck,
  buildTavernDeck,
  handLimitForPlayerCount,
  jokersForPlayerCount,
} from "./engine";
import type { Card, EnemyCard, GameState, PlayerState } from "./types";

function makeCard(id: string, suit: Card["suit"], rank: Card["rank"], value: number): Card {
  return { id, suit, rank, value, label: `${rank}-${suit}`, color: suit === "hearts" || suit === "diamonds" ? suit : suit === "joker" ? "joker" : suit };
}

function makeEnemy(suit: "hearts" | "diamonds" | "clubs" | "spades", attack = 10, health = 20): EnemyCard {
  return {
    ...makeCard(`enemy-${suit}`, suit, "J", 10),
    attack,
    health,
    remainingHealth: health,
    shield: 0,
    suitImmune: suit,
    defeated: false,
  };
}

function makePlayer(id: string, seat: number, hand: Card[] = []): PlayerState {
  return {
    id,
    name: id,
    seat,
    isHost: seat === 0,
    isConnected: true,
    ready: true,
    hand,
    shield: 0,
    lastActionWasYield: false,
    signal: null,
    handLimit: 7,
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  const players = overrides.players ?? [makePlayer("p1", 0), makePlayer("p2", 1)];
  return {
    id: "game_1",
    roomCode: "ABCDE",
    phase: "playing",
    activeSeat: 0,
    currentEnemy: makeEnemy("spades", 10, 20),
    castle: [makeEnemy("hearts", 15, 30)],
    tavern: [makeCard("d1", "diamonds", 2, 2), makeCard("d2", "clubs", 3, 3)],
    discard: [makeCard("x1", "hearts", 4, 4), makeCard("x2", "spades", 5, 5)],
    table: [],
    players,
    turn: {
      pendingDamageForPlayerId: null,
      pendingDamageAmount: 0,
      nextPlayerChoiceOpen: false,
      jesterChooserPlayerId: null,
      chosenNextPlayerId: null,
    },
    turnNumber: 1,
    winner: null,
    lastEvent: "test",
    actionLog: [],
    ...overrides,
  };
}

describe("deck generation", () => {
  it("builds the correct hand limits and joker counts", () => {
    expect(handLimitForPlayerCount(2)).toBe(7);
    expect(handLimitForPlayerCount(3)).toBe(6);
    expect(handLimitForPlayerCount(4)).toBe(5);
    expect(jokersForPlayerCount(2)).toBe(0);
    expect(jokersForPlayerCount(3)).toBe(1);
    expect(jokersForPlayerCount(4)).toBe(2);
  });

  it("builds the expected tavern and castle decks", () => {
    const castle = buildCastleDeck(() => 0.5);
    expect(castle).toHaveLength(12);
    expect(castle.slice(0, 4).every((card) => card.rank === "J")).toBe(true);
    expect(castle.slice(4, 8).every((card) => card.rank === "Q")).toBe(true);
    expect(castle.slice(8, 12).every((card) => card.rank === "K")).toBe(true);
    expect(buildTavernDeck(2).filter((card) => card.rank === "JOKER")).toHaveLength(0);
    expect(buildTavernDeck(3).filter((card) => card.rank === "JOKER")).toHaveLength(1);
    expect(buildTavernDeck(4).filter((card) => card.rank === "JOKER")).toHaveLength(2);
  });
});

describe("suit powers", () => {
  it("clubs double the damage", () => {
    const state = makeState({
      players: [makePlayer("p1", 0, [makeCard("c1", "clubs", 4, 4)])],
      currentEnemy: makeEnemy("spades", 10, 20),
    });
    const next = applyMove(state, { type: "playSingle", playerId: "p1", cardId: "c1" });
    expect(next.currentEnemy?.remainingHealth).toBe(12);
  });

  it("spades add shield", () => {
    const state = makeState({
      players: [makePlayer("p1", 0, [makeCard("s1", "spades", 3, 3)])],
      currentEnemy: makeEnemy("clubs", 10, 20),
    });
    const next = applyMove(state, { type: "playSingle", playerId: "p1", cardId: "s1" });
    expect(next.currentEnemy?.shield).toBe(3);
  });

  it("hearts pull cards from discard to the bottom of the tavern", () => {
    const state = makeState({
      players: [makePlayer("p1", 0, [makeCard("h1", "hearts", 2, 2)])],
      currentEnemy: makeEnemy("clubs", 10, 20),
      discard: [makeCard("d1", "clubs", 4, 4), makeCard("d2", "diamonds", 5, 5)],
      tavern: [],
    });
    const next = applyMove(state, { type: "playSingle", playerId: "p1", cardId: "h1" });
    expect(next.tavern).toHaveLength(2);
    expect(next.discard).toHaveLength(0);
  });

  it("diamonds draw in turn order", () => {
    const state = makeState({
      players: [
        makePlayer("p1", 0, [makeCard("d1", "diamonds", 2, 2)]),
        makePlayer("p2", 1, []),
      ],
      currentEnemy: makeEnemy("clubs", 10, 20),
      tavern: [makeCard("t1", "hearts", 7, 7), makeCard("t2", "spades", 8, 8)],
    });
    const next = applyMove(state, { type: "playSingle", playerId: "p1", cardId: "d1" });
    expect(next.players[0].hand).toHaveLength(1);
    expect(next.players[1].hand).toHaveLength(1);
  });

  it("a matching suit nullifies the power", () => {
    const state = makeState({
      players: [makePlayer("p1", 0, [makeCard("h1", "hearts", 4, 4)])],
      currentEnemy: makeEnemy("hearts", 10, 20),
      discard: [makeCard("d1", "clubs", 4, 4), makeCard("d2", "diamonds", 5, 5)],
    });
    const next = applyMove(state, { type: "playSingle", playerId: "p1", cardId: "h1" });
    expect(next.tavern).toHaveLength(2);
  });
});

describe("special rules", () => {
  it("lets an ace pair with another card", () => {
    const state = makeState({
      players: [makePlayer("p1", 0, [makeCard("a1", "clubs", "A", 1), makeCard("n1", "spades", 6, 6)])],
      currentEnemy: makeEnemy("diamonds", 10, 20),
    });
    const next = applyMove(state, { type: "playAcePair", playerId: "p1", aceId: "a1", otherCardId: "n1" });
    expect(next.currentEnemy?.remainingHealth).toBe(6);
  });

  it("accepts same-rank combos up to 10", () => {
    const state = makeState({
      players: [makePlayer("p1", 0, [makeCard("n1", "clubs", 4, 4), makeCard("n2", "spades", 4, 4)])],
      currentEnemy: makeEnemy("diamonds", 10, 20),
    });
    const next = applyMove(state, { type: "playCombo", playerId: "p1", cardIds: ["n1", "n2"] });
    expect(next.currentEnemy?.remainingHealth).toBe(4);
  });

  it("lets a Jester cancel immunity and skip damage", () => {
    const state = makeState({
      players: [makePlayer("p1", 0, [makeCard("j1", "joker", "JOKER", 0)],), makePlayer("p2", 1, [])],
      currentEnemy: makeEnemy("spades", 10, 20),
    });
    const next = applyMove(state, { type: "playJester", playerId: "p1", cardId: "j1" });
    expect(next.phase).toBe("awaiting-next-player");
    expect(next.currentEnemy?.suitImmune).toBeNull();
    expect(next.turn.nextPlayerChoiceOpen).toBe(true);
  });

  it("stores exact-kill enemies in the discard pile", () => {
    const state = makeState({
      players: [makePlayer("p1", 0, [makeCard("k1", "clubs", 10, 10)])],
      currentEnemy: makeEnemy("diamonds", 10, 10),
    });
    const next = applyMove(state, { type: "playSingle", playerId: "p1", cardId: "k1" });
    expect(next.discard).toHaveLength(4);
    expect(next.discard.some((card) => card.suit === "diamonds" && card.rank === "J")).toBe(true);
    expect(next.phase).toBe("playing");
  });

  it("moves the full live table stack plus the defeated enemy to discard in order", () => {
    const oldDiscardA = makeCard("old-a", "hearts", 2, 2);
    const oldDiscardB = makeCard("old-b", "spades", 3, 3);
    const previousTableCard = makeCard("table-a", "diamonds", 4, 4);
    const played = makeCard("finisher", "clubs", 10, 10);
    const state = makeState({
      players: [makePlayer("p1", 0, [played])],
      currentEnemy: makeEnemy("clubs", 10, 10),
      discard: [oldDiscardA, oldDiscardB],
      table: [previousTableCard],
    });

    const next = applyMove(state, { type: "playSingle", playerId: "p1", cardId: "finisher" });

    expect(next.table).toHaveLength(0);
    expect(next.discard.map((card) => card.id)).toEqual(["old-a", "old-b", "table-a", "finisher", "enemy-clubs"]);
    expect(next.discard.at(-1)?.id).toBe("enemy-clubs");
  });

  it("forces damage discard when the enemy survives", () => {
    const state = makeState({
      players: [makePlayer("p1", 0, [makeCard("c1", "clubs", 3, 3), makeCard("x1", "spades", 5, 5), makeCard("x2", "hearts", 4, 4)])],
      currentEnemy: makeEnemy("diamonds", 8, 20),
    });
    const next = applyMove(state, { type: "playSingle", playerId: "p1", cardId: "c1" });
    expect(next.phase).toBe("awaiting-damage");
    expect(next.turn.pendingDamageAmount).toBe(8);
  });

  it("loses the game when the player cannot absorb the incoming damage", () => {
    const state = makeState({
      players: [makePlayer("p1", 0, [makeCard("c1", "clubs", 3, 3)]), makePlayer("p2", 1, [])],
      currentEnemy: makeEnemy("diamonds", 8, 20),
    });

    const next = applyMove(state, { type: "playSingle", playerId: "p1", cardId: "c1" });

    expect(next.phase).toBe("lost");
    expect(next.winner).toBe("enemies");
    expect(next.turn.pendingDamageAmount).toBe(0);
    expect(next.turn.pendingDamageForPlayerId).toBeNull();
    expect(next.lastEvent).toContain("cannot absorb 8 damage");
  });

  it("keeps cards on the table when the royal deals zero damage", () => {
    const state = makeState({
      players: [makePlayer("p1", 0, [makeCard("table-card", "clubs", 4, 4)]), makePlayer("p2", 1, [])],
      currentEnemy: {
        ...makeEnemy("spades", 8, 20),
        shield: 8,
      },
    });

    const next = applyMove(state, { type: "playSingle", playerId: "p1", cardId: "table-card" });

    expect(next.table.map((card) => card.id)).toEqual(["table-card"]);
    expect(next.discard.map((card) => card.id)).toEqual(["x1", "x2"]);
    expect(next.phase).toBe("playing");
    expect(next.activeSeat).toBe(1);
  });

  it("resolves damage discard with standard >= burning and advances to the next player", () => {
    const state = makeState({
      players: [
        makePlayer("p1", 0, [makeCard("x1", "spades", 5, 5), makeCard("x2", "hearts", 3, 3)]),
        makePlayer("p2", 1, []),
      ],
      phase: "awaiting-damage",
      currentEnemy: makeEnemy("diamonds", 8, 20),
      turn: {
        pendingDamageForPlayerId: "p1",
        pendingDamageAmount: 8,
        nextPlayerChoiceOpen: false,
        jesterChooserPlayerId: null,
        chosenNextPlayerId: null,
      },
      discard: [],
    });

    const next = applyMove(state, { type: "discardForDamage", playerId: "p1", cardIds: ["x1", "x2"] });

    expect(next.phase).toBe("playing");
    expect(next.activeSeat).toBe(1);
    expect(next.turn.pendingDamageAmount).toBe(0);
    expect(next.discard.map((card) => card.id)).toEqual(["x1", "x2"]);
  });

  it("allows damage burning to exceed the pending amount", () => {
    const state = makeState({
      players: [
        makePlayer("p1", 0, [makeCard("x1", "spades", 5, 5), makeCard("x2", "hearts", 4, 4)]),
        makePlayer("p2", 1, []),
      ],
      phase: "awaiting-damage",
      currentEnemy: makeEnemy("diamonds", 8, 20),
      turn: {
        pendingDamageForPlayerId: "p1",
        pendingDamageAmount: 8,
        nextPlayerChoiceOpen: false,
        jesterChooserPlayerId: null,
        chosenNextPlayerId: null,
      },
      discard: [],
    });

    const next = applyMove(state, { type: "discardForDamage", playerId: "p1", cardIds: ["x1", "x2"] });

    expect(next.phase).toBe("playing");
    expect(next.discard.map((card) => card.id)).toEqual(["x1", "x2"]);
  });

  it("lets the jester player choose the next teammate", () => {
    const state = makeState({
      phase: "awaiting-next-player",
      players: [makePlayer("p1", 0, []), makePlayer("p2", 1, []), makePlayer("p3", 2, [])],
      turn: {
        pendingDamageForPlayerId: null,
        pendingDamageAmount: 0,
        nextPlayerChoiceOpen: true,
        jesterChooserPlayerId: "p1",
        chosenNextPlayerId: null,
      },
    });

    const next = applyMove(state, { type: "chooseNextPlayer", playerId: "p1", nextPlayerId: "p3" });

    expect(next.phase).toBe("playing");
    expect(next.activeSeat).toBe(2);
    expect(next.turn.nextPlayerChoiceOpen).toBe(false);
    expect(next.turn.chosenNextPlayerId).toBe("p3");
  });

  it("allows ace pairs to exceed ten", () => {
    const state = makeState({
      players: [makePlayer("p1", 0, [makeCard("a1", "hearts", "A", 1), makeCard("x1", "spades", 10, 10)])],
      currentEnemy: makeEnemy("diamonds", 10, 20),
    });

    const next = applyMove(state, { type: "playAcePair", playerId: "p1", aceId: "a1", otherCardId: "x1" });

    expect(next.currentEnemy?.remainingHealth).toBe(9);
    expect(next.table.map((card) => card.id)).toEqual(["a1", "x1"]);
  });

  it("rejects ace combos with more than two cards", () => {
    const state = makeState({
      players: [
        makePlayer("p1", 0, [
          makeCard("a1", "clubs", "A", 1),
          makeCard("x1", "spades", 4, 4),
          makeCard("x2", "hearts", 4, 4),
        ]),
      ],
      currentEnemy: makeEnemy("diamonds", 10, 20),
    });

    expect(() => applyMove(state, { type: "playCombo", playerId: "p1", cardIds: ["a1", "x1", "x2"] })).toThrow(
      "An ace may only be paired with one other card.",
    );
  });

  it("rejects same-rank combos above ten", () => {
    const state = makeState({
      players: [makePlayer("p1", 0, [makeCard("n1", "clubs", 4, 4), makeCard("n2", "spades", 4, 4), makeCard("n3", "hearts", 4, 4)])],
      currentEnemy: makeEnemy("diamonds", 10, 20),
    });

    expect(() => applyMove(state, { type: "playCombo", playerId: "p1", cardIds: ["n1", "n2", "n3"] })).toThrow(
      "Combo total must be 10 or less.",
    );
  });
});
