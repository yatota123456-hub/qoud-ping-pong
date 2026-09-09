import { Room } from "@colyseus/core";
import { QoudState, PlayerState } from "./roomSchema";

type PaddleXY = { x: number; y: number; z: number };
type BallXY = { x: number; y: number; vx: number; vy: number; visible: boolean };

export class QoudRoom extends Room<QoudState> {
  maxClients = 4;
  worldW = 700;
  worldH = 1050;
  ballSpeed = 10;

  // ✅ بيانات اللعب خارج الـ Schema
  private ball: BallXY = { x: 0, y: 0, vx: 0, vy: 0, visible: true };
  private paddles: Record<string, PaddleXY> = {};
  private timeLeft = 0;
  private rally = 0;
  private countdown = 0;
  private countdownSide = '';
  private scorerSide = '';
  private broadcastAccum = 0;

  onCreate(options: any) {
    this.setState(new QoudState());
    this.state.code = options.code;
    this.state.settingsJson = JSON.stringify(options.settings || {});
    this.state.worldW = 700;
    this.state.worldH = 1050;
    this.state.maxPlayers = options.maxPlayers || 2;
    const s = options.settings || {};
    this.ballSpeed = s.ballSpeed ?? 10;
    const scale: any = { small: 0.8, medium: 1, large: 1.25, xlarge: 1.5 }[s.arenaSize] || 1;
    const base = (s.players || options.maxPlayers || 2) >= 3 ? { w: 1000, h: 1000 } : { w: 700, h: 1050 };
    this.worldW = base.w * scale;
    this.worldH = base.h * scale;
    this.state.worldW = this.worldW;
    this.state.worldH = this.worldH;
    this.ball.x = this.worldW / 2;
    this.ball.y = this.worldH / 2;
    this.ball.visible = true;

    ["bottom", "top", "left", "right"].forEach(side => {
      const p: PaddleXY = { x: 0, y: 0, z: 0 };
      if (side === "bottom") { p.x = this.worldW / 2; p.y = this.worldH - 60; p.z = this.worldH - 60; }
      if (side === "top") { p.x = this.worldW / 2; p.y = 60; p.z = 60; }
      if (side === "left") { p.x = 60; p.y = this.worldH / 2; p.z = this.worldH / 2; }
      if (side === "right") { p.x = this.worldW - 60; p.y = this.worldH / 2; p.z = this.worldH / 2; }
      this.paddles[side] = p;
    });

    if (options.computerPlayers?.length) {
      options.computerPlayers.forEach((bot: any, i: number) => {
        const ps = new PlayerState();
        ps.id = `bot-${i}`;
        ps.name = bot.name || `BOT ${i + 1}`;
        ps.color = bot.color || "#ff6b8b";
        ps.side = bot.side || ["top", "left", "right"][i] || "top";
        ps.computer = true;
        this.state.players.set(ps.id, ps);
        this.state.scores.set(ps.id, 0);
      });
    }

    this.onMessage("paddle-target", (client, data) => {
      const pl = this.state.players.get(client.sessionId);
      if (!pl) return;
      const pad = this.paddles[pl.side];
      if (!pad) return;
      pad.x = Math.max(45, Math.min(this.worldW - 45, data.x));
      const z = data.z ?? data.y;
      pad.y = Math.max(45, Math.min(this.worldH - 45, z));
      pad.z = pad.y;
    });

    this.onMessage("paddle-input", (client, data) => {
      const pl = this.state.players.get(client.sessionId);
      if (!pl) return;
      const pad = this.paddles[pl.side];
      if (!pad) return;
      const x = data.x ?? pad.x;
      const y = data.y ?? pad.y;
      pad.x = Math.max(45, Math.min(this.worldW - 45, x));
      pad.y = Math.max(45, Math.min(this.worldH - 45, y));
      pad.z = pad.y;
    });

    this.onMessage("request-serve", () => {
      if (this.ball.vx === 0 && this.ball.vy === 0) this.launchBall();
    });

    this.onMessage("start-game", () => {
      this.state.status = "playing";
      this.state.scores.forEach((_, k) => this.state.scores.set(k, 0));
      Array.from(this.state.players.values()).forEach(p => {
        if (!this.state.scores.has(p.id)) this.state.scores.set(p.id, 0);
      });
      this.timeLeft = JSON.parse(this.state.settingsJson || "{}").duration || 180;
      this.startCountdown();
      this.broadcast("game-started", {});
    });

    // ✅ محاكاة بـ 120Hz للدقة العالية
    this.setSimulationInterval((dt) => this.simulate(dt), 1000 / 120);

    // ✅ تحديث الوقت كل ثانية
    this.clock.setInterval(() => {
      if (this.state.status === "playing" && this.countdown === 0) {
        this.timeLeft--;
        if (this.timeLeft <= 0) this.finishByTime();
      }
    }, 1000);
  }

