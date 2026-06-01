// ============================================================================
// Fruit Hockey — Game Data & Catalog
// ----------------------------------------------------------------------------
// All static game content lives here: fruit pucks, mallet skins, table themes,
// avatars, rank tiers, AI difficulties and the helper math for ranks/levels.
// Physics units are expressed in a virtual field that is FIELD_W wide (see
// game.js). Keeping the numbers here makes the whole game easy to tune.
// ============================================================================

export const RARITY = {
  common:    { label: 'Common',    color: '#7c8a99' },
  rare:      { label: 'Rare',      color: '#3b82f6' },
  epic:      { label: 'Epic',      color: '#a855f7' },
  legendary: { label: 'Legendary', color: '#f59e0b' },
};

// --- Fruit pucks ------------------------------------------------------------
// glide   : per-second velocity retention (higher = slides further)
// bounce  : restitution against walls & mallets (higher = livelier)
// push    : how much of a mallet smash transfers (lower = heavier feel)
// maxSpeed: multiplier on the global puck speed cap
// r       : radius in virtual field units
export const FRUITS = [
  { id: 'orange',     name: 'Orange',      emoji: '🍊', rarity: 'common', price: 0,    unlock: 0,
    r: 46, glide: 0.88, bounce: 0.94, push: 0.84, maxSpeed: 1.00, desc: 'The balanced all-rounder. A great place to start.' },
  { id: 'apple',      name: 'Apple',       emoji: '🍎', rarity: 'common', price: 250,  unlock: 0,
    r: 46, glide: 0.89, bounce: 0.95, push: 0.86, maxSpeed: 1.04, desc: 'Crisp and responsive, a touch quicker than the orange.' },
  { id: 'watermelon', name: 'Watermelon',  emoji: '🍉', rarity: 'common', price: 350,  unlock: 0,
    r: 60, glide: 0.82, bounce: 0.90, push: 0.70, maxSpeed: 0.92, desc: 'Big and heavy. Easy to hit, slow to move — beginner friendly.' },
  { id: 'strawberry', name: 'Strawberry',  emoji: '🍓', rarity: 'rare',   price: 600,  unlock: 2,
    r: 42, glide: 0.90, bounce: 0.96, push: 0.90, maxSpeed: 1.08, desc: 'Small, sweet and nippy. Rewards quick reactions.' },
  { id: 'lemon',      name: 'Lemon',       emoji: '🍋', rarity: 'rare',   price: 700,  unlock: 3,
    r: 40, glide: 0.92, bounce: 0.96, push: 0.92, maxSpeed: 1.12, desc: 'Zesty and fast. Low friction makes for long rallies.' },
  { id: 'kiwi',       name: 'Kiwi',        emoji: '🥝', rarity: 'rare',   price: 750,  unlock: 4,
    r: 44, glide: 0.90, bounce: 0.97, push: 0.86, maxSpeed: 1.05, desc: 'Bouncy little fella with plenty of energy off the walls.' },
  { id: 'cherry',     name: 'Cherries',    emoji: '🍒', rarity: 'epic',   price: 1200, unlock: 6,
    r: 40, glide: 0.91, bounce: 0.96, push: 0.91, maxSpeed: 1.10, desc: 'A double act that flies. For confident strikers.' },
  { id: 'pineapple',  name: 'Pineapple',   emoji: '🍍', rarity: 'epic',   price: 1400, unlock: 8,
    r: 58, glide: 0.84, bounce: 0.92, push: 0.74, maxSpeed: 0.96, desc: 'Heavyweight champ. Hard to stop once it gets going.' },
  { id: 'grapes',     name: 'Grapes',      emoji: '🍇', rarity: 'epic',   price: 1600, unlock: 10,
    r: 42, glide: 0.93, bounce: 0.99, push: 0.95, maxSpeed: 1.15, desc: 'Wildly bouncy and unpredictable. Chaos in a cluster.' },
  { id: 'coconut',    name: 'Coconut',     emoji: '🥥', rarity: 'epic',   price: 1800, unlock: 12,
    r: 56, glide: 0.80, bounce: 0.85, push: 0.66, maxSpeed: 0.90, desc: 'Thuds rather than bounces. A heavy, deliberate playstyle.' },
  { id: 'blueberry',  name: 'Blueberry',   emoji: '🫐', rarity: 'legendary', price: 3000, unlock: 15,
    r: 36, glide: 0.94, bounce: 0.98, push: 0.98, maxSpeed: 1.20, desc: 'Tiny, lightning fast and ruthless. Experts only.' },
  { id: 'dragonfruit',name: 'Dragon Fruit',emoji: '🐉', rarity: 'legendary', price: 4000, unlock: 20,
    r: 48, glide: 0.93, bounce: 0.98, push: 0.93, maxSpeed: 1.16, desc: 'The mythic puck. Perfectly tuned and impossibly cool.' },
];

