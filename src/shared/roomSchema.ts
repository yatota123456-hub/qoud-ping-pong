import { schema, t } from "@colyseus/schema";

// بدون decorators - يعمل مع TS5 و Node 24 بدون experimentalDecorators
export const Paddle = schema({
  x: t.number(),
  y: t.number(),
  z: t.number(),
});

export const Ball = schema({
  x: t.number(),
  y: t.number(),
  vx: t.number(),
  vy: t.number(),
});

export const PlayerState = schema({
  id: t.string(),
  name: t.string(),
  color: t.string(),
  side: t.string(),
  computer: t.boolean(),
});

export const QoudState = schema({
  code: t.string(),
  status: t.string(),
  hostSessionId: t.string(),
  settingsJson: t.string(),
  players: t.map(PlayerState),
  paddles: t.map(Paddle),
  scores: t.map(t.number()),
  ball: Ball,
  timeLeft: t.number(),
  rally: t.number(),
  countdown: t.number(),
  scorerSide: t.string(),
  countdownSide: t.string(),
});

// Aliases للتوافق مع QoudRoom.ts القديم
export const PaddleState = Paddle;
export const BallState = Ball;
export const QoudRoomState = QoudState;
export { QoudState as QoudStateClass };
