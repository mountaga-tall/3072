(() => {
  'use strict';

  const SIZE = 4;
  const START_VALUE = 3;
  const TARGET = 3072;
  const TURN_SECONDS = 4;
  const STORAGE_KEY = '3072-best-score-v2';
  const SOUND_KEY = '3072-sound-v2';
  const TUTORIAL_KEY = '3072-tutorial-seen-v2';
  const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NUMBER_FORMAT = new Intl.NumberFormat('fr-FR');

  const boardEl = document.getElementById('board');
  const boardWrap = document.getElementById('boardWrap');
  const scoreEl = document.getElementById('score');
  const scoreCard = document.getElementById('scoreCard');
  const bestEl = document.getElementById('best');
  const bestCard = document.getElementById('bestCard');
  const timerEl = document.getElementById('timer');
  const timerCard = document.getElementById('timerCard');
  const progressTrack = document.getElementById('progressTrack');
  const progressFill = document.getElementById('progressFill');
  const comboBadge = document.getElementById('comboBadge');
  const effectLayer = document.getElementById('effectLayer');
  const messageLayer = document.getElementById('messageLayer');
  const gameStatusEl = document.getElementById('gameStatus');
  const restartBtn = document.getElementById('restartBtn');
  const soundBtn = document.getElementById('soundBtn');
  const soundIcon = soundBtn.querySelector('.icon-sound');
  const helpBtn = document.getElementById('helpBtn');
  const modalBackdrop = document.getElementById('modalBackdrop');
  const modal = modalBackdrop.querySelector('.modal');
  const modalClose = document.getElementById('modalClose');
  const modalStart = document.getElementById('modalStart');

  let grid = makeEmptyGrid();
  let score = 0;
  let best = loadNumber(STORAGE_KEY, 0);
  let timer = TURN_SECONDS;
  let lastTick = 0;
  let rafId = 0;
  let gameOver = false;
  let won = false;
  let paused = false;
  let combo = 1;
  let comboResetTimer = null;
  let soundEnabled = loadNumber(SOUND_KEY, 1) === 1;
  let audioCtx = null;
  let pointerStart = null;
  let modalOpen = false;
  let lastFocusedElement = null;
  let lastTimerText = '';
  let mergeFxTimer = null;

  function loadNumber(key, fallback) {
    try {
      const value = Number(localStorage.getItem(key));
      return Number.isFinite(value) ? value : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function loadBoolean(key, fallback = false) {
    try {
      const value = localStorage.getItem(key);
      return value == null ? fallback : value === '1';
    } catch (_) {
      return fallback;
    }
  }

  function saveValue(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (_) {}
  }

  function makeEmptyGrid() {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  }

  function format(number) {
    return NUMBER_FORMAT.format(Math.max(0, Math.floor(number)));
  }

  function initBoardSlots() {
    boardEl.replaceChildren();
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const slot = document.createElement('div');
        slot.className = 'slot';
        slot.setAttribute('role', 'gridcell');
        slot.setAttribute('aria-rowindex', String(r + 1));
        slot.setAttribute('aria-colindex', String(c + 1));
        slot.dataset.r = String(r);
        slot.dataset.c = String(c);
        boardEl.appendChild(slot);
      }
    }
  }

  function getSlot(r, c) {
    return boardEl.children[r * SIZE + c];
  }

  function emptyCells() {
    const cells = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (grid[r][c] == null) cells.push([r, c]);
      }
    }
    return cells;
  }

  function addRandomTile() {
    const cells = emptyCells();
    if (!cells.length) return null;
    const [r, c] = cells[Math.floor(Math.random() * cells.length)];
    grid[r][c] = START_VALUE;
    return { r, c };
  }

  function cloneGrid(input) {
    return input.map(row => row.slice());
  }

  function arraysEqual(a, b) {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (a[r][c] !== b[r][c]) return false;
      }
    }
    return true;
  }

  function slideAndMergeLine(line) {
    const compact = line.filter(value => value != null);
    const out = [];
    const merges = [];
    let gained = 0;

    for (let i = 0; i < compact.length; i++) {
      const current = compact[i];
      if (compact[i + 1] === current) {
        const merged = current * 2;
        const outputIndex = out.length;
        out.push(merged);
        merges.push({ index: outputIndex, value: merged });
        gained += merged;
        i++;
      } else {
        out.push(current);
      }
    }

    while (out.length < SIZE) out.push(null);
    return { line: out, gained, merges };
  }

  function transformGrid(direction) {
    const before = cloneGrid(grid);
    let totalGained = 0;
    let totalMerges = 0;
    const mergeCells = [];

    if (direction === 'left' || direction === 'right') {
      for (let r = 0; r < SIZE; r++) {
        let line = grid[r].slice();
        if (direction === 'right') line.reverse();
        const result = slideAndMergeLine(line);
        const processedMerges = result.merges;
        if (direction === 'right') result.line.reverse();
        grid[r] = result.line;
        totalGained += result.gained;
        totalMerges += processedMerges.length;
        processedMerges.forEach(({ index, value }) => {
          mergeCells.push({ r, c: direction === 'right' ? SIZE - 1 - index : index, value });
        });
      }
    } else {
      for (let c = 0; c < SIZE; c++) {
        let line = [];
        for (let r = 0; r < SIZE; r++) line.push(grid[r][c]);
        if (direction === 'down') line.reverse();
        const result = slideAndMergeLine(line);
        const processedMerges = result.merges;
        if (direction === 'down') result.line.reverse();
        for (let r = 0; r < SIZE; r++) grid[r][c] = result.line[r];
        totalGained += result.gained;
        totalMerges += processedMerges.length;
        processedMerges.forEach(({ index, value }) => {
          mergeCells.push({ r: direction === 'down' ? SIZE - 1 - index : index, c, value });
        });
      }
    }

    return { changed: !arraysEqual(before, grid), totalGained, totalMerges, mergeCells };
  }

  function canMove() {
    if (emptyCells().length) return true;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const value = grid[r][c];
        if (r < SIZE - 1 && grid[r + 1][c] === value) return true;
        if (c < SIZE - 1 && grid[r][c + 1] === value) return true;
      }
    }
    return false;
  }

  function render({ direction = null, spawnCell = null, mergeCells = [] } = {}) {
    const mergeKeys = new Set(mergeCells.map(cell => `${cell.r}:${cell.c}`));
    const directionClass = direction ? `move-${direction}` : '';

    boardEl.classList.remove('move-left', 'move-right', 'move-up', 'move-down', 'is-shaking');
    if (directionClass && !REDUCE_MOTION) {
      void boardEl.offsetWidth;
      boardEl.classList.add(directionClass);
    }

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const slot = getSlot(r, c);
        slot.replaceChildren();
        const value = grid[r][c];
        if (value == null) {
          slot.setAttribute('aria-label', `Case vide, ligne ${r + 1}, colonne ${c + 1}`);
          continue;
        }

        const tile = document.createElement('div');
        tile.className = `tile v${value}` + (value >= 768 ? ' mega' : '');
        tile.textContent = String(value);
        tile.dataset.value = String(value);
        tile.setAttribute('aria-label', `Tuile ${value}, ligne ${r + 1}, colonne ${c + 1}`);

        if (spawnCell && spawnCell.r === r && spawnCell.c === c) tile.classList.add('tile-new');
        else if (direction && !mergeKeys.has(`${r}:${c}`) && !REDUCE_MOTION) tile.classList.add(`tile-arrive-${direction}`);
        if (mergeKeys.has(`${r}:${c}`) && !REDUCE_MOTION) tile.classList.add('merge');

        slot.setAttribute('aria-label', `Tuile ${value}, ligne ${r + 1}, colonne ${c + 1}`);
        slot.appendChild(tile);
      }
    }
  }

  function resetComboTimer() {
    if (comboResetTimer) clearTimeout(comboResetTimer);
    comboResetTimer = setTimeout(() => {
      combo = 1;
      updateHud();
    }, 1300);
  }

  function move(direction) {
    if (gameOver || paused || modalOpen) return false;

    const result = transformGrid(direction);
    if (!result.changed) {
      boardEl.classList.remove('is-shaking');
      void boardEl.offsetWidth;
      if (!REDUCE_MOTION) boardEl.classList.add('is-shaking');
      playTone('blocked');
      announce('Aucun mouvement possible dans cette direction.');
      if (!canMove()) endGame('GRILLE BLOQUÉE', 'Plus aucun mouvement possible.');
      return false;
    }

    const previousBest = best;
    score += result.totalGained;
    if (score > best) {
      best = score;
      saveValue(STORAGE_KEY, best);
    }

    timer = TURN_SECONDS;
    lastTick = performance.now();
    combo = result.totalMerges > 0 ? Math.min(99, combo + result.totalMerges) : 1;
    resetComboTimer();

    const spawnCell = addRandomTile();
    render({ direction, spawnCell, mergeCells: result.mergeCells });
    updateHud();

    if (!REDUCE_MOTION) {
      boardWrap.classList.remove('impact', 'mega-impact');
      void boardWrap.offsetWidth;
      boardWrap.classList.add(result.mergeCells.some(cell => cell.value >= 768) ? 'mega-impact' : 'impact');
    }

    if (result.totalMerges > 0) {
      playTone(Math.max(...result.mergeCells.map(cell => cell.value)) >= 192 ? 'mega' : 'merge');
      spawnMergeEffects(result.mergeCells);
      showPlusCluster(result.mergeCells);
      if (navigator.vibrate) {
        try { navigator.vibrate(Math.max(...result.mergeCells.map(cell => cell.value)) >= 768 ? [18, 24, 34] : 9); } catch (_) {}
      }
    } else {
      playTone('move');
    }

    if (score > previousBest) {
      bump(bestCard, 'record-bump');
      announce('Nouveau meilleur score.');
    }

    const highest = getHighestTile();
    if (!won && highest >= TARGET) {
      won = true;
      showWinCelebration();
      showMessage('🏆 3072 ATTEINT', 'Tu peux continuer pour battre ton record.', 2200);
      playTone('win');
      announce('Objectif 3072 atteint. Tu peux continuer la partie.');
    }

    if (!canMove()) endGame('GAME OVER', 'La grille est verrouillée.');
    return true;
  }

  function getHighestTile() {
    return Math.max(START_VALUE, ...grid.flat().filter(value => Number.isFinite(value)));
  }

  function bump(element, className) {
    if (!element || REDUCE_MOTION) return;
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
  }

  function updateHud() {
    const scoreText = format(score);
    const bestText = format(best);
    if (scoreEl.textContent !== scoreText) bump(scoreCard, 'score-bump');
    scoreEl.textContent = scoreText;
    bestEl.textContent = bestText;
    comboBadge.textContent = `COMBO ×${combo}`;
    comboBadge.classList.remove('pop');
    if (combo > 1 && !REDUCE_MOTION) {
      void comboBadge.offsetWidth;
      comboBadge.classList.add('pop');
    }

    updateTimerOnly(true);

    const highest = getHighestTile();
    const pct = Math.min(100, Math.max(0, (Math.log2(highest / START_VALUE) / Math.log2(TARGET / START_VALUE)) * 100));
    progressFill.style.width = `${pct}%`;
    progressTrack.setAttribute('aria-valuenow', String(Math.round(pct)));
    progressTrack.setAttribute('aria-valuetext', `${Math.round(pct)} % vers 3072, meilleure tuile ${highest}`);
  }

  function updateTimerOnly(force = false) {
    const safeTimer = Math.max(0, timer);
    const text = safeTimer.toFixed(1);
    if (force || text !== lastTimerText) {
      timerEl.textContent = text;
      lastTimerText = text;
    }
    const ratio = Math.max(0, Math.min(1, safeTimer / TURN_SECONDS));
    timerCard.style.setProperty('--bar-scale', String(ratio));
    timerCard.classList.toggle('urgent', safeTimer <= 1.2 && safeTimer > 0 && !gameOver && !paused);
    timerCard.classList.toggle('expired', safeTimer <= 0);
    timerEl.setAttribute('aria-label', `${text} secondes restantes`);
  }

  function clearMessage() {
    messageLayer.replaceChildren();
    messageLayer.classList.remove('interactive');
  }

  function showMessage(title, subtitle, duration = 1700) {
    clearMessage();
    const box = document.createElement('div');
    box.className = 'message toast-message';
    const titleEl = document.createElement('h3');
    titleEl.textContent = title;
    const subtitleEl = document.createElement('p');
    subtitleEl.textContent = subtitle;
    box.append(titleEl, subtitleEl);
    messageLayer.appendChild(box);
    if (mergeFxTimer) clearTimeout(mergeFxTimer);
    mergeFxTimer = setTimeout(() => {
      if (messageLayer.contains(box)) clearMessage();
    }, duration);
  }

  function endGame(title, subtitle) {
    if (gameOver) return;
    gameOver = true;
    paused = false;
    cancelAnimationFrame(rafId);
    rafId = 0;
    updateTimerOnly(true);
    clearMessage();

    const box = document.createElement('div');
    box.className = 'message end-message';
    const titleEl = document.createElement('h3');
    titleEl.textContent = title;
    const subtitleEl = document.createElement('p');
    subtitleEl.textContent = `${subtitle} Score : ${format(score)}.`;
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'message-action';
    action.textContent = 'REJOUER';
    action.addEventListener('click', () => {
      clearMessage();
      newGame({ sound: true, focusBoard: true });
    });
    box.append(titleEl, subtitleEl, action);
    messageLayer.appendChild(box);
    messageLayer.classList.add('interactive');
    boardEl.classList.remove('is-shaking');
    if (!REDUCE_MOTION) {
      void boardEl.offsetWidth;
      boardEl.classList.add('is-shaking');
    }
    playTone('over');
    announce(`${title}. ${subtitle}`);
    action.focus({ preventScroll: true });
  }

  function spawnMergeEffects(mergeCells) {
    mergeCells.forEach(({ r, c, value }) => {
      const slot = getSlot(r, c);
      if (!slot) return;
      const ring = document.createElement('span');
      ring.className = 'tile-burst';
      const core = document.createElement('span');
      core.className = `merge-core ${value >= 768 ? 'merge-core-mega' : ''}`;
      const particleNodes = [];
      const particles = document.createDocumentFragment();
      const count = value >= 768 ? 12 : value >= 48 ? 8 : 5;
      for (let i = 0; i < count; i++) {
        const particle = document.createElement('span');
        particle.className = 'particle';
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.18;
        const distance = 22 + Math.random() * (value >= 768 ? 38 : 26);
        particle.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
        particle.style.setProperty('--dy', `${Math.sin(angle) * distance}px`);
        particle.style.setProperty('--delay', `${Math.random() * 0.08}s`);
        particleNodes.push(particle);
        particles.appendChild(particle);
      }
      slot.append(ring, core, particles);
      const ttl = REDUCE_MOTION ? 100 : 780;
      window.setTimeout(() => {
        ring.remove();
        core.remove();
        particleNodes.forEach(node => node.remove());
      }, ttl);
    });
  }

  function showPlusCluster(mergeCells) {
    mergeCells.forEach(({ r, c, value }) => {
      const slot = getSlot(r, c);
      if (!slot) return;
      const label = document.createElement('span');
      label.className = 'plus-score';
      label.textContent = `+${format(value)}`;
      slot.appendChild(label);
      window.setTimeout(() => label.remove(), REDUCE_MOTION ? 120 : 760);
    });
  }

  function showWinCelebration() {
    boardWrap.classList.remove('target-hit');
    if (!REDUCE_MOTION) {
      void boardWrap.offsetWidth;
      boardWrap.classList.add('target-hit');
    }
    const count = REDUCE_MOTION ? 0 : 24;
    for (let i = 0; i < count; i++) {
      const piece = document.createElement('span');
      piece.className = 'confetti-piece';
      piece.style.setProperty('--left', `${8 + Math.random() * 84}%`);
      piece.style.setProperty('--drift', `${-80 + Math.random() * 160}px`);
      piece.style.setProperty('--rot', `${Math.random() * 720 - 360}deg`);
      piece.style.setProperty('--hue', String(Math.floor(175 + Math.random() * 150)));
      piece.style.setProperty('--delay', `${Math.random() * 0.16}s`);
      effectLayer.appendChild(piece);
      window.setTimeout(() => piece.remove(), 1600);
    }
  }

  function announce(message) {
    gameStatusEl.textContent = '';
    window.setTimeout(() => { gameStatusEl.textContent = message; }, 0);
  }

  function clearEffects() {
    effectLayer.replaceChildren();
    boardWrap.classList.remove('impact', 'mega-impact', 'target-hit');
  }

  function newGame({ sound = false, focusBoard = false } = {}) {
    if (comboResetTimer) clearTimeout(comboResetTimer);
    clearMessage();
    clearEffects();
    grid = makeEmptyGrid();
    score = 0;
    timer = TURN_SECONDS;
    lastTick = performance.now();
    gameOver = false;
    won = false;
    paused = false;
    combo = 1;
    pointerStart = null;
    lastTimerText = '';
    addRandomTile();
    const second = addRandomTile();
    render({ spawnCell: second });
    updateHud();
    startClock();
    announce('Nouvelle partie. Glisse ou utilise les flèches pour jouer.');
    if (sound) playTone('start');
    if (focusBoard) boardEl.focus({ preventScroll: true });
  }

  function startClock() {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(clockLoop);
  }

  function clockLoop(now) {
    if (gameOver) {
      rafId = 0;
      return;
    }

    if (paused) {
      lastTick = now;
      rafId = requestAnimationFrame(clockLoop);
      return;
    }

    const delta = Math.max(0, (now - lastTick) / 1000);
    lastTick = now;
    timer = Math.max(0, timer - delta);
    updateTimerOnly();

    if (timer <= 0) {
      endGame('TEMPS ÉCOULÉ', 'Ton cerveau doit repartir plus vite.');
      return;
    }

    rafId = requestAnimationFrame(clockLoop);
  }

  function ensureAudio() {
    if (!soundEnabled) return null;
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (_) {
        return null;
      }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  function playTone(kind) {
    const ctx = ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const configs = {
      start: [[280, .05, 'sine'], [420, .06, 'sine'], [560, .08, 'sine']],
      move: [[155, .026, 'triangle']],
      blocked: [[95, .075, 'sawtooth']],
      merge: [[280, .045, 'triangle'], [420, .075, 'triangle']],
      mega: [[360, .05, 'triangle'], [540, .07, 'triangle'], [720, .11, 'sine']],
      win: [[480, .07, 'sine'], [720, .08, 'sine'], [960, .13, 'sine'], [1200, .16, 'sine']],
      over: [[250, .08, 'sawtooth'], [120, .15, 'sawtooth']]
    };
    const sequence = configs[kind] || configs.move;

    sequence.forEach(([frequency, duration, type], index) => {
      const start = now + index * 0.055;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(kind === 'move' ? 0.032 : 0.065, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
    });
  }

  function updateSoundUi() {
    soundIcon.textContent = soundEnabled ? '🔊' : '🔇';
    soundBtn.setAttribute('aria-pressed', String(soundEnabled));
    soundBtn.setAttribute('aria-label', soundEnabled ? 'Désactiver le son' : 'Activer le son');
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    saveValue(SOUND_KEY, soundEnabled ? 1 : 0);
    updateSoundUi();
    if (soundEnabled) playTone('start');
    announce(soundEnabled ? 'Son activé.' : 'Son coupé.');
  }

  function openHelp() {
    if (modalOpen) return;
    lastFocusedElement = document.activeElement;
    modalOpen = true;
    if (!gameOver) {
      paused = true;
      lastTick = performance.now();
    }
    modalBackdrop.hidden = false;
    document.body.classList.add('modal-open');
    modalClose.focus({ preventScroll: true });
  }

  function closeHelp() {
    if (!modalOpen) return;
    modalOpen = false;
    modalBackdrop.hidden = true;
    document.body.classList.remove('modal-open');
    if (!gameOver) {
      paused = false;
      lastTick = performance.now();
      startClock();
    }
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      lastFocusedElement.focus({ preventScroll: true });
    }
  }

  function focusableInModal() {
    return [...modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(el => !el.disabled);
  }

  function handleModalKeydown(event) {
    if (!modalOpen) return false;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeHelp();
      return true;
    }
    if (event.key === 'Tab') {
      const focusable = focusableInModal();
      if (!focusable.length) return true;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return true;
    }
    return false;
  }

  function onKeyDown(event) {
    if (handleModalKeydown(event)) return;
    if (modalOpen) return;

    const map = {
      ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
      a: 'left', d: 'right', w: 'up', s: 'down',
      A: 'left', D: 'right', W: 'up', S: 'down'
    };
    const direction = map[event.key];
    if (!direction) return;
    event.preventDefault();
    move(direction);
  }

  function onPointerDown(event) {
    if (modalOpen || gameOver) return;
    pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
    try { boardEl.setPointerCapture(event.pointerId); } catch (_) {}
  }

  function onPointerUp(event) {
    if (!pointerStart) return;
    const start = pointerStart;
    pointerStart = null;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const distance = Math.max(Math.abs(dx), Math.abs(dy));
    if (distance < 26) return;
    if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 'right' : 'left');
    else move(dy > 0 ? 'down' : 'up');
  }

  function onPointerCancel() {
    pointerStart = null;
  }

  function onBoardPointerMove(event) {
    if (event.pointerType !== 'mouse') return;
    const rect = boardWrap.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    boardWrap.style.setProperty('--mx', `${Math.max(0, Math.min(100, x))}%`);
    boardWrap.style.setProperty('--my', `${Math.max(0, Math.min(100, y))}%`);
    boardWrap.classList.add('pointer-hover');
  }

  function onBoardPointerLeave() {
    boardWrap.classList.remove('pointer-hover');
  }

  function onVisibilityChange() {
    if (document.hidden || gameOver || modalOpen) return;
    paused = false;
    lastTick = performance.now();
    clearMessage();
    startClock();
  }

  function pauseWhenHidden() {
    if (!document.hidden || gameOver) return;
    paused = true;
    lastTick = performance.now();
    showMessage('⏸ PARTIE EN PAUSE', 'Reviens sur cet onglet pour reprendre.', 1000000);
    updateTimerOnly(true);
  }

  restartBtn.addEventListener('click', () => newGame({ sound: true, focusBoard: true }));
  soundBtn.addEventListener('click', toggleSound);
  helpBtn.addEventListener('click', openHelp);
  modalClose.addEventListener('click', closeHelp);
  modalStart.addEventListener('click', () => {
    closeHelp();
    newGame({ sound: true, focusBoard: true });
  });
  modalBackdrop.addEventListener('click', event => {
    if (event.target === modalBackdrop) closeHelp();
  });
  document.addEventListener('keydown', onKeyDown, { passive: false });
  boardEl.addEventListener('pointerdown', onPointerDown);
  boardEl.addEventListener('pointerup', onPointerUp);
  boardEl.addEventListener('pointercancel', onPointerCancel);
  boardEl.addEventListener('pointerleave', onBoardPointerLeave);
  boardEl.addEventListener('pointermove', onBoardPointerMove);
  document.addEventListener('visibilitychange', pauseWhenHidden);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pointerdown', () => { if (soundEnabled) ensureAudio(); }, { once: true, passive: true });

  initBoardSlots();
  updateSoundUi();
  bestEl.textContent = format(best);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
    }, { once: true });
  }

  newGame({ sound: false, focusBoard: false });
  if (!loadBoolean(TUTORIAL_KEY, false)) {
    saveValue(TUTORIAL_KEY, 1);
    openHelp();
  }
})();