// --- Mallet (striker) skins — purely cosmetic ------------------------------
export const MALLETS = [
  { id: 'classic', name: 'Classic Red',  rarity: 'common',    price: 0,    unlock: 0,  a: '#ff5a5f', b: '#c81d25', ring: '#7a0e14', cap: '#ffe9ea' },
  { id: 'lime',    name: 'Lime Zinger',  rarity: 'common',    price: 200,  unlock: 0,  a: '#a3e635', b: '#65a30d', ring: '#365314', cap: '#f7ffe0' },
  { id: 'berry',   name: 'Berry Blast',  rarity: 'common',    price: 200,  unlock: 0,  a: '#d946ef', b: '#a21caf', ring: '#581c52', cap: '#fbe8ff' },
  { id: 'ocean',   name: 'Ocean Breeze', rarity: 'rare',      price: 450,  unlock: 2,  a: '#38bdf8', b: '#0284c7', ring: '#0c4a6e', cap: '#e0f6ff' },
  { id: 'sunset',  name: 'Sunset',       rarity: 'rare',      price: 500,  unlock: 3,  a: '#fb923c', b: '#ea580c', ring: '#7c2d12', cap: '#fff1e3' },
  { id: 'mint',    name: 'Fresh Mint',   rarity: 'rare',      price: 550,  unlock: 4,  a: '#34d399', b: '#059669', ring: '#064e3b', cap: '#e6fff5' },
  { id: 'gold',    name: 'Gold Striker', rarity: 'epic',      price: 1500, unlock: 7,  a: '#fde047', b: '#eab308', ring: '#854d0e', cap: '#fffbe0' },
  { id: 'galaxy',  name: 'Galaxy',       rarity: 'epic',      price: 2000, unlock: 11, a: '#818cf8', b: '#4f46e5', ring: '#1e1b4b', cap: '#ece9ff' },
  { id: 'magma',   name: 'Magma Core',   rarity: 'legendary', price: 3500, unlock: 16, a: '#fb7185', b: '#e11d48', ring: '#4c0519', cap: '#fff0f3' },
];

// --- Table themes — cosmetic backgrounds -----------------------------------
export const TABLES = [
  { id: 'wood',    name: 'Picnic Wood',   rarity: 'common',    price: 0,    unlock: 0,  felt: '#2f8f5b', felt2: '#287a4e', line: '#eafff2', border: '#7a4b22', accent: '#ffd34d' },
  { id: 'beach',   name: 'Beach Day',     rarity: 'common',    price: 300,  unlock: 0,  felt: '#39c5c9', felt2: '#2aa7ab', line: '#f0ffff', border: '#e8c98a', accent: '#ff8c42' },
  { id: 'citrus',  name: 'Citrus Grove',  rarity: 'rare',      price: 700,  unlock: 3,  felt: '#f4a300', felt2: '#e08a00', line: '#fff7e0', border: '#7a4b22', accent: '#2f8f5b' },
  { id: 'berry',   name: 'Berry Field',   rarity: 'rare',      price: 800,  unlock: 5,  felt: '#7c3aed', felt2: '#6d28d9', line: '#f3ebff', border: '#3b0a63', accent: '#f472b6' },
  { id: 'neon',    name: 'Neon Night',    rarity: 'epic',      price: 1600, unlock: 9,  felt: '#0f172a', felt2: '#111c3a', line: '#22d3ee', border: '#0b1020', accent: '#f0f' },
  { id: 'choco',   name: 'Chocolate Bar', rarity: 'epic',      price: 1800, unlock: 13, felt: '#5b3a29', felt2: '#4a2f21', line: '#ffe8c2', border: '#2e1c12', accent: '#ffcf6b' },
  { id: 'rainbow', name: 'Rainbow Sherbet',rarity:'legendary', price: 3800, unlock: 18, felt: '#1f2937', felt2: '#1b2330', line: '#ffffff', border: '#0b0f17', accent: '#ff6bd6', rainbow: true },
];

// --- Avatars (profile faces) ------------------------------------------------
export const AVATARS = [
  { id: 'strawberry', emoji: '🍓', name: 'Strawberry', rarity: 'common',    price: 0,    unlock: 0 },
  { id: 'orange',     emoji: '🍊', name: 'Orange',     rarity: 'common',    price: 0,    unlock: 0 },
  { id: 'watermelon', emoji: '🍉', name: 'Watermelon', rarity: 'common',    price: 150,  unlock: 0 },
  { id: 'pineapple',  emoji: '🍍', name: 'Pineapple',  rarity: 'common',    price: 150,  unlock: 0 },
  { id: 'avocado',    emoji: '🥑', name: 'Avocado',    rarity: 'rare',      price: 400,  unlock: 2 },
  { id: 'peach',      emoji: '🍑', name: 'Peach',      rarity: 'rare',      price: 400,  unlock: 4 },
  { id: 'mango',      emoji: '🥭', name: 'Mango',      rarity: 'epic',      price: 900,  unlock: 7 },
  { id: 'dragon',     emoji: '🐉', name: 'Dragon',     rarity: 'legendary', price: 2500, unlock: 14 },
  { id: 'trophy',     emoji: '🏆', name: 'Champion',   rarity: 'legendary', price: 5000, unlock: 25 },
];

