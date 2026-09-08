import { schema, t, type SchemaType } from '@colyseus/schema';

export type PlayerSide = 'top' | 'right' | 'bottom' | 'left';

export const PlayerState = schema({
  id: t.string(),
  name: t.string(),
  color: t.string(),
  side: t.string(),
  computer: t.boolean(),
}, 'PlayerState');
export type PlayerState = SchemaType<typeof PlayerState>;

// كرة اللعبة — يديرها السيرفر فقط
export const BallState = schema({
  x: t.number().default(0),
  y: t.number().default(0),
  vx: t.number().default(0),
  vy: t.number().default(0),
  visible: t.boolean().default(true),
}, 'BallState');
export type BallState = SchemaType<typeof BallState>;

// مضرب واحد — يديره السيرفر بناءً على مدخلات اللاعب أو الذكاء الاصطناعي
export const PaddleState = schema({
  x: t.number().default(0),
  y: t.number().default(0), // يمثل z في وضع 3D عند العميل
}, 'PaddleState');
export type PaddleState = SchemaType<typeof PaddleState>;

export const QoudRoomState = schema({
  code: t.string(),
  status: t.string(),
  maxPlayers: t.number(),
  hostSessionId: t.string(),
  settingsJson: t.string(),
  players: t.map(PlayerState),
  scores: t.map('number'),

  // --- حقول الفيزياء الجديدة (يديرها السيرفر حصريًا) ---
  worldW: t.number().default(700),
  worldH: t.number().default(1050),
  ball: BallState,
  paddles: t.map(PaddleState),
  countdown: t.number().default(0),
  countdownSide: t.string().default(''),
  rally: t.number().default(0),
  timeLeft: t.number().default(0),
}, 'QoudRoomState');
export type QoudRoomState = SchemaType<typeof QoudRoomState>;