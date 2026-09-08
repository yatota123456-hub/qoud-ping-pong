import { Room, Client } from "@colyseus/core";
import { QoudState, PlayerState, Paddle, Ball } from "./roomSchema";

export class QoudRoom extends Room<QoudState> {
  maxClients = 4;
  worldW = 700;
  worldH = 1050;
  ballSpeed = 10;

  onCreate(options: any) {
    this.setState(new QoudState());
    this.state.code = options.code;
    this.state.settingsJson = JSON.stringify(options.settings || {});
    const s = options.settings || {};
    this.ballSpeed = s.ballSpeed ?? 10;
    const scale: any = { small: 0.8, medium: 1, large: 1.25, xlarge: 1.5 }[s.arenaSize] || 1;
    const base = (s.players || options.maxPlayers || 2) >= 3 ? { w: 1000, h: 1000 } : { w: 700, h: 1050 };
    this.worldW = base.w * scale;
    this.worldH = base.h * scale;
    this.state.ball.x = this.worldW / 2;
    this.state.ball.y = this.worldH / 2;

    ["bottom", "top", "left", "right"].forEach(side => {
      const p = new Paddle();
      if (side === "bottom") { p.x = this.worldW / 2; p.y = this.worldH - 60; p.z = this.worldH - 60; }
      if (side === "top") { p.x = this.worldW / 2; p.y = 60; p.z = 60; }
      if (side === "left") { p.x = 60; p.y = this.worldH / 2; p.z = this.worldH / 2; }
      if (side === "right") { p.x = this.worldW - 60; p.y = this.worldH / 2; p.z = this.worldH / 2; }
      this.state.paddles.set(side, p);
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
      const pad = this.state.paddles.get(pl.side);
      if (!pad) return;
      pad.x = Math.max(45, Math.min(this.worldW - 45, data.x));
      const z = data.z ?? data.y;
      pad.y = z;
      pad.z = z;
    });

    this.onMessage("request-serve", () => {
      if (this.state.ball.vx === 0 && this.state.ball.vy === 0) this.launchBall();
    });

    this.onMessage("start-game", () => {
      this.state.status = "playing";
      this.state.scores.forEach((_, k) => this.state.scores.set(k, 0));
      Array.from(this.state.players.values()).forEach(p => {
        if (!this.state.scores.has(p.id)) this.state.scores.set(p.id, 0);
      });
      this.state.timeLeft = JSON.parse(this.state.settingsJson || "{}").duration || 180;
      this.startCountdown();
      this.broadcast("game-started", {});
    });

    this.setSimulationInterval((dt) => this.simulate(dt), 1000 / 60);

    this.clock.setInterval(() => {
      if (this.state.status === "playing" && this.state.countdown === 0) {
        this.state.timeLeft--;
        if (this.state.timeLeft <= 0) this.finishByTime();
      }
    }, 1000);
  }

  startCountdown() {
    this.state.countdown = 3;
    this.clock.setTimeout(() => { this.state.countdown = 2; }, 1000);
    this.clock.setTimeout(() => { this.state.countdown = 1; }, 2000);
    this.clock.setTimeout(() => { this.state.countdown = 0; this.launchBall(); }, 3000);
  }

  launchBall() {
    const spd = 6 + this.ballSpeed * 0.5;
    const ang = (Math.random() - 0.5) * 0.8;
    const dirY = Math.random() > 0.5 ? 1 : -1;
    this.state.ball.vx = Math.sin(ang) * spd;
    this.state.ball.vy = Math.cos(ang) * spd * dirY;
  }

