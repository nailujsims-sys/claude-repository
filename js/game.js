// ============================================================================
// Fruit Hockey — Game engine
// ----------------------------------------------------------------------------
// A fixed-timestep air-hockey engine rendered on a 2D canvas. Handles input
// (multi-touch + mouse), puck/mallet physics, goals, AI, particles, screen
// shake and all the juicy feedback. The UI layer creates a Game, listens to
// callbacks for score/timer/end, and calls pause()/resume()/destroy().
// ============================================================================
import { getFruit, getMallet, getTable, getDifficulty } from './data.js';
import { createAI } from './ai.js';
import { audio } from './audio.js';

// --- Virtual field constants (everything scales from these) -----------------
const W = 1000;            // virtual field width
const WALL = 26;           // rim thickness
const GOAL_W = 360;        // goal mouth width
const POST_R = 9;          // goal post radius
const STEP = 1 / 120;      // fixed physics timestep
const PUCK_MAX = 2600;     // base puck speed cap (×fruit.maxSpeed)
const HUMAN_MAX = 5400;    // how fast a human mallet may travel
const AI_MAX = 3600;       // base AI mallet speed (×difficulty.speed)
const SERVE_SPEED = 620;

const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

export class Game {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cb = config.callbacks || {};

    // Resolve content from ids.
    this.fruit = getFruit(config.fruitId);
    this.table = getTable(config.tableId);
    this.malletSkin = getMallet(config.malletId);
    this.oppSkin = getMallet(config.opponentMalletId || 'ocean');

    this.config = Object.assign({
      mode: 'singleplayer', ranked: false,
      target: 7, timeLimit: null, lives: 5, puckCount: 1,
      topHuman: false,
      player: { name: 'You', avatar: '🍓' },
      opponent: { name: 'CPU', avatar: '🤖', difficultyId: 'amateur' },
    }, config);

    this.diff = getDifficulty(this.config.opponent.difficultyId);
    this.ai = this.config.topHuman ? null : createAI({ ...this.diff });

    this.scores = { bottom: 0, top: 0 };
    this._stallT = 0;
    this.state = 'idle';
    this.running = false;
    this.pointers = new Map();           // pointerId -> {x,y,side}
    this.controls = { bottom: null, top: null };
    this.effects = [];                    // particles
    this.shake = 0; this.shakeX = 0; this.shakeY = 0;
    this.goalFlash = 0; this.goalFlashSide = null;
    this.spinAccum = 0;

