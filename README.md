# 🍉🏒 Fruit Hockey

A juicy take on air hockey where the puck is a **fruit**. Built as a fast,
installable **Progressive Web App** — pure HTML5 Canvas + vanilla JavaScript,
**no build step, no backend, fully offline-capable**. Open it on your phone and
play.

> Status: **Front-end complete.** Online multiplayer is fully playable against
> locally-simulated opponents (matchmaking, ranks, VS screen and all). Swapping
> in a real server later is a contained change — see [Roadmap](#-roadmap).

---

## ✨ Features

**Game modes**
- 🤖 **Single Player** — 5 AI difficulties (Rookie → Legend)
- 👬 **Local 2-Player** — two players, one device, simultaneous multi-touch
- 🏆 **Ranked** — ELO-style Rank Points, climb Bronze → Grandmaster
- 🌐 **Quick Match** — casual online play for coins
- ⏱️ **Time Attack** — most goals in 90 seconds
- ❤️ **Survival** — endless, ramping CPU; how long can you last?
- ⚡ **Sudden Death** — first goal wins
- 🍒 **Multi-Fruit Madness** — three pucks at once

**Systems**
- 🍓 **Fruit physics** — every puck (watermelon, lemon, grapes, coconut, dragon
  fruit…) has its own size, glide, bounce and weight, so it genuinely plays
  differently
- 🛒 **Shop** — unlock fruit pucks, mallet skins, table themes and avatars with
  earned coins; rarities from Common to Legendary
- 📈 **Progression** — XP, levels, coins, level-up rewards
- 🏅 **Ranks & leaderboard** — tiers, divisions, RP gains/losses, peak RP
- 👤 **Profile & stats** — wins, losses, win-rate, goals, streaks, loadout
- 🔊 **Procedurally synthesised** sound effects + optional music (zero audio
  files), 📳 haptics, goal celebrations, particles, screen shake
- 💾 Everything persists locally (localStorage); works **100% offline**

---

## ▶️ Run it

It's static files — no install, no compiler. You just need to serve the folder
over HTTP (ES modules don't load from `file://`).

```bash
# from the repo root
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static server works (`npx serve`, `php -S localhost:8000`, the VS Code
"Live Server" extension, etc.).

### 📱 Play on your phone

**Easiest — GitHub Pages (a public URL you can open anywhere):**
1. Push this repo to GitHub.
2. Repo **Settings → Pages → Build and deployment → Source: “GitHub Actions”**.
3. The included workflow (`.github/workflows/deploy.yml`) publishes the site on
   every push and prints the live URL.
4. Open that URL on your phone → tap the browser menu → **Add to Home Screen**
   for the full standalone-app experience.

**On your local network:** run the server above and visit
`http://<your-computer-ip>:8000` from your phone (same Wi-Fi).

---

## 🎮 Controls

- **Drag** your finger on **your half** of the table to move your mallet.
- **Flick** into the puck to smash — faster swipe = harder shot.
- **Local 2-player** uses both ends at once; the top player's HUD is flipped so
  it reads correctly from across the table.

---

## 🗂️ Project structure

```
index.html              App shell (canvas + HUD + screen containers)
manifest.webmanifest    PWA manifest (installable, portrait)
service-worker.js       Offline app-shell cache
css/styles.css          Entire design system + game HUD
assets/icon.svg         App icon (vector)
js/
  data.js               Fruits, mallets, tables, avatars, ranks, AI tuning
  storage.js            Versioned localStorage save + economy/stats mutators
  audio.js              Web Audio procedural SFX, music, haptics
  ai.js                 AI opponent (predict / defend / attack)
  matchmaking.js        Simulated online opponent generation
  game.js               Engine: fixed-timestep physics, input, render, FX
  ui.js                 Screens, navigation, shop, HUD, match flow, rewards
  main.js               Bootstrap + service-worker registration
.github/workflows/deploy.yml   Auto-deploy to GitHub Pages
```

### Tuning the feel
Almost everything is data-driven. Want a faster game or a beefier puck? Edit the
fruit stats in **`js/data.js`** (`glide`, `bounce`, `push`, `maxSpeed`, `r`) or
the global constants at the top of **`js/game.js`** (`PUCK_MAX`, `HUMAN_MAX`,
`AI_MAX`, `GOAL_W`). AI behaviour lives in `DIFFICULTIES` in `data.js`.

---

## 🛣️ Roadmap

The front end is intentionally decoupled from any server. To go truly online:

- Replace `generateOpponent()` in **`js/matchmaking.js`** with a real
  matchmaking/WebSocket call.
- Add lightweight net-sync to the `Game` loop (the engine already runs a
  deterministic fixed timestep, which helps).
- Move the save blob in **`js/storage.js`** behind an account/cloud sync.
- Server-authoritative ranks/economy to prevent tampering.

Other nice-to-haves: tournaments, daily challenges, friend matches, more
fruit/table content, power-ups.

---

🍉 Made for fun. Have a juicy match!
