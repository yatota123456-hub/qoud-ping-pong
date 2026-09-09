import { schema, t } from "@colyseus/schema";

export type PlayerSide = 'top' | 'right' | 'bottom' | 'left';

export const BallState = schema({
  x: t.number(),
  y: t.number(),
  vx: t.number(),
  vy: t.number(),
  visible: t.boolean(),
});

export const PaddleState = schema({
  x: t.number(),
  y: t.number(),
});

export const PlayerState = schema({
  id: t.string(),
  name: t.string(),
  color: t.string(),
  side: t.string(),
  computer: t.boolean(),
});

export const QoudRoomState = schema({
  code: t.string(),
  status: t.string(),
  hostSessionId: t.string(),
  settingsJson: t.string(),
  scores: t.map("number"),
  players: t.map(PlayerState),
  
  worldW: t.number(),
  worldH: t.number(),
  maxPlayers: t.number(),
  
  ball: BallState,
  paddles: t.map(PaddleState),
  
  countdown: t.number(),
  countdownSide: t.string(),
  rally: t.number(),
  timeLeft: t.number(),

  // === NEW: Series system ===
  currentRound: t.number(),
  totalRounds: t.number(),
  seriesType: t.string(),
  seriesWins: t.map("number"),
  roundHistoryJson: t.string(), // store JSON string of roundHistory
});

export const QoudState = QoudRoomState;
export { QoudRoomState as QoudStateClass };