  startCountdown() {
    this.countdown = 3;
    this.clock.setTimeout(() => { this.countdown = 2; }, 1000);
    this.clock.setTimeout(() => { this.countdown = 1; }, 2000);
    this.clock.setTimeout(() => { this.countdown = 0; this.launchBall(); }, 3000);
  }

  launchBall() {
    const spd = 6 + this.ballSpeed * 0.5;
    const ang = (Math.random() - 0.5) * 0.8;
    const dirY = Math.random() > 0.5 ? 1 : -1;
    this.ball.vx = Math.sin(ang) * spd;
    this.ball.vy = Math.cos(ang) * spd * dirY;
  }

  simulate(dt: number) {
    if (this.state.status !== "playing" || this.countdown > 0) return;
    const b = this.ball;

    // حركة المضاربات الآلية
    this.state.players.forEach(pl => {
      if (!pl.computer) return;
      const pad = this.paddles[pl.side];
      if (!pad) return;
      const targetX = b.x + b.vx * 12;
      const targetY = b.y + b.vy * 12;
      if (pl.side === "bottom" || pl.side === "top") pad.x += (targetX - pad.x) * 0.08;
      else { pad.y += (targetY - pad.y) * 0.08; pad.z = pad.y; }
      pad.x = Math.max(45, Math.min(this.worldW - 45, pad.x));
      pad.y = Math.max(45, Math.min(this.worldH - 45, pad.y));
      pad.z = pad.y;
    });

    // ✅ Sub-stepping محسّن (maxStep من 20 إلى 10)
    const speed = Math.hypot(b.vx, b.vy);
    const maxStep = 10;  // تقليل من 20 → 10 للدقة الأعلى
    const steps = Math.max(1, Math.ceil(speed / maxStep));
    const stepVx = b.vx / steps;
    const stepVy = b.vy / steps;

    for (let i = 0; i < steps; i++) {
      b.x += stepVx;
      b.y += stepVy;

      // كشف التصادمات مع المضاربات
      for (const side of Object.keys(this.paddles)) {
        const pad = this.paddles[side];
        const dx = b.x - pad.x;
        const dy = b.y - (pad.z ?? pad.y);
        const dist = Math.hypot(dx, dy);
        
        if (dist < 44) {  // hitDist ≈ 40, مع هامش أمان
          const nx = dx / (dist || 1);
          const ny = dy / (dist || 1);
          b.x = pad.x + nx * 50;
          b.y = (pad.z ?? pad.y) + ny * 50;
          
          if (side === "bottom") b.vy = -Math.abs(b.vy) - 1;
          if (side === "top") b.vy = Math.abs(b.vy) + 1;
          if (side === "left") b.vx = Math.abs(b.vx) + 1;
          if (side === "right") b.vx = -Math.abs(b.vx) - 1;
          
          this.rally++;
          this.broadcast("hit-effect", { x: b.x, y: b.y, color: "#ffcf5a", power: 0.8 });
          break;  // كرة واحدة فقط لكل لحظة
        }
      }

      // كشف انعكاس الجدران
      const GOAL_W = 260;
      const GX1 = (this.worldW - GOAL_W) / 2;
      const GX2 = GX1 + GOAL_W;
      
      if (b.y < 22) {
        if (b.x >= GX1 && b.x <= GX2) {
          this.handleGoal("top");
          return;
        } else {
          b.y = 22;
          b.vy = Math.abs(b.vy);
        }
      }
      if (b.y > this.worldH - 22) {
        if (b.x >= GX1 && b.x <= GX2) {
          this.handleGoal("bottom");
          return;
        } else {
          b.y = this.worldH - 22;
          b.vy = -Math.abs(b.vy);
        }
      }
      if (b.x < 22) { b.x = 22; b.vx = Math.abs(b.vx); }
      if (b.x > this.worldW - 22) { b.x = this.worldW - 22; b.vx = -Math.abs(b.vx); }
    }

    // ✅ بث محسّن: 60Hz بدل 40Hz
    this.broadcastAccum += dt;
    if (this.broadcastAccum >= 1000 / 60) {  // زيادة من 40 → 60
      this.broadcastAccum = 0;
      this.broadcast("game-state", {
        ball: { x: b.x, y: b.y, vx: b.vx, vy: b.vy },
        paddles: Object.fromEntries(Object.entries(this.paddles).map(([side, pad]) => [side, { x: pad.x, y: pad.y, z: pad.z }])),
        countdown: this.countdown,
        countdownSide: this.countdownSide,
        rally: this.rally,
        scores: Object.fromEntries(this.state.scores.entries()),
        timeLeft: this.timeLeft,
      });
    }
  }

