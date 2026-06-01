// Headless smoke test: stubs just enough of the browser (DOM, Canvas2D, RAF,
// localStorage, performance) to boot the real app and drive whole matches
// through the genuine physics/AI/scoring/reward code. Catches runtime errors
// and logic crashes without a browser.  Run: node tools/smoke.mjs
let T = 1000;            // virtual clock (ms)
let rafCb = null;

const gradient = { addColorStop() {} };
const ctxStub = new Proxy(
  { createLinearGradient: () => gradient, createRadialGradient: () => gradient },
  { get(t, p) { return p in t ? t[p] : () => {}; }, set(t, p, v) { t[p] = v; return true; } }
);

const elCache = new Map();
function makeEl(id = '', tag = 'div') {
  const el = {
    id, tagName: tag, scrollTop: 0, _html: '', _text: '', _attrs: {},
    classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      toggle(c, f) { const has = this._s.has(c); const on = f === undefined ? !has : f; on ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    style: {},
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
    set textContent(v) { this._text = v; }, get textContent() { return this._text; },
    set value(v) { this._value = v; }, get value() { return this._value ?? ''; },
    addEventListener() {}, removeEventListener() {},
    appendChild(c) { return c; }, removeChild() {}, remove() {},
    setAttribute(k, v) { this._attrs[k] = v; }, getAttribute(k) { return this._attrs[k] ?? null; },
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
    getBoundingClientRect() { return { width: 390, height: 780, left: 0, top: 0, right: 390, bottom: 780 }; },
    setPointerCapture() {}, focus() {},
  };
  if (id === 'board') el.getContext = () => ctxStub;
  return el;
}

const setGlobal = (name, value) => Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });

const raf = (cb) => { rafCb = cb; return 1; };
const caf = () => { rafCb = null; };

setGlobal('localStorage', (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; })());
setGlobal('navigator', { vibrate() {} });
setGlobal('performance', { now: () => T });
setGlobal('requestAnimationFrame', raf);
setGlobal('cancelAnimationFrame', caf);
setGlobal('window', {
  devicePixelRatio: 2, AudioContext: undefined, webkitAudioContext: undefined,
  addEventListener() {}, removeEventListener() {},
  requestAnimationFrame: raf, cancelAnimationFrame: caf,
});
setGlobal('document', {
  readyState: 'complete', hidden: false,
  addEventListener() {}, removeEventListener() {},
  getElementById(id) { if (!elCache.has(id)) elCache.set(id, makeEl(id)); return elCache.get(id); },
  createElement(tag) { return makeEl('', tag); },
  body: makeEl('body'),
});

function drive(label, maxFrames = 4000, autoplay = true) {
  let frames = 0;
  while (rafCb && frames < maxFrames) {
    const g = ui.game;
    if (autoplay && g && g.pucks) {
      // Simulate a real finger: chase the nearest puck and strike it toward an
      // alternating top-goal corner (so it gets past a central defender),
      // approaching from the opposite side of the puck from the aim point.
      let puck = g.pucks[0];
      for (const p of g.pucks) {
        if (Math.hypot(p.x - g.mB.x, p.y - g.mB.y) < Math.hypot(puck.x - g.mB.x, puck.y - g.mB.y)) puck = p;
      }
      const aimX = (frames % 220 < 110) ? 370 : 630;
      const aimY = -60;
      const dx = puck.x - aimX, dy = puck.y - aimY;
      const len = Math.hypot(dx, dy) || 1;
      const off = g.mB.r + puck.r - 4;
      g.pointers.set(1, { x: puck.x + (dx / len) * off, y: puck.y + (dy / len) * off, side: 'bottom' });
      g.controls.bottom = 1;
    }
    const cb = rafCb; rafCb = null;
    T += 16.7;
    cb(T);
    frames++;
    if (ui.game && ui.game.state === 'over') break;
  }
  const g = ui.game;
  console.log(`  ${label}: ${frames} frames, state=${g ? g.state : 'n/a'}, score ${g ? g.scores.bottom + '-' + g.scores.top : '?'}`);
  return frames;
}

let ui, store, mm;
let pass = 0, fail = 0;
const check = (name, cond) => { cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.log(`  ✗ ${name}`)); };

