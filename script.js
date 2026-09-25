(() => {
  'use strict';

  const SIZE = 4;
  const START_VALUE = 3;
  const TARGET = 3072;
  const TURN_SECONDS = 4.0;
  const STORAGE_KEY = '3072-best-score-v1';
  const SOUND_KEY = '3072-sound-v1';

  const boardEl = document.getElementById('board');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const timerEl = document.getElementById('timer');
  const timerCard = document.getElementById('timerCard');
  const progressFill = document.getElementById('progressFill');
  const comboBadge = document.getElementById('comboBadge');
  const effectLayer = document.getElementById('effectLayer');
  const messageLayer = document.getElementById('messageLayer');
  const restartBtn = document.getElementById('restartBtn');
  const soundBtn = document.getElementById('soundBtn');
  const helpBtn = document.getElementById('helpBtn');
  const modalBackdrop = document.getElementById('modalBackdrop');
  const modalClose = document.getElementById('modalClose');
  const modalStart = document.getElementById('modalStart');

  let grid = [];
  let score = 0;
  let best = loadNumber(STORAGE_KEY, 0);
  let timer = TURN_SECONDS;
  let lastTick = 0;
  let rafId = 0;
  let gameOver = false;
  let won = false;
  let keepPlaying = true;
  let combo = 1;
  let comboResetTimer = null;
  let soundEnabled = loadNumber(SOUND_KEY, 1) === 1;
  let audioCtx = null;
  let touchStart = null;
  let inputLocked = false;

  const tiles = [];

  function loadNumber(key, fallback) {
    try {
      const value = Number(localStorage.getItem(key));
      return Number.isFinite(value) ? value : fallback;
    } catch (_) { return fallback; }
  }

  function saveNumber(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (_) {}
  }

  function makeEmptyGrid() {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  }

  function initBoardSlots() {
    boardEl.innerHTML = '';
    tiles.length = 0;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const slot = document.createElement('div');
        slot.className = 'slot';
        slot.setAttribute('role', 'gridcell');
        slot.dataset.r = String(r);
        slot.dataset.c = String(c);
        boardEl.appendChild(slot);
        tiles.push(slot);
      }
    }
  }

  function newGame() {
    clearMessage();
    grid = makeEmptyGrid();
    score = 0;
    timer = TURN_SECONDS;
    lastTick = performance.now();
    gameOver = false;
    won = false;
    keepPlaying = true;
    combo = 1;
    inputLocked = false;
    addRandomTile();
    addRandomTile();
    render();
    updateHud();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(clockLoop);
    playTone('start');
  }

  function clockLoop(now) {
    if (!gameOver) {
      const delta = Math.min(0.1, (now - lastTick) / 1000);
      lastTick = now;
      timer = Math.max(0, timer - delta);
      if (timer <= 0) {
        timer = 0;
        updateHud();
        endGame('TEMPS ÉCOULÉ', 'Ton cerveau doit repartir plus vite.');
        return;
      }
      updateTimerOnly();
    } else {
      lastTick = now;
    }
    rafId = requestAnimationFrame(clockLoop);
  }

  function emptyCells() {
    const cells = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) if (grid[r][c] == null) cells.push([r, c]);
    }
    return cells;
  }

  function addRandomTile() {
    const cells = emptyCells();
    if (!cells.length) return false;
    const [r, c] = cells[Math.floor(Math.random() * cells.length)];
    grid[r][c] = START_VALUE;
    return true;
  }

  function cloneGrid(input) {
    return input.map(row => row.slice());
  }

  function arraysEqual(a, b) {
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (a[r][c] !== b[r][c]) return false;
    return true;
  }

  function slideAndMergeLine(line) {
    const compact = line.filter(v => v != null);
    const out = [];
    const merges = [];
    let gained = 0;
    let mergedCount = 0;

    for (let i = 0; i < compact.length; i++) {
      const current = compact[i];
      if (compact[i + 1] === current) {
        const merged = current * 2;
        out.push(merged);
        merges.push(merged);
        gained += merged;
        mergedCount++;
        i++;
      } else {
        out.push(current);
      }
    }
    while (out.length < SIZE) out.push(null);
    return { line: out, gained, merges, mergedCount };
  }

  function move(direction) {
    if (gameOver || inputLocked) return false;

    const before = cloneGrid(grid);
    let totalGained = 0;
    let totalMerges = 0;
    const mergeValues = [];

    if (direction === 'left' || direction === 'right') {
      for (let r = 0; r < SIZE; r++) {
        let line = grid[r].slice();
        if (direction === 'right') line.reverse();
        const result = slideAndMergeLine(line);
        if (direction === 'right') result.line.reverse();
        grid[r] = result.line;
        totalGained += result.gained;
        totalMerges += result.mergedCount;
        mergeValues.push(...result.merges);
      }
    } else {
      for (let c = 0; c < SIZE; c++) {
        let line = [];
        for (let r = 0; r < SIZE; r++) line.push(grid[r][c]);
        if (direction === 'down') line.reverse();
        const result = slideAndMergeLine(line);
        if (direction === 'down') result.line.reverse();
        for (let r = 0; r < SIZE; r++) grid[r][c] = result.line[r];
        totalGained += result.gained;
        totalMerges += result.mergedCount;
        mergeValues.push(...result.merges);
      }
    }

    if (arraysEqual(before, grid)) {
      boardEl.classList.remove('is-shaking');
      void boardEl.offsetWidth;
      boardEl.classList.add('is-shaking');
      playTone('blocked');
      if (!canMove()) endGame('GRILLE PLEINE', 'Plus aucun mouvement possible.');
      return false;
    }

    score += totalGained;
    if (score > best) { best = score; saveNumber(STORAGE_KEY, best); }

    timer = TURN_SECONDS;
    lastTick = performance.now();
    combo = totalMerges > 0 ? Math.min(99, combo + totalMerges) : 1;
    if (comboResetTimer) clearTimeout(comboResetTimer);
    comboResetTimer = setTimeout(() => { combo = 1; updateHud(); }, 1150);

    addRandomTile();
    render();
    updateHud();
    animateMerges(mergeValues);

    if (totalMerges > 0) {
      const highest = Math.max(...mergeValues);
      playTone(highest >= 192 ? 'mega' : 'merge');
      if (highest >= 48) spawnBurst(highest >= TARGET ? 'TARGET' : highest >= 768 ? 'MEGA!' : 'NICE!');
      showPlus(totalGained);
      if (navigator.vibrate) navigator.vibrate(highest >= 768 ? [18, 25, 28] : 10);
    } else {
      playTone('move');
    }

    if (!won && grid.flat().includes(TARGET)) {
      won = true;
      showMessage('🏆 3072 ATTEINT', 'Tu peux continuer pour battre ton record.');
      playTone('win');
    }

    if (!keepPlaying && won) return true;
    if (!canMove()) endGame('GAME OVER', 'La grille est verrouillée.');
    return true;
  }

  function canMove() {
    if (emptyCells().length > 0) return true;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const v = grid[r][c];
        if (r < SIZE - 1 && grid[r + 1][c] === v) return true;
        if (c < SIZE - 1 && grid[r][c + 1] === v) return true;
      }
    }
    return false;
  }

  function render() {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const slot = tiles[r * SIZE + c];
        slot.replaceChildren();
        const value = grid[r][c];
        if (value != null) {
          const tile = document.createElement('div');
          tile.className = `tile v${value}` + (value >= 768 ? ' mega' : '');
          tile.textContent = String(value);
          tile.setAttribute('aria-label', `Tuile ${value}`);
          slot.appendChild(tile);
        }
      }
    }
  }

  function animateMerges(values) {
    const set = new Set(values);
    document.querySelectorAll('.tile').forEach(tile => {
      const numeric = Number(tile.textContent);
      if (set.has(numeric)) {
        tile.classList.add('merge');
      }
    });
  }

  function spawnBurst(label) {
    const center = document.createElement('div');
    center.className = 'tile-burst';
    const labelEl = document.createElement('div');
    labelEl.className = 'plus-score';
    labelEl.textContent = label;
    effectLayer.append(center, labelEl);
    setTimeout(() => { center.remove(); labelEl.remove(); }, 750);
  }

  function showPlus(points) {
    const el = document.createElement('div');
    el.className = 'plus-score';
    el.textContent = `+${points}`;
    effectLayer.appendChild(el);
    setTimeout(() => el.remove(), 750);
  }

  function showMessage(title, subtitle) {
    clearMessage();
    const box = document.createElement('div');
    box.className = 'message';
    box.innerHTML = `<h3>${escapeHtml(title)}</h3><p>${escapeHtml(subtitle)}</p>`;
    messageLayer.appendChild(box);
  }

  function clearMessage() { messageLayer.replaceChildren(); }

  function endGame(title, subtitle) {
    if (gameOver) return;
    gameOver = true;
    inputLocked = false;
    showMessage(title, `${subtitle} Score : ${format(score)}.`);
    playTone('over');
    boardEl.classList.add('is-shaking');
    cancelAnimationFrame(rafId);
  }

  function updateHud() {
    scoreEl.textContent = format(score);
    bestEl.textContent = format(best);
    comboBadge.textContent = `COMBO ×${combo}`;
    comboBadge.classList.remove('pop');
    void comboBadge.offsetWidth;
    if (combo > 1) comboBadge.classList.add('pop');
    updateTimerOnly();
    const highest = Math.max(...grid.flat().filter(Boolean), START_VALUE);
    const pct = Math.min(100, Math.log2(highest / START_VALUE + 1) / Math.log2(TARGET / START_VALUE + 1) * 100);
    progressFill.style.width = `${Math.max(0, pct)}%`;
  }

  function updateTimerOnly() {
    timerEl.textContent = timer.toFixed(1);
    timerCard.classList.toggle('urgent', timer <= 1.2 && !gameOver);
    timerCard.style.setProperty('--timer-scale', String(timer / TURN_SECONDS));
    timerCard.style.setProperty('transform-origin', 'left center');
    timerCard.style.setProperty('--unused', '0');
    const pseudo = timerCard;
    pseudo.style.setProperty('--timer-progress', String(Math.max(0, Math.min(1, timer / TURN_SECONDS))));
    // Width is handled with a CSS scale on the bottom bar through an inline variable.
    timerCard.style.setProperty('--bar-scale', String(Math.max(0, Math.min(1, timer / TURN_SECONDS))));
    timerCard.classList.toggle('expired', timer <= 0);
  }

  function format(number) { return Math.floor(number).toLocaleString('fr-FR'); }
  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[ch])); }

  function ensureAudio() {
    if (!soundEnabled) return null;
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { return null; }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  function playTone(kind) {
    const ctx = ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const configs = {
      start: [[280, .05, 'sine'], [420, .06, 'sine']],
      move: [[160, .025, 'triangle']],
      blocked: [[90, .08, 'sawtooth']],
      merge: [[280, .045, 'triangle'], [420, .07, 'triangle']],
      mega: [[360, .055, 'triangle'], [540, .07, 'triangle'], [720, .11, 'sine']],
      win: [[480, .07, 'sine'], [720, .08, 'sine'], [960, .14, 'sine']],
      over: [[250, .08, 'sawtooth'], [120, .15, 'sawtooth']]
    };
    const seq = configs[kind] || configs.move;
    seq.forEach(([freq, duration, type], i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now + i * .055);
      gain.gain.setValueAtTime(0.0001, now + i * .055);
      gain.gain.exponentialRampToValueAtTime(kind === 'move' ? 0.035 : 0.07, now + i * .055 + .008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * .055 + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * .055);
      osc.stop(now + i * .055 + duration + .02);
    });
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    saveNumber(SOUND_KEY, soundEnabled ? 1 : 0);
    soundBtn.textContent = soundEnabled ? '🔊' : '🔇';
    soundBtn.setAttribute('aria-pressed', String(soundEnabled));
    if (soundEnabled) playTone('start');
  }

  function openHelp() { modalBackdrop.hidden = false; modalClose.focus(); }
  function closeHelp() { modalBackdrop.hidden = true; }

  function onKeyDown(event) {
    const map = { ArrowLeft:'left', ArrowRight:'right', ArrowUp:'up', ArrowDown:'down', a:'left', d:'right', w:'up', s:'down', A:'left', D:'right', W:'up', S:'down' };
    const direction = map[event.key];
    if (!direction) return;
    event.preventDefault();
    move(direction);
  }

  function onTouchStart(event) {
    const t = event.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  }

  function onTouchEnd(event) {
    if (!touchStart) return;
    const t = event.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    touchStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 'right' : 'left');
    else move(dy > 0 ? 'down' : 'up');
  }

  restartBtn.addEventListener('click', newGame);
  soundBtn.addEventListener('click', toggleSound);
  helpBtn.addEventListener('click', openHelp);
  modalClose.addEventListener('click', closeHelp);
  modalStart.addEventListener('click', () => { closeHelp(); newGame(); });
  modalBackdrop.addEventListener('click', (event) => { if (event.target === modalBackdrop) closeHelp(); });
  document.addEventListener('keydown', onKeyDown, { passive: false });
  boardEl.addEventListener('touchstart', onTouchStart, { passive: true });
  boardEl.addEventListener('touchend', onTouchEnd, { passive: true });
  window.addEventListener('pointerdown', () => { if (soundEnabled) ensureAudio(); }, { once: true });

  // Initial UI state.
  initBoardSlots();
  soundBtn.textContent = soundEnabled ? '🔊' : '🔇';
  soundBtn.setAttribute('aria-pressed', String(soundEnabled));
  bestEl.textContent = format(best);
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
    }, { once: true });
  }
  openHelp();
  newGame();
})();