  handleGoal(missedSide: string) {
    const opposite: any = { bottom: "top", top: "bottom", left: "right", right: "left" };
    const scorerSide = opposite[missedSide];
    const scorer = Array.from(this.state.players.values()).find(p => p.side === scorerSide);
    if (scorer) this.state.scores.set(scorer.id, (this.state.scores.get(scorer.id) || 0) + 1);
    this.scorerSide = scorerSide || "";
    this.countdownSide = scorerSide || "";
    this.broadcast("goal-scored", { missedSide, scorerSide, scorerName: scorer?.name || scorerSide, scores: Object.fromEntries(this.state.scores.entries()) });
    const settings = JSON.parse(this.state.settingsJson || "{}");
    if (settings.mode === "goals") {
      const goal = settings.goal || 7;
      for (const [id, sc] of this.state.scores.entries()) {
        if (sc >= goal) { 
          this.broadcast("match-finished", { winnerId: id, scores: Object.fromEntries(this.state.scores.entries()) }); 
          this.state.status = "waiting"; 
          return; 
        }
      }
    }
    this.ball.x = this.worldW / 2;
    this.ball.y = this.worldH / 2;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.rally = 0;
    this.startCountdown();
  }

  finishByTime() {
    let winnerId = "";
    let max = -1;
    this.state.scores.forEach((sc, id) => {
      if (sc > max) { max = sc; winnerId = id; }
    });
    this.broadcast("match-finished", { winnerId, scores: Object.fromEntries(this.state.scores.entries()) });
    this.state.status = "waiting";
  }

  onJoin(client: any, options: any) {
    const p = new PlayerState();
    p.id = client.sessionId;
    p.name = options.name || `Player ${this.state.players.size + 1}`;
    p.color = ["#ffcf5a", "#ff6b8b", "#61e7c2", "#9b8cff"][this.state.players.size % 4];
    const sides = ["bottom", "top", "right", "left"];
    p.side = sides[this.state.players.size] || "bottom";
    this.state.players.set(client.sessionId, p);
    this.state.scores.set(client.sessionId, 0);
    if (this.state.players.size === 1) this.state.hostSessionId = client.sessionId;
  }

  onLeave(client: any) {
    this.state.players.delete(client.sessionId);
    this.state.scores.delete(client.sessionId);
    if (client.sessionId === this.state.hostSessionId) {
      const next = this.state.players.values().next().value as PlayerState;
      if (next) this.state.hostSessionId = next.id;
    }
  }
}