try {
  ({ ui } = await import('../js/ui.js'));
  ({ store } = await import('../js/storage.js'));
  mm = await import('../js/matchmaking.js');
  await import('../js/main.js'); // boots ui.init()

  console.log('\n[1] Boot + menu navigation');
  check('home rendered', !!document.getElementById('screen-root').innerHTML.includes('Fruit Hockey'));
  for (const s of ['play', 'shop', 'ranks', 'profile', 'settings', 'howto', 'home']) ui.show(s);
  check('navigated all menus without error', true);

  console.log('\n[2] Shop purchase + equip');
  const coins0 = store.state.coins;
  ui.shopTab = 'mallet'; ui.show('shop');
  ui.buy('mallet', 'lime');
  check('coins deducted', store.state.coins === coins0 - 200);
  check('item owned', store.isOwned('mallet', 'lime'));
  check('item equipped', store.state.equipped.mallet === 'lime');

  console.log('\n[3] Single-player match — engine runs stably under physics');
  ui.startSingle('amateur');
  check('game created', !!ui.game);
  drive('singleplayer', 3000);
  check('engine in a valid state (no crash)', ['play', 'goal', 'countdown', 'over'].includes(ui.game.state));
  check('scores are sane numbers', ui.game.scores.bottom >= 0 && ui.game.scores.top >= 0);

  console.log('\n[4] Arcade: multi-fruit runs a FULL physics match to completion');
  ui.startArcade('multifruit');
  check('three pucks spawned', ui.game.pucks.length === 3);
  drive('multifruit', 8000);
  check('full-physics match reached "over"', ui.game && ui.game.state === 'over');
  check('goals were scored via real play', (ui.game.scores.bottom + ui.game.scores.top) >= 5);

  console.log('\n[5] Time attack timer + local 2-player wiring');
  ui.startArcade('timeattack');
  const t0 = ui.game.timeLeft;
  drive('timeattack', 600);
  check('time attack timer counts down', ui.game.timeLeft < t0);
  ui.startLocal();
  check('AI disabled in local mode', ui.game.ai === null && ui.game.config.topHuman === true);
  drive('local', 1500);
  ui._quitToMenu();
  check('quit to menu works', ui.game === null);

  console.log('\n[6] Ranked: scoring → end → reward pipeline (deterministic)');
  const opp = mm.generateOpponent({ ranked: true, myRp: store.state.rp });
  check('opponent matched near rank', Math.abs(opp.rp - store.state.rp) < 400);
  const rpBefore = store.state.rp, xpBefore = store.state.totalXp, coinsBefore = store.state.coins, playedBefore = store.state.stats.played;
  ui.show('vs', { opponent: opp, ranked: true, mode: 'ranked', label: 'Ranked' });
  ui._startVsNow();
  check('ranked game created', !!ui.game && ui.game.config.ranked === true);
  // Drive scoring through the genuine goal code path until the win condition.
  const target = ui.game.config.target;
  let guard = 0;
  while (ui.game.state !== 'over' && ui.game.scores.bottom < target && guard++ < 60) {
    ui.game._onGoal('bottom', ui.game.pucks[0]);
  }
  check('ranked match ended on win condition', ui.game && ui.game.state === 'over');
  check('RP increased on win', store.state.rp > rpBefore);
  check('XP awarded', store.state.totalXp > xpBefore);
  check('coins awarded', store.state.coins > coinsBefore);
  check('match recorded in stats', store.state.stats.played === playedBefore + 1);

  console.log('\n[7] Rank + level math sanity');
  const { rankForRp, levelFromXp } = await import('../js/data.js');
  check('rp 0 → Bronze III', rankForRp(0).label === 'Bronze III');
  check('rp 600 → Gold III', rankForRp(600).label === 'Gold III');
  check('rp 1850 → Grandmaster', rankForRp(1850).label === 'Grandmaster');
  check('xp 0 → level 1', levelFromXp(0).level === 1);
  check('xp 100 → level 2', levelFromXp(100).level === 2);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
} catch (e) {
  console.error('\n💥 Uncaught error during smoke test:\n', e);
  process.exit(2);
}
