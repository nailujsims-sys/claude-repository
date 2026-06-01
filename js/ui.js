// ============================================================================
// Fruit Hockey — UI controller
// ----------------------------------------------------------------------------
// Owns every screen (home, play, shop, ranks, profile, settings, matchmaking,
// VS, result), the in-match HUD, toasts/modals, and orchestrates Game.
// ============================================================================
import { store } from './storage.js';
import { audio } from './audio.js';
import { Game } from './game.js';
import {
  FRUITS, MALLETS, TABLES, AVATARS, DIFFICULTIES, RARITY, RANK_TIERS,
  getFruit, getMallet, getTable, getAvatar, getDifficulty,
  rankForRp, rpDelta,
} from './data.js';
import { generateOpponent, searchTicker } from './matchmaking.js';

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const PARENTS = { play: 'home', shop: 'home', ranks: 'home', profile: 'home', settings: 'home', howto: 'home', difficulty: 'play', matchmaking: 'play', result: 'home', vs: 'play' };

export const ui = {
  init() {
    this.root = document.getElementById('screen-root');
    this.gameLayer = document.getElementById('game-layer');
    this.canvas = document.getElementById('board');
    this.hud = document.getElementById('hud');
    this.topbar = document.getElementById('topbar');
    this.toastHost = document.getElementById('toast-host');
    this.modalHost = document.getElementById('modal-host');
    this.game = null;
    this.shopTab = 'fruit';
    this._timers = [];

    document.addEventListener('click', (e) => this._onClick(e));
    store.subscribe(() => { if (!this._inGame()) this.updateTopbar(); });

    // Unlock audio + (optional) music on first interaction.
    const unlock = () => { audio.ensure(); if (store.state.settings.music) audio.startMusic(); window.removeEventListener('pointerdown', unlock); };
    window.addEventListener('pointerdown', unlock);

    this.show(store.state.flags.seenIntro ? 'home' : 'home');
  },

  _inGame() { return !this.gameLayer.classList.contains('hidden'); },

  // --- Navigation -----------------------------------------------------------
  show(name, params = {}) {
    this.current = name; this.params = params;
    this._clearTimers();
    const def = this.screens[name].call(this, params);
    this.root.innerHTML = def.html;
    this.root.scrollTop = 0;
    this._showGame(false);
    this.topbar.classList.toggle('hidden', def.topbar === false);
    this.updateTopbar();
    def.mount?.call(this, params);
  },

  _showGame(on) {
    this.gameLayer.classList.toggle('hidden', !on);
    this.root.classList.toggle('hidden', on);
    this.topbar.classList.toggle('hidden', on);
  },

  _clearTimers() { this._timers.forEach(clearTimeout); this._timers.forEach(clearInterval); this._timers = []; },
  _after(fn, ms) { const id = setTimeout(fn, ms); this._timers.push(id); return id; },
  _every(fn, ms) { const id = setInterval(fn, ms); this._timers.push(id); return id; },

  // --- Top bar --------------------------------------------------------------
  updateTopbar() {
    const s = store.state;
    const lvl = store.levelInfo;
    const rank = rankForRp(s.rp);
    const av = getAvatar(s.profile.avatar);
    const back = this.current && this.current !== 'home'
      ? `<button class="tb-back" data-action="back" aria-label="Back">‹</button>` : `<div class="tb-back-spacer"></div>`;
    this.topbar.innerHTML = `
      ${back}
      <button class="tb-profile" data-action="nav:profile">
        <span class="tb-avatar">${av.emoji}</span>
        <span class="tb-meta">
          <span class="tb-name">${esc(s.profile.name)} <span class="tb-lvl">Lv ${lvl.level}</span></span>
          <span class="tb-xpbar"><span class="tb-xpfill" style="width:${Math.round(lvl.progress * 100)}%"></span></span>
        </span>
      </button>
      <button class="tb-rank" data-action="nav:ranks" style="--rk:${rank.color}">${rank.icon} ${esc(rank.label)}</button>
      <button class="tb-coins" data-action="nav:shop">🪙 ${s.coins.toLocaleString()}</button>`;
  },

  // --- Click routing --------------------------------------------------------
  _onClick(e) {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const action = t.getAttribute('data-action');
    if (action !== 'noop') audio.sfx(action === 'back' ? 'back' : 'click');
    this._dispatch(action, t, e);
  },

  _dispatch(action, el) {
    const [cmd, a, b] = action.split(':');
    switch (cmd) {
      case 'nav': this.show(a); break;
      case 'back': this.show(PARENTS[this.current] || 'home'); break;
      case 'play':
        if (a === 'single') this.show('difficulty');
        else if (a === 'local') this.startLocal();
        else if (a === 'online') this.startMatchmaking(b === 'ranked');
        else if (a === 'arcade') this.startArcade(b);
        break;
      case 'diff': this.startSingle(a); break;
      case 'mm': if (a === 'cancel') this.show('play'); break;
      case 'shop': if (a === 'tab') { this.shopTab = b; this.show('shop'); } break;
      case 'buy': this.buy(a, b); break;
      case 'equip': store.equip(a, b); audio.sfx('coin'); this.show(this.current); break;
      case 'set': this.applySetting(a, b); break;
      case 'profile': if (a === 'editname') this.editName(); else if (a === 'avatar') { this.shopTab = 'avatar'; this.show('shop'); } break;
      case 'result': this.resultAction(a); break;
      case 'hud': this.hudAction(a); break;
      case 'vs': if (a === 'start') this._startVsNow(); break;
      case 'modal': this._closeModal(b === 'confirm'); break;
    }
  },

  // ==========================================================================
  // SCREENS
  // ==========================================================================
  screens: {
    home() {
      const s = store.state;
      const rank = rankForRp(s.rp);
      return {
        html: `
        <div class="screen">
          <div class="hero">
            <div class="hero-logo">🍉🏒</div>
            <h1 class="hero-title">Fruit Hockey</h1>
            <p class="hero-sub">Smash the fruit. Score the goals. Climb the ranks.</p>
          </div>
          <button class="btn btn-primary btn-block btn-xl" data-action="play:single">▶ &nbsp;Quick Play</button>
          <div class="card-grid">
            ${this._menuCard('play', '🎮', 'Play', 'Modes & matches')}
            ${this._menuCard('shop', '🛒', 'Shop', `${s.coins.toLocaleString()} 🪙`)}
            ${this._menuCard('ranks', rank.icon, 'Ranks', rank.label)}
            ${this._menuCard('profile', '👤', 'Profile', `Level ${store.level}`)}
            ${this._menuCard('howto', '❓', 'How to Play', 'Tips & rules')}
            ${this._menuCard('settings', '⚙️', 'Settings', 'Sound & more')}
          </div>
          <p class="foot-note">Best played in portrait. Add to your home screen for the full app feel.</p>
        </div>`,
      };
    },

    play() {
      return {
        html: `
        <div class="screen">
          <h2 class="screen-h">Play</h2>
          <h3 class="section-title">Solo</h3>
          ${this._modeCard('play:single', '🤖', 'Single Player', 'Take on the CPU across 5 difficulties.', 'vs CPU')}
          ${this._modeCard('play:local', '👬', 'Local 2 Players', 'Two players, one device. Each grabs an end!', 'Pass & Play')}
          <h3 class="section-title">Online</h3>
          ${this._modeCard('play:online:ranked', '🏆', 'Ranked Match', 'Compete for Rank Points and climb the ladder.', 'Ranked')}
          ${this._modeCard('play:online:casual', '🌐', 'Quick Match', 'Casual online play. Win coins, no pressure.', 'Casual')}
          <h3 class="section-title">Arcade</h3>
          ${this._modeCard('play:arcade:timeattack', '⏱️', 'Time Attack', 'Score as many goals as you can in 90 seconds.', '90s')}
          ${this._modeCard('play:arcade:survival', '❤️', 'Survival', 'Endless CPU that ramps up. How long can you last?', 'Endless')}
          ${this._modeCard('play:arcade:suddendeath', '⚡', 'Sudden Death', 'First goal wins. Nerves of steel required.', 'First to 1')}
          ${this._modeCard('play:arcade:multifruit', '🍒', 'Multi-Fruit Madness', 'Three pucks on the table at once. Chaos!', '3 pucks')}
          <p class="foot-note">Online opponents are simulated locally for now — perfect for practice until the servers go live.</p>
        </div>`,
      };
    },

    difficulty() {
      const fruit = getFruit(store.state.equipped.fruit);
      return {
        html: `
        <div class="screen">
          <h2 class="screen-h">Choose Difficulty</h2>
          <div class="loadout-chip">
            <span>Your puck:</span> <b>${fruit.emoji} ${fruit.name}</b>
            <button class="btn btn-ghost btn-sm" data-action="nav:shop">Change</button>
          </div>
          ${DIFFICULTIES.map(d => `
            <button class="mode-card diff-card" data-action="diff:${d.id}" style="--c:${d.color}">
              <span class="mode-ico">${d.emoji}</span>
              <span class="mode-body">
                <span class="mode-title">${d.name}</span>
                <span class="mode-desc">${this._diffDesc(d)}</span>
              </span>
              <span class="mode-tag">×${d.coinMult} 🪙</span>
            </button>`).join('')}
        </div>`,
      };
    },

    matchmaking(params) {
      return {
        topbar: false,
        html: `
        <div class="screen mm">
          <div class="mm-mode">${params.ranked ? '🏆 Ranked Match' : '🌐 Quick Match'}</div>
          <div class="mm-spinner"><div class="mm-orbit">🍊</div><div class="mm-ball">🏒</div></div>
          <div class="mm-status" id="mm-status">Searching for an opponent…</div>
          <div class="mm-ticker" id="mm-ticker"></div>
          <button class="btn btn-ghost btn-block" data-action="mm:cancel">Cancel</button>
        </div>`,
        mount() { this._runMatchmaking(params.ranked); },
      };
    },

    vs(params) {
      const o = params.opponent;
      const me = store.state;
      const myRank = rankForRp(me.rp);
      return {
        topbar: false,
        html: `
        <div class="screen vs">
          <div class="vs-mode">${params.label}</div>
          <div class="vs-card you">
            <div class="vs-avatar">${getAvatar(me.profile.avatar).emoji}</div>
            <div class="vs-name">${esc(me.profile.name)}</div>
            <div class="vs-rank" style="--rk:${myRank.color}">${myRank.icon} ${myRank.label} · Lv ${store.level}</div>
          </div>
          <div class="vs-mid">VS</div>
          <div class="vs-card opp">
            <div class="vs-avatar">${o.avatar}</div>
            <div class="vs-name">${o.flag || ''} ${esc(o.name)}</div>
            <div class="vs-rank" style="--rk:${o.rank.color}">${o.rank.icon} ${o.rank.label} · ${o.ping}ms</div>
          </div>
          <button class="btn btn-primary btn-block" data-action="vs:start">Start Match</button>
        </div>`,
        mount() { this._after(() => { if (this.current === 'vs') this._startVsNow(); }, 2200); },
      };
    },

    shop() {
      const tab = this.shopTab;
      const cats = [['fruit', '🍉 Pucks'], ['mallet', '🏒 Mallets'], ['table', '🟩 Tables'], ['avatar', '😀 Avatars']];
      const lists = { fruit: FRUITS, mallet: MALLETS, table: TABLES, avatar: AVATARS };
      return {
        html: `
        <div class="screen">
          <h2 class="screen-h">Shop <span class="coins-pill">🪙 ${store.state.coins.toLocaleString()}</span></h2>
          <div class="shop-tabs">
            ${cats.map(([id, label]) => `<button class="shop-tab ${tab === id ? 'on' : ''}" data-action="shop:tab:${id}">${label}</button>`).join('')}
          </div>
          <div class="item-grid">
            ${lists[tab].map(item => this._itemCard(tab, item)).join('')}
          </div>
        </div>`,
      };
    },

    ranks() {
      const s = store.state;
      const rank = rankForRp(s.rp);
      const wr = s.stats.rankedPlayed ? Math.round(s.stats.rankedWins / s.stats.rankedPlayed * 100) : 0;
      return {
        html: `
        <div class="screen">
          <h2 class="screen-h">Ranked</h2>
          <div class="rank-hero" style="--rk:${rank.color}">
            <div class="rank-badge">${rank.icon}</div>
            <div class="rank-name">${rank.label}</div>
            <div class="rank-rp">${s.rp} RP</div>
            <div class="rank-bar"><span style="width:${Math.round(rank.progress * 100)}%"></span></div>
            <div class="rank-next">${rank.isTop ? 'Peak tier reached! 🌟' : `${rank.nextFloor - s.rp} RP to next rank`}</div>
          </div>
          <div class="stat-grid mini">
            ${this._stat(s.stats.rankedWins, 'Ranked Wins')}
            ${this._stat(s.stats.rankedPlayed, 'Ranked Games')}
            ${this._stat(wr + '%', 'Win Rate')}
            ${this._stat(s.stats.peakRp, 'Peak RP')}
          </div>
          <h3 class="section-title">Tiers</h3>
          <div class="ladder">
            ${RANK_TIERS.map((t, i) => `<div class="ladder-row ${i === rank.tierIndex ? 'on' : ''}"><span>${t.icon} ${t.name}</span><span class="muted">${t.floor}+ RP</span></div>`).join('')}
          </div>
          <h3 class="section-title">Leaderboard</h3>
          <div class="lb">${this._leaderboard()}</div>
          <button class="btn btn-primary btn-block" data-action="play:online:ranked">🏆 Play Ranked</button>
        </div>`,
      };
    },

    profile() {
      const s = store.state;
      const lvl = store.levelInfo;
      const rank = rankForRp(s.rp);
      const wr = s.stats.played ? Math.round(s.stats.wins / s.stats.played * 100) : 0;
      const fruit = getFruit(s.equipped.fruit), mallet = getMallet(s.equipped.mallet), table = getTable(s.equipped.table);
      return {
        html: `
        <div class="screen">
          <h2 class="screen-h">Profile</h2>
          <div class="profile-head">
            <button class="profile-avatar" data-action="profile:avatar">${getAvatar(s.profile.avatar).emoji}<span class="edit-dot">✎</span></button>
            <div class="profile-name-row">
              <span class="profile-name">${esc(s.profile.name)}</span>
              <button class="btn btn-ghost btn-sm" data-action="profile:editname">Edit</button>
            </div>
            <div class="profile-sub">Level ${lvl.level} · <span style="color:${rank.color}">${rank.icon} ${rank.label}</span></div>
            <div class="rank-bar small"><span style="width:${Math.round(lvl.progress * 100)}%"></span></div>
            <div class="muted xp-text">${lvl.intoLevel} / ${lvl.needed} XP</div>
          </div>
          <div class="stat-grid">
            ${this._stat(s.stats.played, 'Matches')}
            ${this._stat(s.stats.wins, 'Wins')}
            ${this._stat(s.stats.losses, 'Losses')}
            ${this._stat(wr + '%', 'Win Rate')}
            ${this._stat(s.stats.goalsFor, 'Goals For')}
            ${this._stat(s.stats.goalsAgainst, 'Goals Vs')}
            ${this._stat(s.stats.bestStreak, 'Best Streak')}
            ${this._stat(s.coins.toLocaleString(), 'Coins')}
          </div>
          <h3 class="section-title">Loadout</h3>
          <div class="loadout">
            <div class="loadout-item"><span>${fruit.emoji}</span><b>${fruit.name}</b><small>Puck</small></div>
            <div class="loadout-item"><span class="mallet-dot" style="background:${mallet.a}"></span><b>${mallet.name}</b><small>Mallet</small></div>
            <div class="loadout-item"><span class="table-dot" style="background:${table.felt}"></span><b>${table.name}</b><small>Table</small></div>
          </div>
          <button class="btn btn-ghost btn-block" data-action="nav:shop">Customise in Shop</button>
        </div>`,
      };
    },

    settings() {
      const st = store.state.settings;
      const seg = (group, opts, cur) => `<div class="seg">${opts.map(o => `<button class="seg-btn ${cur === o.v ? 'on' : ''}" data-action="set:${group}:${o.v}">${o.l}</button>`).join('')}</div>`;
      return {
        html: `
        <div class="screen">
          <h2 class="screen-h">Settings</h2>
          <div class="settings-list">
            ${this._toggleRow('sfx', '🔊 Sound Effects', st.sfx)}
            ${this._toggleRow('music', '🎵 Music', st.music)}
            ${this._toggleRow('haptics', '📳 Vibration', st.haptics)}
          </div>
          <h3 class="section-title">Default Difficulty</h3>
          ${seg('difficulty', DIFFICULTIES.map(d => ({ v: d.id, l: d.name })), st.defaultDifficulty)}
          <h3 class="section-title">Goals to Win</h3>
          ${seg('target', [3, 5, 7, 9].map(n => ({ v: String(n), l: String(n) })), String(st.targetScore))}
          <h3 class="section-title">Data</h3>
          <button class="btn btn-danger btn-block" data-action="set:reset:1">Reset All Progress</button>
          <p class="foot-note">Fruit Hockey · a juicy air-hockey game. Everything runs offline on your device.</p>
        </div>`,
      };
    },

    howto() {
      return {
        html: `
        <div class="screen">
          <h2 class="screen-h">How to Play</h2>
          <div class="howto">
            <div class="how-row"><span>👆</span><p><b>Move your mallet</b> by dragging your finger on your half of the table.</p></div>
            <div class="how-row"><span>🥅</span><p><b>Score</b> by knocking the fruit puck into your opponent's goal.</p></div>
            <div class="how-row"><span>💥</span><p><b>Smash</b> by flicking into the puck — the faster you swipe, the harder it flies.</p></div>
            <div class="how-row"><span>👬</span><p><b>Local 2-player</b> uses both ends of the screen at once with multi-touch.</p></div>
            <div class="how-row"><span>🍉</span><p><b>Fruit matters!</b> Watermelons are big & slow, blueberries are tiny & fast. Unlock more in the Shop.</p></div>
            <div class="how-row"><span>🏆</span><p><b>Ranked</b> matches win or lose Rank Points. Climb from Bronze to Grandmaster.</p></div>
            <div class="how-row"><span>🪙</span><p><b>Earn coins</b> every match to unlock pucks, mallet skins, tables and avatars.</p></div>
          </div>
          <button class="btn btn-primary btn-block" data-action="play:single">Got it — Let's Play!</button>
        </div>`,
      };
    },

    result() {
      const d = this._pendingResult;
      if (!d) return { html: `<div class="screen"><button class="btn btn-primary btn-block" data-action="nav:home">Home</button></div>` };
      const { result: r, rewards, rankInfo, levelUp } = d;
      const won = r.win;
      let title, emoji, cls;
      if (r.mode === 'timeattack') { title = "Time's Up!"; emoji = '⏱️'; cls = 'win'; }
      else if (r.mode === 'survival') { title = 'Game Over'; emoji = '❤️'; cls = 'lose'; }
      else if (r.mode === 'local') { title = r.winnerSide === 'bottom' ? 'Player 1 Wins!' : 'Player 2 Wins!'; emoji = '🏆'; cls = 'win'; }
      else { title = won ? 'Victory!' : 'Defeat'; emoji = won ? '🏆' : '😞'; cls = won ? 'win' : 'lose'; }

      const scoreLine = r.mode === 'timeattack'
        ? `<div class="result-score big">${r.scoreBottom} <small>goals</small></div>`
        : r.mode === 'survival'
          ? `<div class="result-score big">${r.scoreBottom} <small>goals before defeat</small></div>`
          : `<div class="result-score">${r.scoreBottom} <span>–</span> ${r.scoreTop}</div>`;

      let rankBlock = '';
      if (rankInfo) {
        const up = rankInfo.delta >= 0;
        rankBlock = `
          <div class="reward-row rank ${up ? 'up' : 'down'}">
            <span>Rank Points</span>
            <b>${up ? '+' : ''}${rankInfo.delta} RP → ${rankInfo.after.rp}</b>
          </div>
          ${rankInfo.promoted ? `<div class="promote">⬆️ Promoted to ${rankInfo.after.label}!</div>` : ''}
          ${rankInfo.demoted ? `<div class="promote demote">⬇️ Demoted to ${rankInfo.after.label}</div>` : ''}`;
      }

      const onlineRematch = (r.mode === 'ranked' || r.mode === 'casual');
      return {
        topbar: false,
        html: `
        <div class="screen result ${cls}">
          <div class="result-emoji">${emoji}</div>
          <h1 class="result-title">${title}</h1>
          ${scoreLine}
          <div class="rewards">
            <div class="reward-row"><span>🪙 Coins</span><b>+${rewards.coins}</b></div>
            <div class="reward-row"><span>⭐ XP</span><b>+${rewards.xp}</b></div>
            ${levelUp.leveledUp ? `<div class="promote">⬆️ Level ${levelUp.to}! ${levelUp.coinReward ? `+${levelUp.coinReward} 🪙` : ''}</div>` : ''}
            ${rankBlock}
          </div>
          <button class="btn btn-primary btn-block" data-action="result:rematch">↻ ${onlineRematch ? 'Play Again' : 'Rematch'}</button>
          ${onlineRematch ? `<button class="btn btn-ghost btn-block" data-action="result:newopp">Find New Opponent</button>` : ''}
          <button class="btn btn-ghost btn-block" data-action="result:menu">Home</button>
        </div>`,
      };
    },
  },

  // --- Screen helpers -------------------------------------------------------
  _menuCard(nav, ico, title, sub) {
    return `<button class="card menu-card" data-action="nav:${nav}">
      <span class="menu-ico">${ico}</span><span class="menu-title">${title}</span><span class="menu-sub">${esc(sub)}</span>
    </button>`;
  },
  _modeCard(action, ico, title, desc, tag) {
    return `<button class="mode-card" data-action="${action}">
      <span class="mode-ico">${ico}</span>
      <span class="mode-body"><span class="mode-title">${title}</span><span class="mode-desc">${desc}</span></span>
      <span class="mode-tag">${tag}</span>
    </button>`;
  },
  _diffDesc(d) {
    return { rookie: 'Gentle and forgiving. Great for learning.', amateur: 'A fair challenge for casual players.', pro: 'Quick and accurate. Stay sharp.', champion: 'Fast, aggressive and clever.', legend: 'Near-perfect. Almost unbeatable.' }[d.id] || '';
  },
  _stat(num, label) { return `<div class="stat"><div class="stat-num">${num}</div><div class="stat-label">${label}</div></div>`; },
  _toggleRow(key, label, on) {
    return `<button class="setrow" data-action="set:${key}:toggle"><span>${label}</span><span class="toggle ${on ? 'on' : ''}"><span class="knob"></span></span></button>`;
  },

  _itemCard(cat, item) {
    const owned = store.isOwned(cat, item.id);
    const equipped = cat === 'avatar' ? store.state.profile.avatar === item.id : store.state.equipped[cat] === item.id;
    const lvl = store.level;
    const locked = item.unlock > lvl && !owned;
    const rarity = RARITY[item.rarity] || RARITY.common;
    const preview = cat === 'fruit' || cat === 'avatar'
      ? `<span class="item-emoji">${item.emoji}</span>`
      : cat === 'mallet'
        ? `<span class="item-mallet" style="background:radial-gradient(circle at 35% 30%, ${item.a}, ${item.b});border-color:${item.ring}"></span>`
        : `<span class="item-table" style="background:linear-gradient(135deg, ${item.felt}, ${item.felt2});border-color:${item.border}"></span>`;
    let action = '', btn = '';
    if (equipped) { btn = `<span class="item-btn equipped">Equipped</span>`; }
    else if (owned) { btn = `<button class="item-btn equip" data-action="equip:${cat}:${item.id}">Equip</button>`; }
    else if (locked) { btn = `<span class="item-btn locked">🔒 Lv ${item.unlock}</span>`; }
    else {
      const afford = store.canAfford(item.price);
      btn = `<button class="item-btn buy ${afford ? '' : 'broke'}" data-action="buy:${cat}:${item.id}">🪙 ${item.price}</button>`;
    }
    return `<div class="item-card ${equipped ? 'is-equipped' : ''} ${locked ? 'is-locked' : ''}" style="--rar:${rarity.color}">
      <div class="item-rarity">${rarity.label}</div>
      ${preview}
      <div class="item-name">${item.name}</div>
      ${cat === 'fruit' ? `<div class="item-desc">${item.desc}</div>` : ''}
      ${btn}
    </div>`;
  },

  _leaderboard() {
    const me = store.state;
    const rows = [];
    for (let i = 0; i < 9; i++) {
      const o = generateOpponent({ ranked: true, myRp: me.rp });
      rows.push({ name: o.name, rp: o.rp, icon: o.rank.icon, you: false, avatar: o.avatar });
    }
    rows.push({ name: me.profile.name, rp: me.rp, icon: rankForRp(me.rp).icon, you: true, avatar: getAvatar(me.profile.avatar).emoji });
    rows.sort((a, b) => b.rp - a.rp);
    return rows.map((r, i) => `<div class="lb-row ${r.you ? 'you' : ''}"><span class="lb-rank">#${i + 1}</span><span class="lb-av">${r.avatar}</span><span class="lb-name">${esc(r.name)}</span><span class="lb-rp">${r.icon} ${r.rp}</span></div>`).join('');
  },

  // ==========================================================================
  // ACTIONS
  // ==========================================================================
  buy(cat, id) {
    const list = { fruit: FRUITS, mallet: MALLETS, table: TABLES, avatar: AVATARS }[cat];
    const item = list.find(x => x.id === id);
    if (!item) return;
    if (item.unlock > store.level) { audio.sfx('error'); this.toast(`Reach level ${item.unlock} to unlock`, '🔒'); return; }
    if (!store.canAfford(item.price)) { audio.sfx('error'); this.toast('Not enough coins', '🪙'); return; }
    if (store.buy(cat, item.id, item.price)) {
      audio.sfx('coin');
      store.equip(cat, item.id);
      this.toast(`${item.emoji || '✨'} ${item.name} unlocked & equipped!`, '✅');
      this.show('shop');
    }
  },

  applySetting(key, val) {
    if (key === 'reset') { this._confirmReset(); return; }
    if (val === 'toggle') {
      const cur = !!store.state.settings[key];
      store.setSetting(key, !cur);
      if (key === 'music') audio.toggleMusic(!cur);
      if (key === 'sfx' && !cur) audio.sfx('click');
    } else if (key === 'difficulty') {
      store.setSetting('defaultDifficulty', val);
    } else if (key === 'target') {
      store.setSetting('targetScore', parseInt(val, 10));
    }
    this.show('settings');
  },

  editName() {
    this.modal({
      title: 'Edit Name',
      body: `<input id="name-input" class="text-input" maxlength="16" value="${esc(store.state.profile.name)}" />`,
      actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Save', cls: 'primary', confirm: true }],
    }).then(ok => {
      if (ok) {
        const v = document.getElementById('name-input');
        if (v && v.value.trim()) { store.setName(v.value.trim()); this.toast('Name updated', '✅'); }
      }
      this.show('profile');
    });
    setTimeout(() => document.getElementById('name-input')?.focus(), 50);
  },

  _confirmReset() {
    this.modal({
      title: 'Reset Progress?',
      body: `<p>This will erase all coins, levels, ranks and unlocks. This cannot be undone.</p>`,
      actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Reset', cls: 'danger', confirm: true }],
    }).then(ok => { if (ok) { store.reset(); this.toast('Progress reset', '🔄'); } this.show('settings'); });
  },

  // ==========================================================================
  // MATCH SET-UP
  // ==========================================================================
  startSingle(difficultyId) {
    const diff = getDifficulty(difficultyId);
    this._begin({
      type: 'single', mode: 'singleplayer', ranked: false,
      target: store.state.settings.targetScore,
      opponent: { name: `CPU · ${diff.name}`, avatar: diff.emoji, difficultyId, rp: 0 },
    });
  },

  startLocal() {
    this._begin({
      type: 'local', mode: 'local', ranked: false, topHuman: true,
      target: store.state.settings.targetScore,
      opponent: { name: 'Player 2', avatar: '🍋', difficultyId: 'amateur' },
      opponentMalletId: 'ocean',
    });
  },

  startArcade(mode) {
    const diff = getDifficulty(store.state.settings.defaultDifficulty);
    const base = { type: 'arcade', mode, ranked: false, opponent: { name: 'CPU', avatar: diff.emoji, difficultyId: diff.id, rp: 0 } };
    if (mode === 'timeattack') { Object.assign(base, { timeLimit: 90, target: 999, opponent: { name: 'Practice Wall', avatar: '🧱', difficultyId: 'rookie', rp: 0 } }); base.topHuman = false; }
    else if (mode === 'survival') { Object.assign(base, { lives: 5, target: 999, opponent: { name: 'Survival CPU', avatar: '💀', difficultyId: 'amateur', rp: 0 } }); }
    else if (mode === 'suddendeath') { base.target = 1; }
    else if (mode === 'multifruit') { base.target = 5; base.puckCount = 3; }
    this._begin(base);
  },

  startMatchmaking(ranked) { this.show('matchmaking', { ranked }); },

  _runMatchmaking(ranked) {
    const statusEl = () => document.getElementById('mm-status');
    const tickerEl = () => document.getElementById('mm-ticker');
    audio.sfx('match');
    const names = searchTicker(20);
    let i = 0;
    this._every(() => { const t = tickerEl(); if (t) t.textContent = names[(i++) % names.length] + ' · ' + (18 + Math.floor(Math.random() * 80)) + 'ms'; }, 180);
    this._after(() => { const s = statusEl(); if (s) s.textContent = ranked ? 'Matching by Rank Points…' : 'Finding a fair match…'; }, 1100);
    this._after(() => {
      const opp = generateOpponent({ ranked, myRp: store.state.rp, myLevel: store.level });
      const s = statusEl(); if (s) s.textContent = 'Opponent found!';
      audio.sfx('match');
      this._after(() => { if (this.current === 'matchmaking') this.show('vs', { opponent: opp, ranked, label: ranked ? '🏆 Ranked Match' : '🌐 Quick Match', mode: ranked ? 'ranked' : 'casual' }); }, 600);
    }, 2400 + Math.random() * 1200);
  },

  _startVsNow() {
    const p = this.params;
    if (!p || !p.opponent) return;
    const o = p.opponent;
    this._begin({
      type: 'online', mode: p.mode, ranked: p.ranked,
      target: store.state.settings.targetScore,
      opponent: { name: o.name, avatar: o.avatar, difficultyId: o.difficultyId, rp: o.rp, flag: o.flag },
    });
  },

  // The single entry point that actually launches a Game.
  _begin(opts) {
    audio.ensure();
    this._clearTimers();      // cancel any pending VS/matchmaking timers
    this.current = 'game';    // so a stray VS auto-start timer can't double-launch
    this.lastPlay = opts;
    const eq = store.state.equipped;
    const config = {
      mode: opts.mode, ranked: opts.ranked,
      target: opts.target ?? store.state.settings.targetScore,
      timeLimit: opts.timeLimit ?? null,
      lives: opts.lives ?? 5,
      puckCount: opts.puckCount ?? 1,
      topHuman: !!opts.topHuman,
      fruitId: eq.fruit, malletId: eq.mallet, tableId: eq.table,
      opponentMalletId: opts.opponentMalletId || (opts.topHuman ? 'ocean' : 'galaxy'),
      player: { name: store.state.profile.name, avatar: getAvatar(store.state.profile.avatar).emoji },
      opponent: opts.opponent,
      callbacks: {
        onScore: (s) => this._hudScore(s),
        onTimer: (t) => this._hudTimer(t),
        onCountdown: (n) => this._hudCountdown(n),
        onGoal: (side) => this._hudGoal(side),
        onEnd: (r) => this.handleMatchEnd(r),
        onStateChange: () => {},
      },
    };
    this._buildHud(config);
    this._showGame(true);
    if (this.game) this.game.destroy();
    this.game = new Game(this.canvas, config);
    this.game.start();
  },

  // ==========================================================================
  // HUD
  // ==========================================================================
  _buildHud(config) {
    const me = config.player, opp = config.opponent;
    const local = config.topHuman;
    let infoText = `First to ${config.target}`;
    if (config.mode === 'timeattack') infoText = fmtTime(config.timeLimit);
    if (config.mode === 'survival') infoText = '❤'.repeat(config.lives);
    this.hud.innerHTML = `
      <div class="hud-row hud-top ${local ? 'rotate' : ''}">
        <div class="hud-player"><span class="hud-avatar">${opp.avatar}</span><span class="hud-name">${esc(opp.name)}</span></div>
        <div class="hud-score" id="hud-top-score">0</div>
      </div>
      <div class="hud-mid">
        <div class="hud-info" id="hud-info">${infoText}</div>
        <button class="hud-pause" data-action="hud:pause" aria-label="Pause">⏸</button>
        <div class="goal-banner" id="goal-banner"></div>
      </div>
      <div class="hud-row hud-bottom">
        <div class="hud-score" id="hud-bottom-score">0</div>
        <div class="hud-player"><span class="hud-name">${esc(me.name)}</span><span class="hud-avatar">${me.avatar}</span></div>
      </div>`;
    this._hudEls = {
      top: document.getElementById('hud-top-score'),
      bottom: document.getElementById('hud-bottom-score'),
      info: document.getElementById('hud-info'),
      banner: document.getElementById('goal-banner'),
    };
    this._hudMode = config.mode;
  },

  _hudScore(s) {
    if (!this._hudEls) return;
    this._hudEls.top.textContent = s.top;
    this._hudEls.bottom.textContent = s.bottom;
    if (this._hudMode === 'survival' && s.livesLeft != null) this._hudEls.info.textContent = '❤'.repeat(s.livesLeft) || '—';
  },
  _hudTimer(t) { if (this._hudEls && this._hudMode === 'timeattack') this._hudEls.info.textContent = fmtTime(t); },
  _hudCountdown(n) {
    if (!this._hudEls) return;
    if (n === 0) this._banner('GO!', 'go');
  },
  _hudGoal() { this._banner('GOAL!', 'goal'); },
  _banner(text, cls) {
    const b = this._hudEls?.banner; if (!b) return;
    b.textContent = text; b.className = `goal-banner show ${cls}`;
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => { b.className = 'goal-banner'; }, 1000);
  },

  hudAction(a) {
    if (a === 'pause') {
      this.game?.pause();
      this.modal({
        title: '⏸ Paused',
        body: `<p class="muted center">Take a breath.</p>`,
        actions: [
          { label: '↻ Restart', cls: 'ghost', value: 'restart' },
          { label: '🏠 Quit', cls: 'danger', value: 'quit' },
          { label: '▶ Resume', cls: 'primary', value: 'resume', confirm: true },
        ],
        dismissable: false,
      }).then(v => {
        if (v === 'resume' || v === true) this.game?.resume();
        else if (v === 'restart') { this.game?.destroy(); this._begin(this.lastPlay); }
        else if (v === 'quit') { this._quitToMenu(); }
        else this.game?.resume();
      });
    }
  },

  _quitToMenu() {
    if (this.game) { this.game.destroy(); this.game = null; }
    this.show('home');
  },

  // ==========================================================================
  // MATCH END + REWARDS
  // ==========================================================================
  computeRewards(r) {
    const diff = getDifficulty(r.difficultyId);
    const g = r.scoreBottom;
    let coins = 0, xp = 0;
    switch (r.mode) {
      case 'timeattack': coins = 20 + g * 12; xp = 20 + g * 10; break;
      case 'survival': coins = 25 + g * 14; xp = 20 + g * 12; break;
      case 'local': coins = 15; xp = 20; break;
      case 'ranked': coins = (r.win ? 120 : 35) + g * 6; xp = (r.win ? 70 : 30) + g * 8; break;
      case 'casual': coins = 25 + g * 6 + (r.win ? 60 : 0); xp = 20 + g * 8 + (r.win ? 40 : 15); break;
      case 'suddendeath': coins = (30 + (r.win ? 60 : 0)) * diff.coinMult; xp = r.win ? 45 : 15; break;
      default: coins = (25 + g * 6 + (r.win ? 70 : 0)) * diff.coinMult; xp = 20 + g * 8 + (r.win ? 45 : 15);
    }
    return { coins: Math.max(0, Math.round(coins)), xp: Math.max(0, Math.round(xp)) };
  },

  handleMatchEnd(r) {
    const rewards = this.computeRewards(r);
    let rankInfo = null;
    if (r.ranked) {
      const before = rankForRp(store.state.rp);
      const delta = rpDelta(r.win, store.state.rp, r.opponent.rp || 120);
      store.addRp(delta);
      const after = rankForRp(store.state.rp);
      rankInfo = { before, after, delta, promoted: after.tierIndex > before.tierIndex, demoted: after.tierIndex < before.tierIndex };
    }
    store.addCoins(rewards.coins);
    const levelUp = store.addXp(rewards.xp);
    store.recordMatch({
      win: r.win, goalsFor: r.scoreBottom, goalsAgainst: r.scoreTop,
      ranked: r.ranked, counts: r.mode !== 'local' && r.mode !== 'timeattack',
    });
    if (levelUp.leveledUp) { this._after(() => audio.sfx('rankUp'), 300); }
    if (rankInfo && rankInfo.promoted) { this._after(() => audio.sfx('rankUp'), 500); }

    this._pendingResult = { result: r, rewards, rankInfo, levelUp };
    // Let the celebration / particles breathe, then show the result screen.
    this._after(() => { if (this.game) { this.game.destroy(); this.game = null; } this.show('result'); }, 1100);
  },

  resultAction(a) {
    if (a === 'menu') { this.show('home'); return; }
    const last = this.lastPlay;
    if (a === 'newopp' || (a === 'rematch' && last && last.type === 'online')) {
      this.startMatchmaking(last.ranked);
    } else if (a === 'rematch' && last) {
      this._begin(last);
    } else {
      this.show('home');
    }
  },

  // ==========================================================================
  // TOASTS + MODALS
  // ==========================================================================
  toast(msg, icon = '') {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `${icon ? `<span class="toast-ico">${icon}</span>` : ''}<span>${esc(msg)}</span>`;
    this.toastHost.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 1900);
  },

  modal({ title, body, actions, dismissable = true }) {
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'modal-backdrop';
      back.innerHTML = `
        <div class="modal">
          <h3 class="modal-title">${title}</h3>
          <div class="modal-body">${body}</div>
          <div class="modal-actions">
            ${actions.map((a, i) => `<button class="btn btn-${a.cls || 'ghost'}" data-mi="${i}">${a.label}</button>`).join('')}
          </div>
        </div>`;
      this.modalHost.appendChild(back);
      this._modalResolve = resolve; this._modalEl = back;
      requestAnimationFrame(() => back.classList.add('show'));
      back.addEventListener('click', (e) => {
        const mb = e.target.closest('[data-mi]');
        if (mb) { audio.sfx('click'); const a = actions[+mb.getAttribute('data-mi')]; this._finishModal(a.value !== undefined ? a.value : !!a.confirm); }
        else if (e.target === back && dismissable) { this._finishModal(false); }
      });
    });
  },
  _finishModal(val) {
    const back = this._modalEl, resolve = this._modalResolve;
    if (!back) return;
    this._modalEl = null; this._modalResolve = null;
    back.classList.remove('show');
    setTimeout(() => back.remove(), 220);
    resolve?.(val);
  },
  _closeModal(confirm) { this._finishModal(confirm); },
};
