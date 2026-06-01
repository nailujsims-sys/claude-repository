// ============================================================================
// Fruit Hockey — AI opponent controller
// ----------------------------------------------------------------------------
// createAI(config) returns a controller whose update(ctx, dt) yields a target
// position for the AI's mallet. The game then eases the mallet toward it,
// capped at the mallet's max speed (so the AI obeys the same physics as you).
// ============================================================================

// Predict where the puck crosses a horizontal line at `targetY`, accounting for
// reflections off the side walls between [minX, maxX].
function predictX(x, vx, y, vy, targetY, minX, maxX) {
  if (Math.abs(vy) < 1) return x;
  const t = (targetY - y) / vy;
  if (t < 0 || t > 5) return x; // not heading there (or too far in the future)
  let px = x + vx * t;
  const span = Math.max(1, maxX - minX);
  let rel = px - minX;
  let m = ((rel % (2 * span)) + 2 * span) % (2 * span);
  if (m > span) m = 2 * span - m;
  return minX + m;
}

const lerp = (a, b, t) => a + (b - a) * t;

export function createAI(config) {
  return {
    config,
    reactTimer: 0,
    target: null,
    mode: 'idle',

    reset() { this.reactTimer = 0; this.target = null; this.mode = 'idle'; },

    // ctx: { puck, mallet, region:{minX,maxX,minY,maxY}, goalY, attackDir, centerY }
    update(ctx, dt) {
      const c = this.config;
      this.reactTimer -= dt;
      const { puck, mallet, region, goalY, attackDir } = ctx;

      if (this.reactTimer <= 0 || !this.target) {
        this.reactTimer = c.reaction * (0.8 + Math.random() * 0.5);
        this.target = this._decide(ctx);
      } else if (this.mode === 'defend') {
        // While defending, keep tracking the puck's x a little between decisions
        // so stronger AIs feel smooth rather than teleporting on each tick.
        const tracked = this._defendTarget(ctx);
        this.target.x = lerp(this.target.x, tracked.x, Math.min(1, dt * 8 * c.predict));
      }

      // Clamp target into the AI's allowed region.
      this.target.x = Math.max(region.minX, Math.min(region.maxX, this.target.x));
      this.target.y = Math.max(region.minY, Math.min(region.maxY, this.target.y));
      return this.target;
    },

    _defendTarget(ctx) {
      const c = this.config;
      const { puck, region, goalY, attackDir } = ctx;
      const defY = goalY + attackDir * (region.maxY - region.minY) * 0.32;
      const predicted = predictX(puck.x, puck.vx, puck.y, puck.vy, defY, region.minX, region.maxX);
      let x = lerp(puck.x, predicted, c.predict);
      x += (Math.random() * 2 - 1) * c.jitter;
      return { x, y: defY };
    },

    _decide(ctx) {
      const c = this.config;
      const { puck, mallet, region, goalY, attackDir, centerY } = ctx;
      const onMySide = attackDir > 0 ? puck.y < centerY : puck.y > centerY;
      const approaching = attackDir > 0 ? puck.vy < -2 : puck.vy > 2;
      const speed = Math.hypot(puck.vx, puck.vy);

      // 1) Puck threatening our goal → intercept on the defensive line.
      if (approaching || (onMySide && puck.y * attackDir < centerY * attackDir)) {
        this.mode = 'defend';
        return this._defendTarget(ctx);
      }

      // 2) Slow puck on our side → seize the chance to attack.
      const wantAttack = onMySide && speed < 900 && Math.random() < c.aggression;
      if (wantAttack) {
        this.mode = 'attack';
        // Approach the puck from behind so contact drives it toward their goal.
        return {
          x: puck.x + (Math.random() * 2 - 1) * (c.jitter * 0.4),
          y: puck.y - attackDir * (mallet.r * 0.4),
        };
      }

      // 3) Otherwise hold a smart home position, cutting the shooting angle.
      this.mode = 'idle';
      const homeY = goalY + attackDir * (region.maxY - region.minY) * 0.34;
      const homeX = lerp((region.minX + region.maxX) / 2, puck.x, 0.45);
      return { x: homeX, y: homeY };
    },
  };
}
