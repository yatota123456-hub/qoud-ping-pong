import { schema, t } from "@colyseus/schema";

export type PlayerSide = 'top' | 'right' | 'bottom' | 'left';

// ✅ BallState - تمثيل حالة الكرة
export const BallState = schema({
  x: t.number(),
  y: t.number(),
  vx: t.number(),
  vy: t.number(),
  visible: t.boolean(),
});

// ✅ PaddleState - تمثيل حالة المضرب
export const PaddleState = schema({
  x: t.number(),
  y: t.number(),
});

// PlayerState - تمثيل حالة اللاعب
export const PlayerState = schema({
  id: t.string(),
  name: t.string(),
  color: t.string(),
  side: t.string(),
  computer: t.boolean(),
});

// ✅ QoudRoomState - الحالة الرئيسية للغرفة
export const QoudRoomState = schema({
  code: t.string(),
  status: t.string(),
  hostSessionId: t.string(),
  settingsJson: t.string(),
  scores: t.map(t.number()),
  players: t.map(PlayerState),
  
  // ✅ إضافة الحالات المطلوبة
  worldW: t.number(),
  worldH: t.number(),
  maxPlayers: t.number(),
  
  // الكرة والمضاربات
  ball: BallState,
  paddles: t.map(PaddleState),
  
  // حالة اللعبة
  countdown: t.number(),
  countdownSide: t.string(),
  rally: t.number(),
  timeLeft: t.number(),
});

// للتوافق مع الكود القديم
export const QoudState = QoudRoomState;
export { QoudRoomState as QoudStateClass };