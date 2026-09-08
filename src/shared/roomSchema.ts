import { schema, t } from "@colyseus/schema";

export type PlayerSide = 'top' | 'right' | 'bottom' | 'left';

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
  visible: t.boolean(),   // <-- تمت الإضافة
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
  scores: t.map("number"),               // يبقى كما هو
  players: t.map(PlayerState),           // <-- استخدم الفئة مباشرة
  paddles: t.map(Paddle),                // <-- استخدم الفئة مباشرة
  ball: Ball,
  timeLeft: t.number(),
  rally: t.number(),
  countdown: t.number(),
  scorerSide: t.string(),
  countdownSide: t.string(),
  worldW: t.number(),
  worldH: t.number(),
  maxPlayers: t.number(),
});

// Aliases للتوافق مع QoudRoom.ts القديم
export const PaddleState = Paddle;
export const BallState = Ball;
export const QoudRoomState = QoudState;
export { QoudState as QoudStateClass };