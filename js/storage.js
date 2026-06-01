// ============================================================================
// Fruit Hockey — Persistent player state (localStorage)
// ----------------------------------------------------------------------------
// A tiny store with a versioned save blob, mutators for coins / XP / ranks /
// unlocks, and a subscribe() mechanism so the UI can react to changes.
// ============================================================================
import { levelFromXp } from './data.js';

const SAVE_KEY = 'fruithockey.save.v2';

const DEFAULT_STATE = () => ({
  version: 2,
  profile: { name: 'Player', avatar: 'strawberry' },
  coins: 300,
  totalXp: 0,
  rp: 120,
  owned: {
    fruit:  ['orange'],
    mallet: ['classic'],
    table:  ['wood'],
    avatar: ['strawberry', 'orange'],
  },
  equipped: { fruit: 'orange', mallet: 'classic', table: 'wood' },
  settings: {
    sfx: true, music: false, haptics: true,
    defaultDifficulty: 'amateur', targetScore: 7,
  },
  stats: {
    played: 0, wins: 0, losses: 0,
    goalsFor: 0, goalsAgainst: 0,
    streak: 0, bestStreak: 0,
    rankedPlayed: 0, rankedWins: 0,
    peakRp: 120,
  },
  flags: { seenIntro: false },
});

class Store {
  constructor() {
    this.state = DEFAULT_STATE();
    this._subs = new Set();
    this._loaded = false;
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.state = this._merge(DEFAULT_STATE(), parsed);
      }
    } catch (e) {
      console.warn('Save load failed, starting fresh.', e);
      this.state = DEFAULT_STATE();
    }
    this._loaded = true;
    return this.state;
  }

  // Deep-ish merge so new fields added in updates get sensible defaults.
  _merge(base, over) {
    if (Array.isArray(base)) return Array.isArray(over) ? over.slice() : base;
    if (base && typeof base === 'object') {
      const out = { ...base };
      for (const k of Object.keys(base)) {
        if (over && k in over) out[k] = this._merge(base[k], over[k]);
      }
      return out;
    }
    return over === undefined ? base : over;
  }

  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.state)); }
    catch (e) { console.warn('Save failed', e); }
    this._emit();
  }

  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
  _emit() { for (const fn of this._subs) { try { fn(this.state); } catch (e) { console.error(e); } } }

  // --- Derived getters ------------------------------------------------------
  get level() { return levelFromXp(this.state.totalXp).level; }
  get levelInfo() { return levelFromXp(this.state.totalXp); }

  // --- Economy --------------------------------------------------------------
  addCoins(n) { this.state.coins = Math.max(0, this.state.coins + Math.round(n)); this.save(); }
  canAfford(price) { return this.state.coins >= price; }
  spendCoins(n) {
    if (this.state.coins < n) return false;
    this.state.coins -= n; this.save(); return true;
  }

  // Returns info about any level-ups triggered (UI shows a toast).
  addXp(n) {
    const before = levelFromXp(this.state.totalXp).level;
    this.state.totalXp += Math.max(0, Math.round(n));
    const after = levelFromXp(this.state.totalXp).level;
    let coinReward = 0;
    for (let lvl = before + 1; lvl <= after; lvl++) coinReward += lvl * 25;
    if (coinReward > 0) this.state.coins += coinReward;
    this.save();
    return { leveledUp: after > before, from: before, to: after, coinReward };
  }

  addRp(delta) {
    this.state.rp = Math.max(0, this.state.rp + delta);
    this.state.stats.peakRp = Math.max(this.state.stats.peakRp, this.state.rp);
    this.save();
    return this.state.rp;
  }

  // --- Unlocks / shop -------------------------------------------------------
  isOwned(cat, id) { return (this.state.owned[cat] || []).includes(id); }
  buy(cat, id, price) {
    if (this.isOwned(cat, id)) return false;
    if (!this.spendCoins(price)) return false; // spendCoins saves+emits
    this.state.owned[cat] = [...(this.state.owned[cat] || []), id];
    this.save();
    return true;
  }
  equip(cat, id) {
    if (cat === 'avatar') this.state.profile.avatar = id;
    else this.state.equipped[cat] = id;
    this.save();
  }

  // --- Profile / settings ---------------------------------------------------
  setName(name) { this.state.profile.name = (name || 'Player').slice(0, 16); this.save(); }
  setSetting(key, value) { this.state.settings[key] = value; this.save(); }
  setFlag(key, value) { this.state.flags[key] = value; this.save(); }

  // --- Stats ----------------------------------------------------------------
  recordMatch({ win, goalsFor, goalsAgainst, ranked, counts = true }) {
    const s = this.state.stats;
    if (counts) {
      s.played++;
      if (win) { s.wins++; s.streak += 1; }
      else { s.losses++; s.streak = 0; }
      s.bestStreak = Math.max(s.bestStreak, s.streak);
      s.goalsFor += goalsFor | 0;
      s.goalsAgainst += goalsAgainst | 0;
      if (ranked) { s.rankedPlayed++; if (win) s.rankedWins++; }
    }
    this.save();
  }

  reset() {
    this.state = DEFAULT_STATE();
    this.state.flags.seenIntro = true; // don't replay intro after a reset
    this.save();
  }
}

export const store = new Store();