    this._onResize = () => this._resize();
    this._onVisibility = () => { if (document.hidden && this.state === 'play') this.pause(); };
    this._bound = [];
  }

  // --- Lifecycle ------------------------------------------------------------
  start() {
    this._resize();
    this._setupInput();
    window.addEventListener('resize', this._onResize);
    document.addEventListener('visibilitychange', this._onVisibility);

    this._spawnPucks(W / 2, this.H / 2);
    this.startTime = performance.now();
    this.timeLeft = this.config.timeLimit;
    this._beginCountdown(3.15, this._randomSide());
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    this._raf = requestAnimationFrame((t) => this._loop(t));
  }

  destroy() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisibility);
    for (const [t, fn] of this._bound) this.canvas.removeEventListener(t, fn);
    this._bound = [];
  }

  pause() {
    if (this.state === 'over' || this.state === 'paused') return;
    this._resumeState = this.state;
    this.state = 'paused';
    this.cb.onStateChange?.('paused');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this._resumeState || 'countdown';
    this.last = performance.now();
    this.acc = 0;
    this.cb.onStateChange?.(this.state);
  }

  // --- Sizing ---------------------------------------------------------------
  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.dpr = dpr; this.cssW = cssW; this.cssH = cssH;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.scale = cssW / W;
    const newH = cssH / this.scale;

    if (this.H && this.mB) {
      // Preserve relative vertical positions across a resize/rotation.
      const k = newH / this.H;
      for (const p of this.pucks) p.y *= k;
      this.mB.y *= k; this.mT.y *= k;
    }
    this.H = newH;
    this.centerY = this.H / 2;
    this.goalLeft = (W - GOAL_W) / 2;
    this.goalRight = (W + GOAL_W) / 2;

    if (!this.mB) {
      const mr = 74;
      this.mB = { x: W / 2, y: this.H - WALL - mr - 60, vx: 0, vy: 0, r: mr };
      this.mT = { x: W / 2, y: WALL + mr + 60, vx: 0, vy: 0, r: mr };
    }
  }

  get regionB() { return { minX: WALL + this.mB.r, maxX: W - WALL - this.mB.r, minY: this.centerY, maxY: this.H - WALL - this.mB.r }; }
  get regionT() { return { minX: WALL + this.mT.r, maxX: W - WALL - this.mT.r, minY: WALL + this.mT.r, maxY: this.centerY }; }

  // --- Pucks ----------------------------------------------------------------
  _spawnPucks(cx, cy) {
    const n = this.config.puckCount;
    this.pucks = [];
    const spread = 150;
    for (let i = 0; i < n; i++) {
      const offset = n === 1 ? 0 : (i - (n - 1) / 2) * spread;
      this.pucks.push({ x: cx + offset, y: cy, vx: 0, vy: 0, r: this.fruit.r, fruit: this.fruit, spin: 0, spinV: 0 });
    }
  }

  _randomSide() { return Math.random() < 0.5 ? 'bottom' : 'top'; }

  _beginCountdown(seconds, serveToward) {
    this.state = 'countdown';
    this.countdown = seconds;
    this._lastCount = Math.ceil(seconds);
    this._serveToward = serveToward;
    // Park pucks at centre with no motion during the countdown.
    this._spawnPucks(W / 2, this.centerY);
    this.cb.onCountdown?.(Math.ceil(seconds));
  }

  _serve(toward, silent = false) {
    for (const p of this.pucks) {
      const dir = toward === 'bottom' ? 1 : -1;
      const ang = (Math.random() * 0.5 - 0.25); // small horizontal spread
      p.vx = Math.sin(ang) * SERVE_SPEED;
      p.vy = dir * Math.cos(ang) * SERVE_SPEED;
    }
    this._stallT = 0;
    if (!silent) audio.sfx('serve');
  }

  // --- Main loop ------------------------------------------------------------
  _loop(ts) {
    if (!this.running) return;
    let dt = (ts - this.last) / 1000;
    this.last = ts;
    if (dt > 0.05) dt = 0.05; // avoid spiral after tab switch

    this._updateEffects(dt);

    if (this.state === 'countdown') {
      this._trackMallets(dt);
      this.countdown -= dt;
      const c = Math.ceil(this.countdown);
      if (c < this._lastCount && c >= 1) { audio.sfx('count'); this.cb.onCountdown?.(c); this._lastCount = c; }
      if (this.countdown <= 0) {
        this.state = 'play';
        this.acc = 0;
        this.cb.onCountdown?.(0);
        this._serve(this._serveToward);
        this.cb.onStateChange?.('play');
      }
    } else if (this.state === 'play') {
      this.acc += dt;
      let guard = 0;
      // Stop stepping the instant a goal/end changes state, so a single goal
      // can't be counted twice from leftover accumulated time this frame.
      while (this.acc >= STEP && guard < 10 && this.state === 'play') { this._stepPhysics(STEP); this.acc -= STEP; guard++; }
      if (this.timeLeft != null) {
        this.timeLeft -= dt;
        this.cb.onTimer?.(Math.max(0, this.timeLeft));
        if (this.timeLeft <= 0) { this._endMatch('time'); }
      }
    } else if (this.state === 'goal') {
      this._trackMallets(dt);
      this.goalTimer -= dt;
      if (this.goalTimer <= 0) this._beginCountdown(2.1, this._serveToward);
    }

    this.render();
    this._raf = requestAnimationFrame((t) => this._loop(t));
  }

  // --- Input ----------------------------------------------------------------
  _setupInput() {
    const add = (type, fn) => { this.canvas.addEventListener(type, fn, { passive: false }); this._bound.push([type, fn]); };
    const down = (e) => {
      e.preventDefault();
      audio.ensure();
      try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* keeps tracking past edges */ }
      for (const pt of this._extract(e)) {
        const side = this.config.topHuman ? (pt.vy < this.centerY ? 'top' : 'bottom') : 'bottom';
        this.pointers.set(pt.id, { x: pt.vx, y: pt.vy, side });
        this.controls[side] = pt.id; // latest finger wins control of that side
      }
    };
    const move = (e) => {
      e.preventDefault();
      for (const pt of this._extract(e)) {
        const rec = this.pointers.get(pt.id);
        if (rec) { rec.x = pt.vx; rec.y = pt.vy; }
      }
    };
    const up = (e) => {
      e.preventDefault();
      for (const pt of this._extract(e)) {
        const rec = this.pointers.get(pt.id);
        if (rec && this.controls[rec.side] === pt.id) this.controls[rec.side] = null;
        this.pointers.delete(pt.id);
      }
    };
    add('pointerdown', down); add('pointermove', move);
    add('pointerup', up); add('pointercancel', up); add('pointerleave', up);
  }

  _extract(e) {
    const rect = this.canvas.getBoundingClientRect();
    const list = e.getCoalescedEvents ? [e] : [e];
    return list.map(ev => ({
      id: ev.pointerId ?? 0,
      vx: (ev.clientX - rect.left) / rect.width * W,
      vy: (ev.clientY - rect.top) / rect.height * this.H,
    }));
  }

  _targetFor(side) {
    const id = this.controls[side];
    if (id != null && this.pointers.has(id)) {
      const p = this.pointers.get(id);
      return { x: p.x, y: p.y };
    }
    const m = side === 'bottom' ? this.mB : this.mT;
    return { x: m.x, y: m.y };
  }

  // --- Physics --------------------------------------------------------------
  _trackMallets(dt) {
    this._moveMallet(this.mB, this._targetFor('bottom'), HUMAN_MAX, dt, this.regionB);
    if (this.config.topHuman) this._moveMallet(this.mT, this._targetFor('top'), HUMAN_MAX, dt, this.regionT);
  }

  _stepPhysics(dt) {
    // Mallets
    this._moveMallet(this.mB, this._targetFor('bottom'), HUMAN_MAX, dt, this.regionB);
    if (this.config.topHuman) {
      this._moveMallet(this.mT, this._targetFor('top'), HUMAN_MAX, dt, this.regionT);
    } else {
      const threat = this._threatPuck();
      const aiTarget = this.ai.update({
        puck: threat, mallet: this.mT, region: this.regionT,
        goalY: WALL, attackDir: 1, centerY: this.centerY,
      }, dt);
      this._moveMallet(this.mT, aiTarget, AI_MAX * this.ai.config.speed, dt, this.regionT);
    }

    // Pucks
    const cap = PUCK_MAX * this.fruit.maxSpeed;
    for (const p of this.pucks) {
      const g = Math.pow(this.fruit.glide, dt);
      p.vx *= g; p.vy *= g;
      this._capSpeed(p, cap);
      const speed = Math.hypot(p.vx, p.vy);
      const steps = Math.min(8, Math.max(1, Math.ceil(speed * dt / (p.r * 0.6))));
      const sdt = dt / steps;
      for (let s = 0; s < steps; s++) {
        p.x += p.vx * sdt; p.y += p.vy * sdt;
        this._collideWalls(p);
        this._collidePosts(p);
        this._collideMallet(p, this.mB);
        this._collideMallet(p, this.mT);
        this._capSpeed(p, cap);
      }
      p.spin += (p.spinV + p.vx * 0.0009) * dt;
      p.spinV *= 0.95;
      if (Math.hypot(p.vx, p.vy) < 6) { p.vx = 0; p.vy = 0; }
    }

    // Anti-stall: if every puck has gone dead for a few seconds (e.g. stopped
    // mid-table out of reach), the "ref" nudges play back into life.
    let maxSpeed = 0;
    for (const p of this.pucks) maxSpeed = Math.max(maxSpeed, Math.hypot(p.vx, p.vy));
    if (maxSpeed < 80) this._stallT += dt; else this._stallT = 0;
    if (this._stallT > 3) this._serve(Math.random() < 0.5 ? 'bottom' : 'top', true);

    this._checkGoals();
  }

  _capSpeed(p, cap) {
    const s = Math.hypot(p.vx, p.vy);
    if (s > cap) { const k = cap / s; p.vx *= k; p.vy *= k; }
  }

  _threatPuck() {
    // The puck most relevant to the AI: the one nearest its own (top) goal.
    let best = this.pucks[0];
    for (const p of this.pucks) if (p.y < best.y) best = p;
    return best;
  }

  _moveMallet(m, target, maxSpeed, dt, region) {
    const tx = clamp(target.x, region.minX, region.maxX);
    const ty = clamp(target.y, region.minY, region.maxY);
    let dx = tx - m.x, dy = ty - m.y;
    const d = Math.hypot(dx, dy);
    const maxStep = maxSpeed * dt;
    if (d > maxStep && d > 0) { dx *= maxStep / d; dy *= maxStep / d; }
    const nx = clamp(m.x + dx, region.minX, region.maxX);
    const ny = clamp(m.y + dy, region.minY, region.maxY);
    m.vx = (nx - m.x) / dt; m.vy = (ny - m.y) / dt;
    m.x = nx; m.y = ny;
  }

  _collideWalls(p) {
    const b = this.fruit.bounce;
    if (p.x < WALL + p.r) { p.x = WALL + p.r; p.vx = Math.abs(p.vx) * b; this._wallHit(p); }
    else if (p.x > W - WALL - p.r) { p.x = W - WALL - p.r; p.vx = -Math.abs(p.vx) * b; this._wallHit(p); }

    const inMouth = p.x > this.goalLeft && p.x < this.goalRight;
    if (!inMouth) {
      if (p.y < WALL + p.r) { p.y = WALL + p.r; p.vy = Math.abs(p.vy) * b; this._wallHit(p); }
      else if (p.y > this.H - WALL - p.r) { p.y = this.H - WALL - p.r; p.vy = -Math.abs(p.vy) * b; this._wallHit(p); }
    }
  }

  _wallHit(p) {
    const s = Math.min(1, Math.hypot(p.vx, p.vy) / 1400);
    if (s > 0.06) { audio.sfx('hitWall', { speed: s }); if (s > 0.5) audio.vibrate(8); }
  }

  _collidePosts(p) {
    const posts = [
      [this.goalLeft, WALL], [this.goalRight, WALL],
      [this.goalLeft, this.H - WALL], [this.goalRight, this.H - WALL],
    ];
    for (const [px, py] of posts) {
      const dx = p.x - px, dy = p.y - py;
      const dist = Math.hypot(dx, dy);
      const minD = p.r + POST_R;
      if (dist < minD && dist > 0) {
        const nx = dx / dist, ny = dy / dist;
        p.x = px + nx * minD; p.y = py + ny * minD;
        const vn = p.vx * nx + p.vy * ny;
        p.vx -= (1 + this.fruit.bounce) * vn * nx;
        p.vy -= (1 + this.fruit.bounce) * vn * ny;
        this._wallHit(p);
      }
    }
  }

  _collideMallet(p, m) {
    const dx = p.x - m.x, dy = p.y - m.y;
    const dist = Math.hypot(dx, dy);
    const minD = p.r + m.r;
    if (dist >= minD || dist === 0) return;
    const nx = dx / dist, ny = dy / dist;
    p.x = m.x + nx * minD; p.y = m.y + ny * minD;
    const rvx = p.vx - m.vx, rvy = p.vy - m.vy;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      let j = -(1 + this.fruit.bounce) * vn * this.fruit.push;
      p.vx += j * nx; p.vy += j * ny;
      p.spinV += (rvx * -ny + rvy * nx) * 0.0006;
      const impact = Math.min(1, Math.abs(vn) / 2600);
      if (impact > 0.55) { audio.sfx('smash'); audio.vibrate(18); }
      else audio.sfx('hitMallet', { speed: impact });
    }
  }

  _checkGoals() {
    for (const p of this.pucks) {
      const inMouth = p.x > this.goalLeft && p.x < this.goalRight;
      if (!inMouth) continue;
      if (p.y < WALL) { this._onGoal('bottom', p); return; }       // entered top goal
      if (p.y > this.H - WALL) { this._onGoal('top', p); return; } // entered bottom goal
    }
  }

  _onGoal(scoringSide, puck) {
    this.scores[scoringSide]++;
    const color = this.table.accent;
    this._spawnParticles(puck.x, puck.y, 26);
    this.shake = 16;
    this.goalFlash = 0.6; this.goalFlashSide = scoringSide;
    audio.sfx('goal'); audio.vibrate([0, 40, 30, 60]);

    // Survival: opponent gets tougher each time you score.
    if (this.config.mode === 'survival' && scoringSide === 'bottom' && this.ai) {
      this.ai.config.speed = Math.min(1.35, this.ai.config.speed + 0.05);
      this.ai.config.reaction = Math.max(0.04, this.ai.config.reaction - 0.01);
    }

    const livesLeft = this.config.mode === 'survival' ? Math.max(0, this.config.lives - this.scores.top) : null;
    this.cb.onScore?.({ bottom: this.scores.bottom, top: this.scores.top, livesLeft });
    this.cb.onGoal?.(scoringSide);

    this._serveToward = scoringSide === 'bottom' ? 'top' : 'bottom';

    if (this._isOver(scoringSide)) { this._endMatch('score'); return; }
    this.state = 'goal';
    this.goalTimer = 1.25;
  }

  _isOver() {
    const c = this.config;
    if (c.mode === 'timeattack') return false;
    if (c.mode === 'survival') return this.scores.top >= c.lives;
    return this.scores.bottom >= c.target || this.scores.top >= c.target;
  }

  _endMatch(reason) {
    if (this.state === 'over') return;
    this.state = 'over';
    const { bottom, top } = this.scores;
    const winnerSide = bottom > top ? 'bottom' : bottom < top ? 'top' : 'draw';
    let win;
    if (this.config.mode === 'timeattack') win = true;
    else if (this.config.mode === 'survival') win = false;
    else win = bottom > top;
    const result = {
      mode: this.config.mode, ranked: this.config.ranked,
      scoreBottom: bottom, scoreTop: top, winnerSide, win, reason,
      durationSec: (performance.now() - this.startTime) / 1000,
      fruitId: this.fruit.id, difficultyId: this.config.opponent.difficultyId,
      opponent: this.config.opponent,
      survivalScore: bottom,
    };
    audio.sfx(win || this.config.mode === 'timeattack' ? 'win' : 'lose');
    audio.vibrate(win ? [0, 60, 40, 80, 40, 120] : [0, 200]);
    this.cb.onStateChange?.('over');
    this.cb.onEnd?.(result);
  }

  // --- Effects --------------------------------------------------------------
  _spawnParticles(x, y, n) {
    const palette = [this.table.accent, this.fruit ? '#fff' : '#fff', this.table.line, this.malletSkin.a];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 200 + Math.random() * 700;
      this.effects.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.6 + Math.random() * 0.5, t: 0,
        r: 6 + Math.random() * 12, color: palette[i % palette.length],
      });
    }
  }

  _updateEffects(dt) {
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 60);
      this.shakeX = (Math.random() * 2 - 1) * this.shake;
      this.shakeY = (Math.random() * 2 - 1) * this.shake;
    } else { this.shakeX = this.shakeY = 0; }
    if (this.goalFlash > 0) this.goalFlash = Math.max(0, this.goalFlash - dt);
    for (const e of this.effects) {
      e.t += dt;
      e.vy += 900 * dt; // gravity makes juice droplets arc
      e.x += e.vx * dt; e.y += e.vy * dt;
      e.vx *= 0.98;
    }
    this.effects = this.effects.filter(e => e.t < e.life);
  }

  // --- Rendering ------------------------------------------------------------
  render() {
    const ctx = this.ctx;
    ctx.setTransform(this.scale * this.dpr, 0, 0, this.scale * this.dpr, 0, 0);
    ctx.translate(this.shakeX, this.shakeY);
    ctx.clearRect(-40, -40, W + 80, this.H + 80);

    this._drawTable(ctx);
    this._drawEffects(ctx);
    for (const p of this.pucks) this._drawPuck(ctx, p);
    this._drawMallet(ctx, this.mT, this.oppSkin, true);
    this._drawMallet(ctx, this.mB, this.malletSkin, false);
    this._drawGoalFlash(ctx);
    if (this.state === 'countdown') this._drawCountdown(ctx);
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  _drawTable(ctx) {
    const t = this.table, H = this.H;
    // Felt
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, t.felt); grad.addColorStop(1, t.felt2);
    ctx.fillStyle = grad;
    this._roundRect(ctx, 0, 0, W, H, 40); ctx.fill();

    if (t.rainbow) {
      const rg = ctx.createLinearGradient(0, 0, W, H);
      ['#ff6b6b', '#ffd93d', '#6bcB77', '#4d96ff', '#c780fa'].forEach((c, i, a) => rg.addColorStop(i / (a.length - 1), c));
      ctx.globalAlpha = 0.18; ctx.fillStyle = rg;
      this._roundRect(ctx, 0, 0, W, H, 40); ctx.fill(); ctx.globalAlpha = 1;
    }

    // Centre line + circle
    ctx.strokeStyle = t.line; ctx.globalAlpha = 0.6; ctx.lineWidth = 5;
    ctx.setLineDash([26, 22]);
    ctx.beginPath(); ctx.moveTo(WALL, this.centerY); ctx.lineTo(W - WALL, this.centerY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(W / 2, this.centerY, 130, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.arc(W / 2, this.centerY, 14, 0, Math.PI * 2); ctx.fillStyle = t.line; ctx.fill();

    // Goal creases
    ctx.globalAlpha = 0.5; ctx.lineWidth = 5;
    for (const gy of [WALL, H - WALL]) {
      const dir = gy < this.centerY ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(this.goalLeft, gy);
      ctx.lineTo(this.goalLeft, gy + dir * 120);
      ctx.arc(W / 2, gy + dir * 120, GOAL_W / 2, dir > 0 ? Math.PI : 0, dir > 0 ? 0 : Math.PI, dir < 0);
      ctx.lineTo(this.goalRight, gy);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Goal mouths (glowing accent gaps)
    ctx.fillStyle = t.accent;
    for (const gy of [0, H]) {
      ctx.save(); ctx.globalAlpha = 0.85;
      ctx.shadowColor = t.accent; ctx.shadowBlur = 30;
      const yy = gy === 0 ? 0 : H - WALL;
      ctx.fillRect(this.goalLeft, yy, GOAL_W, WALL);
      ctx.restore();
    }

    // Rim / border
    ctx.lineWidth = WALL; ctx.strokeStyle = t.border;
    ctx.lineJoin = 'round';
    // Draw border as 4 segments, leaving the goal mouths open.
    this._borderSegments(ctx);

    // Posts
    ctx.fillStyle = t.line;
    for (const [px, py] of [[this.goalLeft, WALL / 1], [this.goalRight, WALL], [this.goalLeft, H - WALL], [this.goalRight, H - WALL]]) {
      ctx.beginPath(); ctx.arc(px, py, POST_R, 0, Math.PI * 2); ctx.fill();
    }
  }

  _borderSegments(ctx) {
    const H = this.H, hw = WALL / 2;
    ctx.lineCap = 'round';
    const seg = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
    // sides
    seg(hw, hw, hw, H - hw);
    seg(W - hw, hw, W - hw, H - hw);
    // top (split by goal)
    seg(hw, hw, this.goalLeft, hw);
    seg(this.goalRight, hw, W - hw, hw);
    // bottom (split by goal)
    seg(hw, H - hw, this.goalLeft, H - hw);
    seg(this.goalRight, H - hw, W - hw, H - hw);
  }

  _drawPuck(ctx, p) {
    // shadow
    ctx.save();
    ctx.globalAlpha = 0.28; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(p.x + 6, p.y + 10, p.r * 0.95, p.r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // soft disc behind emoji for contrast
    ctx.save();
    ctx.globalAlpha = 0.16; ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 1.02, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.spin);
    ctx.font = `${p.r * 2.05}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p.fruit.emoji, 0, p.r * 0.06);
    ctx.restore();
  }

  _drawMallet(ctx, m, skin, isTop) {
    // shadow
    ctx.save();
    ctx.globalAlpha = 0.3; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(m.x + 6, m.y + 12, m.r, m.r * 0.85, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // base ring
    ctx.fillStyle = skin.ring;
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.fill();

    // body gradient
    const g = ctx.createRadialGradient(m.x - m.r * 0.3, m.y - m.r * 0.35, m.r * 0.2, m.x, m.y, m.r * 0.92);
    g.addColorStop(0, skin.a); g.addColorStop(1, skin.b);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r * 0.86, 0, Math.PI * 2); ctx.fill();

    // grip cap
    ctx.fillStyle = skin.cap;
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = skin.b; ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    // highlight
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.ellipse(m.x - m.r * 0.3, m.y - m.r * 0.38, m.r * 0.28, m.r * 0.16, -0.6, 0, Math.PI * 2); ctx.fill();
  }

  _drawEffects(ctx) {
    for (const e of this.effects) {
      const a = 1 - e.t / e.life;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = e.color;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (0.5 + a * 0.5), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  _drawGoalFlash(ctx) {
    if (this.goalFlash <= 0) return;
    const a = this.goalFlash / 0.6;
    ctx.save();
    ctx.globalAlpha = a * 0.5;
    ctx.fillStyle = this.table.accent;
    const top = this.goalFlashSide === 'top'; // someone scored on bottom goal
    const grad = ctx.createLinearGradient(0, top ? this.H : 0, 0, top ? this.H - 300 : 300);
    grad.addColorStop(0, this.table.accent); grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, top ? this.H - 300 : 0, W, 300);
    ctx.restore();
  }

  _drawCountdown(ctx) {
    const n = Math.ceil(this.countdown);
    if (n <= 0) return;
    const frac = this.countdown - Math.floor(this.countdown);
    const scale = 1 + (1 - frac) * 0.4;
    ctx.save();
    ctx.translate(W / 2, this.centerY);
    ctx.scale(scale, scale);
    ctx.globalAlpha = Math.min(1, frac * 2);
    ctx.font = '700 220px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillText(String(n), 6, 6);
    ctx.fillStyle = this.table.line;
    ctx.fillText(String(n), 0, 0);
    ctx.restore();
  }
}
