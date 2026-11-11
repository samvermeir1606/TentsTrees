/* Tents & Trees - UI */
(function () {
  'use strict';
  var TT = window.TT;
  var EMPTY = TT.EMPTY, GRASS = TT.GRASS, TENT = TT.TENT, TREE = TT.TREE;

  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }

  /* ---------- storage (always guarded: can be empty or throw) ---------- */
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };
  var settings = Object.assign({ auto: false, sound: true, timer: true, level: 'easy' }, store.get('tt:settings', {}));
  var stats = Object.assign({ solved: {}, best: {}, daily: {}, hints: 0 }, store.get('tt:stats', {}));
  if (!TT.LEVELS[settings.level]) settings.level = 'easy';

  /* ---------- SVG pieces ---------- */
  var SVG = {
    tree: '<svg viewBox="0 0 100 100" aria-hidden="true">' +
      '<rect class="fill-trunk" x="43" y="60" width="14" height="28" rx="4"/>' +
      '<circle class="fill-tree-leaf2" cx="50" cy="34" r="22"/>' +
      '<circle class="fill-tree-leaf" cx="33" cy="52" r="20"/>' +
      '<circle class="fill-tree-leaf" cx="67" cy="52" r="20"/>' +
      '<circle class="fill-tree-leaf" cx="50" cy="46" r="22"/></svg>',
    tent: '<svg viewBox="0 0 100 100" aria-hidden="true">' +
      '<polygon class="fill-tent" points="50,14 92,84 8,84"/>' +
      '<polygon class="fill-tent2" points="50,14 92,84 62,84"/>' +
      '<polygon class="fill-door" points="50,46 66,84 34,84"/>' +
      '<rect class="fill-tent2" x="48" y="6" width="4" height="14" rx="2"/></svg>',
    grass: '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="fill-dot" cx="50" cy="50" r="8"/></svg>'
  };

  /* ---------- state ---------- */
  var game = null;           // current game
  var els = { cells: [], rows: [], cols: [] };
  var hintTimer = null, checkTimer = null;
  var board = $('#board'), msgEl = $('#msg'), loadingEl = $('#loading');

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function randomSeed() { return Math.random().toString(36).slice(2, 8); }
  function fmtTime(ms) {
    var s = Math.floor(ms / 1000), m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0');
  }

  /* ---------- sound ---------- */
  var ac = null;
  function audio() {
    if (!settings.sound) return null;
    try {
      if (!ac) { var AC = window.AudioContext || window.webkitAudioContext; if (AC) ac = new AC(); }
      if (ac && ac.state === 'suspended') ac.resume();
    } catch (e) { ac = null; }
    return ac;
  }
  function tone(freq, dur, type, delay, vol) {
    var a = audio(); if (!a) return;
    try {
      var t0 = a.currentTime + (delay || 0);
      var o = a.createOscillator(), g = a.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.12, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(a.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    } catch (e) { /* ignore */ }
  }
  var sfx = {
    tent: function () { tone(520, 0.09, 'triangle'); tone(780, 0.09, 'triangle', 0.06); },
    grass: function () { tone(330, 0.06, 'sine', 0, 0.07); },
    clear: function () { tone(240, 0.06, 'sine', 0, 0.06); },
    error: function () { tone(170, 0.22, 'sawtooth', 0, 0.05); },
    hint: function () { tone(660, 0.1, 'sine'); tone(990, 0.14, 'sine', 0.09); },
    ok: function () { tone(600, 0.1, 'triangle'); tone(800, 0.12, 'triangle', 0.08); },
    win: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.22, 'triangle', i * 0.12, 0.13); }); }
  };

  /* ---------- building the board ---------- */
  function buildBoard() {
    var p = game.p, n = p.n;
    board.innerHTML = '';
    board.style.setProperty('--n', n);
    board.style.gridTemplateColumns = 'repeat(' + (n + 1) + ', 1fr)';
    board.classList.remove('won');
    els = { cells: [], rows: [], cols: [] };

    var corner = document.createElement('div'); corner.className = 'corner'; board.appendChild(corner);
    for (var c = 0; c < n; c++) {
      var ce = document.createElement('div'); ce.className = 'clue'; ce.textContent = p.cols[c];
      board.appendChild(ce); els.cols.push(ce);
    }
    for (var r = 0; r < n; r++) {
      var re = document.createElement('div'); re.className = 'clue'; re.textContent = p.rows[r];
      board.appendChild(re); els.rows.push(re);
      for (c = 0; c < n; c++) {
        var i = r * n + c;
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'cell' + ((r + c) % 2 ? ' alt' : '');
        b.dataset.i = i;
        b.setAttribute('role', 'gridcell');
        if (p.trees[i]) { b.classList.add('tree'); b.innerHTML = SVG.tree; b.dataset.m = '3'; }
        board.appendChild(b); els.cells.push(b);
      }
    }
    paint(true);
  }

  var LABELS = { 0: 'empty', 1: 'grass', 2: 'tent', 3: 'tree' };
  function paint(full) {
    var p = game.p, n = p.n, marks = game.marks, i;
    var bad = TT.conflicts(p, marks), badSet = {};
    bad.forEach(function (k) { badSet[k] = 1; });
    for (i = 0; i < p.N; i++) {
      var el = els.cells[i], m = marks[i];
      if (!p.trees[i] && (full || el.dataset.m !== String(m))) {
        el.dataset.m = m;
        el.classList.remove('tent', 'grass');
        if (m === TENT) el.classList.add('tent');
        if (m === GRASS) el.classList.add('grass');
        el.innerHTML = m === TENT ? SVG.tent : m === GRASS ? SVG.grass : '';
      }
      el.classList.toggle('conflict', !!badSet[i]);
      el.setAttribute('aria-label', 'Row ' + ((i / n | 0) + 1) + ', column ' + (i % n + 1) + ': ' + LABELS[p.trees[i] ? 3 : m]);
    }
    var cnt = TT.counts(p, marks);
    for (var k = 0; k < n; k++) {
      els.rows[k].classList.toggle('done', cnt.rows[k] === p.rows[k]);
      els.rows[k].classList.toggle('over', cnt.rows[k] > p.rows[k]);
      els.cols[k].classList.toggle('done', cnt.cols[k] === p.cols[k]);
      els.cols[k].classList.toggle('over', cnt.cols[k] > p.cols[k]);
    }
    $('#btn-undo').disabled = !game.history.length;
    $('#seed').textContent = (game.daily ? 'Daily puzzle ' + game.daily + ' · ' : 'Puzzle ') +
      TT.LEVELS[game.level].name + ' · #' + game.seed;
  }

  function setMsg(text, cls) {
    msgEl.textContent = text;
    msgEl.className = 'msg' + (cls ? ' ' + cls : '');
  }
  function clearHighlights() {
    clearTimeout(hintTimer); clearTimeout(checkTimer);
    $$('.cell.focus, .cell.target, .cell.bad, .clue.focus').forEach(function (e) {
      e.classList.remove('focus', 'target', 'bad');
    });
    $$('.clue.focus').forEach(function (e) { e.classList.remove('focus'); });
  }

  /* ---------- moves ---------- */
  function applyChanges(changes, forward) {
    changes.forEach(function (ch) { game.marks[ch[0]] = forward ? ch[2] : ch[1]; });
  }
  function move(changes) {
    if (!changes.length) return;
    clearHighlights();
    game.history.push(changes);
    applyChanges(changes, true);
    if (!game.started) { game.started = true; game.last = Date.now(); }
    paint(false);
    save();
    if (TT.isWin(game.p, game.marks)) win();
  }
  function tap(i) {
    if (game.won || game.loading) return;
    var p = game.p;
    if (p.trees[i]) {
      els.cells[i].classList.remove('nudge'); void els.cells[i].offsetWidth; els.cells[i].classList.add('nudge');
      return;
    }
    var cur = game.marks[i], next = (cur + 1) % 3, changes = [[i, cur, next]];
    if (next === TENT && settings.auto) {
      p.around[i].forEach(function (j) { if (!p.trees[j] && game.marks[j] === EMPTY) changes.push([j, EMPTY, GRASS]); });
    }
    (next === TENT ? sfx.tent : next === GRASS ? sfx.grass : sfx.clear)();
    if (msgEl.className !== 'msg') setMsg('Give every tree a tent.');   // clear old hint/warning text
    move(changes);
  }
  function undo() {
    if (game.won || !game.history.length) return;
    clearHighlights();
    applyChanges(game.history.pop(), false);
    sfx.clear(); paint(false); save();
    setMsg('Undone.');
  }
  function reset() {
    if (game.won) return;
    var changes = [];
    for (var i = 0; i < game.p.N; i++) if (!game.p.trees[i] && game.marks[i] !== EMPTY) changes.push([i, game.marks[i], EMPTY]);
    if (!changes.length) return;
    sfx.clear(); move(changes);
    setMsg('Board cleared. Undo brings it back.');
  }

  /* ---------- hint / check ---------- */
  function showHint() {
    if (game.won) return;
    clearHighlights();
    var h = TT.hint(game.p, game.marks);
    if (!h) { setMsg('Nothing left to hint, you are done!', 'good'); return; }
    sfx.hint();
    if (h.kind === 'mistake') {
      h.cells.forEach(function (i) { els.cells[i].classList.add('bad'); });
      setMsg(h.why, 'warn');
      hintTimer = setTimeout(clearHighlights, 3500);
      return;
    }
    stats.hints = (stats.hints || 0) + 1; store.set('tt:stats', stats);
    game.hints++;
    (h.focus || []).forEach(function (i) { els.cells[i].classList.add('focus'); });
    if (h.line) {
      var arr = h.line.type === 'row' ? els.rows : els.cols;
      arr[h.line.idx].classList.add('focus');
    }
    // place the hinted mark(s) so progress is made, then point at them
    var targets = h.cells || [h.i], changes = [];
    targets.forEach(function (i) { changes.push([i, game.marks[i], h.v]); });
    game.history.push(changes);
    applyChanges(changes, true);
    if (!game.started) { game.started = true; game.last = Date.now(); }
    paint(false); save();
    targets.forEach(function (i) { els.cells[i].classList.add('target'); });
    setMsg(h.why, 'tip');
    hintTimer = setTimeout(function () {
      $$('.cell.focus, .cell.target, .clue.focus').forEach(function (e) { e.classList.remove('focus', 'target'); });
    }, 4500);
    if (TT.isWin(game.p, game.marks)) win();
  }
  function check() {
    if (game.won) return;
    clearHighlights();
    var bad = TT.mistakes(game.p, game.marks);
    if (bad.length) {
      bad.forEach(function (i) { els.cells[i].classList.add('bad'); });
      sfx.error();
      setMsg(bad.length === 1 ? '1 square looks wrong.' : bad.length + ' squares look wrong.', 'warn');
      checkTimer = setTimeout(clearHighlights, 2500);
    } else {
      sfx.ok();
      setMsg('Everything you have placed so far is right. Keep going!', 'good');
    }
  }

  /* ---------- win ---------- */
  function win() {
    game.won = true;
    tickTimer();
    board.classList.add('won');
    var key = game.level, t = game.elapsed;
    stats.solved[key] = (stats.solved[key] || 0) + 1;
    var newBest = false;
    if (game.hints === 0 && (!stats.best[key] || t < stats.best[key])) { stats.best[key] = t; newBest = true; }
    if (game.daily) stats.daily[game.daily + ':' + game.level] = true;
    store.set('tt:stats', stats);
    save();
    sfx.win();
    setMsg('Solved! Every tree has a tent.', 'good');
    $('#win-text').textContent = 'Solved in ' + fmtTime(t) +
      (game.hints ? ' with ' + game.hints + ' hint' + (game.hints > 1 ? 's' : '') : '') +
      (newBest ? ' — a new best for ' + TT.LEVELS[key].name + '!' : '.');
    confetti();
    setTimeout(function () { if (game && game.won) openOverlay('ov-win'); }, 900);
  }
  function confetti() {
    var colors = ['#f0813f', '#2f9a52', '#f5c93a', '#e5586b', '#4aa3df'];
    for (var i = 0; i < 46; i++) {
      var s = document.createElement('span');
      s.className = 'confetti';
      s.style.left = Math.random() * 100 + 'vw';
      s.style.background = colors[i % colors.length];
      s.style.setProperty('--dx', (Math.random() * 120 - 60) + 'px');
      s.style.animationDelay = Math.random() * 0.6 + 's';
      s.style.animationDuration = 2.2 + Math.random() * 1.6 + 's';
      document.body.appendChild(s);
      setTimeout(function (el) { el.remove(); }.bind(null, s), 4800);
    }
  }

  /* ---------- timer ---------- */
  function tickTimer() {
    if (!game) return;
    var now = Date.now();
    if (game.started && !game.won && !document.hidden && !game.loading) game.elapsed += now - game.last;
    game.last = now;
    $('#timer').textContent = fmtTime(game.elapsed);
  }
  setInterval(tickTimer, 250);
  document.addEventListener('visibilitychange', function () { tickTimer(); if (document.hidden) save(); });

  /* ---------- saving / loading ---------- */
  function save() {
    if (!game || game.loading) return;
    store.set('tt:game', {
      v: 1, level: game.level, seed: game.seed, daily: game.daily || null,
      marks: Array.prototype.join.call(game.marks, ''), sig: Array.prototype.join.call(game.p.trees, ''),
      elapsed: game.elapsed, won: game.won, hints: game.hints, started: game.started
    });
  }

  function startGame(level, seed, daily, restore) {
    clearHighlights();
    closeOverlays();
    settings.level = level; store.set('tt:settings', settings);
    renderLevels();
    loadingEl.hidden = false;
    game = { loading: true, level: level, seed: seed, daily: daily || null, history: [], elapsed: 0, started: false, won: false, hints: 0, last: Date.now() };
    board.style.opacity = '.35';
    setTimeout(function () {
      var p = TT.generate(level, seed);
      var marks = new Uint8Array(p.N);
      for (var i = 0; i < p.N; i++) if (p.trees[i]) marks[i] = TREE;
      game = { loading: false, level: level, seed: seed, daily: daily || null, p: p, marks: marks, history: [], elapsed: 0, started: false, won: false, hints: 0, last: Date.now() };
      if (restore && restore.sig === Array.prototype.join.call(p.trees, '') && restore.marks.length === p.N) {
        for (i = 0; i < p.N; i++) if (!p.trees[i]) marks[i] = Math.min(2, +restore.marks[i] || 0);
        game.elapsed = restore.elapsed || 0; game.hints = restore.hints || 0; game.started = !!restore.started;
      }
      loadingEl.hidden = true; board.style.opacity = '';
      buildBoard();
      var msg = daily ? 'Daily puzzle for ' + daily + '. Give every tree a tent.' : 'Give every tree a tent.';
      setMsg(restore && game.started ? 'Welcome back! Pick up where you left off.' : msg);
      $('#timer').textContent = fmtTime(game.elapsed);
      if (!restore) save();
    }, 30);
  }
  function newRandom() { startGame(settings.level, randomSeed(), null, null); }
  function startDaily() { startGame(settings.level, 'daily-' + todayStr(), todayStr(), null); }

  /* ---------- levels, toggles, overlays ---------- */
  function renderLevels() {
    var box = $('#levels'); box.innerHTML = '';
    TT.LEVEL_ORDER.forEach(function (id) {
      var L = TT.LEVELS[id], b = document.createElement('button');
      b.type = 'button'; b.setAttribute('aria-pressed', String(settings.level === id));
      b.innerHTML = '<b>' + L.name + '</b><small>' + L.n + '×' + L.n + '</small>';
      b.addEventListener('click', function () { if (settings.level !== id || game.won) startGame(id, randomSeed(), null, null); });
      box.appendChild(b);
    });
  }
  function syncToggles() {
    $('#tg-auto').setAttribute('aria-pressed', String(settings.auto));
    $('#tg-sound').setAttribute('aria-pressed', String(settings.sound));
    $('#tg-timer').setAttribute('aria-pressed', String(settings.timer));
    $('#timer').classList.toggle('hidden', !settings.timer);
  }
  function toggle(key) { settings[key] = !settings[key]; store.set('tt:settings', settings); syncToggles(); if (key === 'sound' && settings.sound) sfx.ok(); }

  function openOverlay(id) { $('#' + id).classList.add('show'); }
  function closeOverlays() { $$('.overlay.show').forEach(function (o) { o.classList.remove('show'); }); }

  function openStats() {
    var rows = TT.LEVEL_ORDER.map(function (id) {
      var L = TT.LEVELS[id];
      return '<div class="stat-row"><span>' + L.name + ' ' + L.n + '×' + L.n + '</span><b>' + (stats.solved[id] || 0) + ' solved' +
        (stats.best[id] ? ' · best ' + fmtTime(stats.best[id]) : '') + '</b></div>';
    });
    var daily = Object.keys(stats.daily).length;
    rows.push('<div class="stat-row"><span>Daily puzzles done</span><b>' + daily + '</b></div>');
    rows.push('<div class="stat-row"><span>Hints used</span><b>' + (stats.hints || 0) + '</b></div>');
    $('#stats-body').innerHTML = rows.join('');
    openOverlay('ov-stats');
  }

  function buildDemo() {
    var d = $('#demo'); if (d.children.length) return;
    var rows = [1, 0, 2, 0], cols = [1, 1, 0, 1];
    var trees = { 0: 1, 12: 1, 7: 1 }, tents = { 1: 'dt', 8: 'dt2', 11: 'dt3' };
    var h = '<div class="dc dn"></div>';
    cols.forEach(function (c) { h += '<div class="dc dn">' + c + '</div>'; });
    for (var r = 0; r < 4; r++) {
      h += '<div class="dc dn">' + rows[r] + '</div>';
      for (var c = 0; c < 4; c++) {
        var i = r * 4 + c;
        h += '<div class="dc ' + (tents[i] || '') + '">' + (trees[i] ? SVG.tree : tents[i] ? SVG.tent : '') + '</div>';
      }
    }
    d.innerHTML = h;
  }

  function share() {
    var url = location.origin + location.pathname + '?level=' + game.level + '&seed=' + encodeURIComponent(game.seed);
    if (location.protocol === 'file:') url = location.href.split('?')[0] + '?level=' + game.level + '&seed=' + encodeURIComponent(game.seed);
    if (navigator.share) {
      navigator.share({ title: 'Tents & Trees', text: 'Try this Tents & Trees puzzle!', url: url }).catch(function () {});
      return;
    }
    var done = function () { setMsg('Link copied. Anyone who opens it gets this exact puzzle.', 'good'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { setMsg(url); });
    else setMsg(url);
  }

  /* ---------- events ---------- */
  board.addEventListener('click', function (e) {
    var el = e.target.closest('.cell'); if (!el) return;
    tap(+el.dataset.i);
  });
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-hint').addEventListener('click', showHint);
  $('#btn-check').addEventListener('click', check);
  $('#btn-reset').addEventListener('click', reset);
  $('#btn-new').addEventListener('click', newRandom);
  $('#btn-daily').addEventListener('click', startDaily);
  $('#btn-share').addEventListener('click', share);
  $('#btn-how').addEventListener('click', function () { buildDemo(); openOverlay('ov-how'); });
  $('#btn-stats').addEventListener('click', openStats);
  $('#tg-auto').addEventListener('click', function () { toggle('auto'); });
  $('#tg-sound').addEventListener('click', function () { toggle('sound'); });
  $('#tg-timer').addEventListener('click', function () { toggle('timer'); });
  $('#win-next').addEventListener('click', newRandom);
  $$('[data-close]').forEach(function (b) { b.addEventListener('click', closeOverlays); });
  $$('.overlay').forEach(function (o) { o.addEventListener('click', function (e) { if (e.target === o) closeOverlays(); }); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeOverlays();
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
  });

  /* ---------- boot ---------- */
  syncToggles();
  renderLevels();

  var params = new URLSearchParams(location.search);
  if (params.get('test')) {
    var out = $('#test-out'); out.hidden = false; out.textContent = 'Running self-test…\n';
    setTimeout(function () {
      var lines = [];
      TT.selfTest(parseInt(params.get('test'), 10) > 1 ? parseInt(params.get('test'), 10) : 10, function (m) { lines.push(m); });
      out.textContent = lines.join('\n');
      out.dataset.done = '1';
    }, 50);
  } else if (params.get('seed')) {
    var lv = TT.LEVELS[params.get('level')] ? params.get('level') : settings.level;
    var sv = store.get('tt:game', null);
    var same = sv && sv.v === 1 && !sv.won && sv.level === lv && String(sv.seed) === params.get('seed');
    startGame(lv, params.get('seed'), null, same ? sv : null);
  } else {
    var saved = store.get('tt:game', null);
    if (saved && saved.v === 1 && !saved.won && TT.LEVELS[saved.level]) startGame(saved.level, saved.seed, saved.daily, saved);
    else startGame(settings.level, randomSeed(), null, null);
  }

  window.__tt = { get game() { return game; }, tap: tap };   // handy for testing

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
