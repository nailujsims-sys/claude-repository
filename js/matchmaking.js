// ============================================================================
// Fruit Hockey — Online matchmaking (simulated)
// ----------------------------------------------------------------------------
// There is no backend yet, so "online" matches are played against a bot whose
// name, avatar and skill are generated to feel like a real opponent near your
// rank. This module only produces the opponent data + flavour; the UI handles
// the search animation. Swapping in a real server later means replacing
// generateOpponent() with a network call.
// ============================================================================
import { rankForRp, DIFFICULTIES } from './data.js';

const PREFIX = ['Mango', 'Kiwi', 'Lime', 'Berry', 'Melon', 'Peachy', 'Citrus', 'Cherry', 'Plum',
  'Coco', 'Papaya', 'Guava', 'Lychee', 'Fig', 'Date', 'Olive', 'Pear', 'Apricot', 'Banana', 'Grape'];
const SUFFIX = ['Masher', 'Smash', 'Crush', 'King', 'Queen', 'Pro', 'Striker', 'Bolt', 'Storm',
  'Ace', 'Ninja', 'Slice', 'Juice', 'Blitz', 'Fury', 'Snipe', 'Wizard', 'Legend', 'Pop', 'Zoom'];
const OPP_AVATARS = ['🍊', '🍋', '🍉', '🍓', '🍇', '🥝', '🍍', '🍒', '🥭', '🍑', '🥥', '🫐', '🍐', '🥑'];
const FLAGS = ['🇩🇪', '🇫🇷', '🇪🇸', '🇮🇹', '🇬🇧', '🇺🇸', '🇧🇷', '🇯🇵', '🇰🇷', '🇨🇦', '🇳🇱', '🇸🇪', '🇦🇺', '🇵🇹'];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function randomName() {
  const n = `${pick(PREFIX)}${pick(SUFFIX)}`;
  return Math.random() < 0.5 ? n : n + (10 + Math.floor(Math.random() * 89));
}

function difficultyForRp(rp) {
  if (rp < 350) return 'rookie';
  if (rp < 650) return 'amateur';
  if (rp < 1050) return 'pro';
  if (rp < 1500) return 'champion';
  return 'legend';
}

// Produce an opponent that feels appropriately matched.
export function generateOpponent({ ranked = true, myRp = 120, myLevel = 1 } = {}) {
  let rp;
  if (ranked) {
    const spread = 60 + Math.random() * 120;
    rp = Math.max(0, Math.round(myRp + (Math.random() * 2 - 1) * spread));
  } else {
    rp = Math.max(0, Math.round(80 + Math.random() * 1500));
  }
  const rank = rankForRp(rp);
  // Casual difficulty tracks the player's level rather than rank.
  const difficultyId = ranked
    ? difficultyForRp(rp)
    : difficultyForRp(Math.min(1700, 200 + myLevel * 90 + (Math.random() * 300 - 150)));
  const diff = DIFFICULTIES.find(d => d.id === difficultyId);

  return {
    name: randomName(),
    avatar: pick(OPP_AVATARS),
    flag: pick(FLAGS),
    rp,
    rank,
    level: Math.max(1, Math.round(rp / 45 + Math.random() * 6)),
    difficultyId,
    difficulty: diff,
    ping: 18 + Math.floor(Math.random() * 70),
  };
}

// A few throwaway names to flash during the "searching" animation.
export function searchTicker(count = 6) {
  return Array.from({ length: count }, () => randomName());
}