  simulate(dt: number) {
    if (this.state.status !== "playing" || this.state.countdown > 0) return;
    const b = this.state.ball;
    this.broadcast("game-state", {
        ball: {
          x: this.state.ball.x,
          y: this.state.ball.y,
          vx: this.state.ball.vx,
          vy: this.state.ball.vy,
        },
        paddles: Object.fromEntries(
          Array.from(this.state.paddles.entries()).map(([side, pad]) => [
            side,
            { x: pad.x, y: pad.y, z: pad.z }
          ])
        ),
        countdown: this.state.countdown,
        rally: this.state.rally,
        scores: Object.fromEntries(this.state.scores.entries()),
      });
    }
    // بوتات
    this.state.players.forEach(pl => {
      if (!pl.computer) return;
      const pad = this.state.paddles.get(pl.side);
      if (!pad) return;
      const targetX = b.x + b.vx * 12;
      const targetY = b.y + b.vy * 12;
      if (pl.side === "bottom" || pl.side === "top") pad.x += (targetX - pad.x) * 0.08;
      else pad.y += (targetY - pad.y) * 0.08, pad.z = pad.y;
      pad.x = Math.max(45, Math.min(this.worldW - 45, pad.x));
      pad.y = Math.max(45, Math.min(this.worldH - 45, pad.y));
      pad.z = pad.y;
    });

    b.x += b.vx;
    b.y += b.vy;

    this.state.paddles.forEach((pad, side) => {
      const dx = b.x - pad.x;
      const dy = b.y - (pad.z ?? pad.y);
      const dist = Math.hypot(dx, dy);
      if (dist < 44) {
        const nx = dx / (dist || 1), ny = dy / (dist || 1);
        b.x = pad.x + nx * 50;
        b.y = (pad.z ?? pad.y) + ny * 50;
        if (side === "bottom") b.vy = -Math.abs(b.vy) - 1;
        if (side === "top") b.vy = Math.abs(b.vy) + 1;
        if (side === "left") b.vx = Math.abs(b.vx) + 1;
        if (side === "right") b.vx = -Math.abs(b.vx) - 1;
        this.state.rally++;
        this.broadcast("hit-effect", { x: b.x, y: b.y, color: "#ffcf5a", power: 0.8 });
      }
    });

    const GOAL_W = 260, GX1 = (this.worldW - GOAL_W) / 2, GX2 = GX1 + GOAL_W;
    if (b.y < 22) { if (b.x >= GX1 && b.x <= GX2) this.handleGoal("top"); else { b.y = 22; b.vy = Math.abs(b.vy); } }
    if (b.y > this.worldH - 22) { if (b.x >= GX1 && b.x <= GX2) this.handleGoal("bottom"); else { b.y = this.worldH - 22; b.vy = -Math.abs(b.vy); } }
    if (b.x < 22) { b.x = 22; b.vx = Math.abs(b.vx); }
    if (b.x > this.worldW - 22) { b.x = this.worldW - 22; b.vx = -Math.abs(b.vx); }
  }

  handleGoal(missedSide: string) {
    const opposite: any = { bottom: "top", top: "bottom", left: "right", right: "left" };
    const scorerSide = opposite[missedSide];
    const scorer = Array.from(this.state.players.values()).find(p => p.side === scorerSide);
    if (scorer) this.state.scores.set(scorer.id, (this.state.scores.get(scorer.id) || 0) + 1);
    this.state.scorerSide = scorerSide || "";
    this.broadcast("goal-scored", { missedSide, scorerSide, scorerName: scorer?.name || scorerSide, scores: Object.fromEntries(this.state.scores.entries()) });
    const settings = JSON.parse(this.state.settingsJson || "{}");
    if (settings.mode === "goals") {
      const goal = settings.goal || 7;
      for (const [id, sc] of this.state.scores.entries()) {
        if (sc >= goal) { this.broadcast("match-finished", { winnerId: id, scores: Object.fromEntries(this.state.scores.entries()) }); this.state.status = "waiting"; return; }
      }
    }
    this.state.ball.x = this.worldW / 2; this.state.ball.y = this.worldH / 2;
    this.state.ball.vx = 0; this.state.ball.vy = 0; this.state.rally = 0;
    this.startCountdown();
  }

  finishByTime() {
    let winnerId = ""; let max = -1;
    this.state.scores.forEach((sc, id) => { if (sc > max) { max = sc; winnerId = id; } });
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
    if (client.sessionId === this.state.hostSessionId) {
      const next = this.state.players.values().next().value as PlayerState;
      if (next) this.state.hostSessionId = next.id;
    }
  }
}
