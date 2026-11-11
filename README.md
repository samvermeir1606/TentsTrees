# Tents & Trees

A small logic puzzle for phones and browsers. Give every tree a tent:

1. Each tree gets exactly one tent right next to it (up, down, left or right).
2. Tents never touch each other, not even corner to corner.
3. The numbers say how many tents are in each row and column.

Tap a square once for grass (a dot), twice for a tent, three times to clear it.

No build step, no dependencies: plain HTML, CSS and JavaScript.

## Put it online with GitHub Pages

1. Create a new repository on GitHub (or use an existing one).
2. Upload these files so that `index.html` sits at the top of the repository
   (or inside a subfolder such as `tents-and-trees/` if the repo hosts other things).
3. Repository **Settings → Pages → Build and deployment**: Source = *Deploy from a branch*,
   Branch = `main`, folder = `/ (root)`. Save.
4. After a minute the site is live at `https://<your-name>.github.io/<repo-name>/`.

## Install on a phone

- **iPhone (Safari):** open the site, tap Share, then **Add to Home Screen**.
- **Android (Chrome):** menu, then **Install app** / **Add to Home screen**.

It works offline after the first visit.

## Good to know

- Puzzles are generated on the device from a seed, and every puzzle has exactly one solution.
  The puzzle number at the bottom (`#abc123`) can be shared with the Share button.
- Tiny/Easy/Medium puzzles can always be solved by pure logic, no guessing.
- Progress, settings and stats are saved in the browser (localStorage).
- **After you change any file**, bump `VERSION` in `sw.js` (e.g. `tents-trees-v2`) so phones pick up the update.
- Self-test: open `index.html?test=10` in a browser, or run `node tools/selftest.js 20`.

## Files

| File | What it does |
| --- | --- |
| `index.html`, `style.css` | Page and look |
| `engine.js` | Puzzle generator, solver, hints |
| `game.js` | Board, taps, undo, timer, sounds, saving |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and home-screen app |
| `tools/selftest.js` | Optional automated check of the engine |