// --- AI difficulties --------------------------------------------------------
// speed     : fraction of the mallet's max speed the AI is allowed to use
// reaction  : seconds between AI "decisions" (higher = more sluggish)
// predict   : 0..1 accuracy of predicting where the puck will arrive
// jitter    : random aiming error in field units
// aggression: 0..1 tendency to leave the goal and attack
// coinMult  : reward multiplier for beating this difficulty
export const DIFFICULTIES = [
  { id: 'rookie',   name: 'Rookie',   emoji: '🍼', color: '#22c55e', speed: 0.52, reaction: 0.34, predict: 0.28, jitter: 110, aggression: 0.28, coinMult: 0.8 },
  { id: 'amateur',  name: 'Amateur',  emoji: '🙂', color: '#84cc16', speed: 0.70, reaction: 0.22, predict: 0.55, jitter: 64,  aggression: 0.44, coinMult: 1.0 },
  { id: 'pro',      name: 'Pro',      emoji: '😎', color: '#eab308', speed: 0.88, reaction: 0.14, predict: 0.78, jitter: 34,  aggression: 0.60, coinMult: 1.35 },
  { id: 'champion', name: 'Champion', emoji: '🔥', color: '#f97316', speed: 1.02, reaction: 0.09, predict: 0.90, jitter: 18,  aggression: 0.72, coinMult: 1.8 },
  { id: 'legend',   name: 'Legend',   emoji: '💀', color: '#ef4444', speed: 1.18, reaction: 0.05, predict: 0.98, jitter: 7,   aggression: 0.86, coinMult: 2.4 },
];

export const getFruit  = (id) => FRUITS.find(f => f.id === id)  || FRUITS[0];
export const getMallet = (id) => MALLETS.find(m => m.id === id) || MALLETS[0];
export const getTable  = (id) => TABLES.find(t => t.id === id)  || TABLES[0];
export const getAvatar = (id) => AVATARS.find(a => a.id === id) || AVATARS[0];
export const getDifficulty = (id) => DIFFICULTIES.find(d => d.id === id) || DIFFICULTIES[1];

// ============================================================================
// Ranks (ELO-style ladder used by the online/ranked mode)
// ============================================================================
export const RANK_TIERS = [
  { name: 'Bronze',      icon: '🥉', color: '#cd7f32', floor: 0 },
  { name: 'Silver',      icon: '🥈', color: '#c0c7d0', floor: 300 },
  { name: 'Gold',        icon: '🥇', color: '#ffce54', floor: 600 },
  { name: 'Platinum',    icon: '💠', color: '#5fd0d8', floor: 900 },
  { name: 'Diamond',     icon: '💎', color: '#7dd3fc', floor: 1200 },
  { name: 'Master',      icon: '👑', color: '#c084fc', floor: 1500 },
  { name: 'Grandmaster', icon: '🌟', color: '#fb7185', floor: 1800 },
];
const TIER_SPAN = 300;     // RP per tier
const DIVISION_SPAN = 100; // RP per division (III, II, I)
const ROMAN = ['III', 'II', 'I'];

// Resolve a rank-point total into a readable rank object.
export function rankForRp(rp) {
  rp = Math.max(0, Math.round(rp));
  let idx = 0;
  for (let i = RANK_TIERS.length - 1; i >= 0; i--) {
    if (rp >= RANK_TIERS[i].floor) { idx = i; break; }
  }
  const tier = RANK_TIERS[idx];
  const isTop = idx === RANK_TIERS.length - 1;
  const within = rp - tier.floor;
  const division = isTop ? null : ROMAN[Math.min(ROMAN.length - 1, Math.floor(within / DIVISION_SPAN))];
  const nextFloor = isTop ? tier.floor + TIER_SPAN : RANK_TIERS[idx + 1].floor;
  const prevFloor = isTop ? tier.floor : tier.floor + Math.floor(within / DIVISION_SPAN) * DIVISION_SPAN;
  const span = isTop ? TIER_SPAN : DIVISION_SPAN;
  const progress = Math.max(0, Math.min(1, (rp - prevFloor) / span));
  return {
    rp, tierIndex: idx, tier: tier.name, icon: tier.icon, color: tier.color,
    division, label: isTop ? tier.name : `${tier.name} ${division}`,
    progress, nextFloor, isTop,
  };
}

// ELO-style rank-point change for a ranked match.
export function rpDelta(win, myRp, oppRp) {
  const expected = 1 / (1 + Math.pow(10, (oppRp - myRp) / 400));
  const K = 32;
  let delta = Math.round(K * ((win ? 1 : 0) - expected));
  if (win) delta = Math.max(8, delta);
  else delta = Math.min(-6, delta);
  return delta;
}

// ============================================================================
// Player level / XP curve
// ============================================================================
export function xpForLevel(level) {
  // XP required to advance FROM the given level to the next.
  return 100 + (level - 1) * 60;
}

// Turn a cumulative XP total into { level, intoLevel, needed, progress }.
export function levelFromXp(totalXp) {
  let level = 1;
  let remaining = Math.max(0, Math.floor(totalXp));
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level++;
    if (level > 999) break;
  }
  const needed = xpForLevel(level);
  return { level, intoLevel: remaining, needed, progress: remaining / needed };
}
