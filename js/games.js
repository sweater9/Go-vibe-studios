/* Go Vibe Studios — game library: built-in games + user-added embeds */
(() => {
  const $ = (id) => document.getElementById(id);
  const modal = $('modal'), body = $('mbody');
  let cleanup = null;

  /* ---------------- Snake ---------------- */
  function snake(root) {
    const N = 20, S = 20, c = document.createElement('canvas'); c.setAttribute('role', 'img'); c.setAttribute('aria-label', 'Snake game board');
    c.width = c.height = N * S; root.appendChild(c);
    const g = c.getContext('2d');
    let snk, dir, nxt, food, score, over, timer;
    const rnd = () => ({ x: Math.floor(Math.random() * N), y: Math.floor(Math.random() * N) });
    function reset() { snk = [{ x: 10, y: 10 }]; dir = nxt = { x: 1, y: 0 }; food = rnd(); score = 0; over = false; }
    function tick() {
      if (over) return draw();
      dir = nxt;
      const h = { x: snk[0].x + dir.x, y: snk[0].y + dir.y };
      if (h.x < 0 || h.y < 0 || h.x >= N || h.y >= N || snk.some((s) => s.x === h.x && s.y === h.y)) { over = true; return draw(); }
      snk.unshift(h);
      if (h.x === food.x && h.y === food.y) { score++; food = rnd(); } else snk.pop();
      draw();
    }
    function draw() {
      g.fillStyle = '#07070f'; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#fb7185'; g.fillRect(food.x * S + 2, food.y * S + 2, S - 4, S - 4);
      g.fillStyle = '#22d3ee'; snk.forEach((s, i) => { g.fillStyle = i ? '#22d3ee' : '#8b5cf6'; g.fillRect(s.x * S + 1, s.y * S + 1, S - 2, S - 2); });
      g.fillStyle = '#fff'; g.font = '14px system-ui'; g.fillText('Score ' + score, 8, 16);
      if (over) { g.font = '22px system-ui'; g.textAlign = 'center'; g.fillText('Game over — press Space', c.width / 2, c.height / 2); g.textAlign = 'left'; }
    }
    const key = (e) => {
      const m = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] }[e.key];
      if (m) { e.preventDefault(); if (m[0] !== -dir.x || m[1] !== -dir.y) nxt = { x: m[0], y: m[1] }; }
      if (e.code === 'Space' && over) { e.preventDefault(); reset(); }
    };
    let tx = 0, ty = 0;
    c.addEventListener('pointerdown', (e) => { tx = e.clientX; ty = e.clientY; if (over) reset(); });
    c.addEventListener('pointerup', (e) => {
      const dx = e.clientX - tx, dy = e.clientY - ty;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;
      const m = Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
      if (m[0] !== -dir.x || m[1] !== -dir.y) nxt = { x: m[0], y: m[1] };
    });
    addEventListener('keydown', key);
    reset(); timer = setInterval(tick, 110);
    const hint = document.createElement('p'); hint.className = 'status'; hint.textContent = 'Arrow keys / WASD, or swipe on the board.'; root.appendChild(hint);
    return () => { clearInterval(timer); removeEventListener('keydown', key); };
  }

  /* ---------------- Memory match ---------------- */
  function memory(root) {
    const icons = ['🎧', '🎮', '🎹', '🥁', '🎸', '🎤', '🎺', '🎻'];
    const deck = [...icons, ...icons].sort(() => Math.random() - 0.5);
    const grid = document.createElement('div'); grid.className = 'mem-grid';
    const info = document.createElement('p'); info.className = 'status'; info.style.textAlign = 'center';
    let first = null, lock = false, moves = 0, found = 0;
    deck.forEach((ic) => {
      const b = document.createElement('button'); b.className = 'mem-card'; b.textContent = '?';
      b.onclick = () => {
        if (lock || b.classList.contains('up') || b.classList.contains('done')) return;
        b.textContent = ic; b.classList.add('up');
        if (!first) { first = b; return; }
        moves++; const a = first; first = null;
        if (a.textContent === ic) { a.className = b.className = 'mem-card done'; found++; if (found === icons.length) info.textContent = 'You won in ' + moves + ' moves! 🎉'; }
        else { lock = true; setTimeout(() => { [a, b].forEach((x) => { x.className = 'mem-card'; x.textContent = '?'; }); lock = false; }, 700); }
        if (found < icons.length) info.textContent = 'Moves: ' + moves;
      };
      grid.appendChild(b);
    });
    info.textContent = 'Find all the pairs.';
    root.append(grid, info);
    return () => {};
  }

  /* ---------------- Breakout ---------------- */
  function breakout(root) {
    const W = 480, H = 360, c = document.createElement('canvas'); c.setAttribute('role', 'img'); c.setAttribute('aria-label', 'Breakout game board'); c.width = W; c.height = H; root.appendChild(c);
    const g = c.getContext('2d');
    let px = W / 2, ball, bricks, lives, score, vx, vy, raf, running = true, msg = 'Move the mouse / finger, click to launch';
    const rows = 5, cols = 10, bw = W / cols, bh = 18;
    function setup() {
      bricks = []; for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) bricks.push({ x: q * bw, y: 40 + r * bh, alive: true, hue: 260 - r * 30 });
      lives = 3; score = 0; serve();
    }
    function serve() { ball = { x: px, y: H - 40 }; vx = 0; vy = 0; }
    function launch() { if (vx === 0 && vy === 0) { vx = 3 * (Math.random() < .5 ? -1 : 1); vy = -4; msg = ''; } }
    function step() {
      if (!running) return;
      if (vx === 0 && vy === 0) ball.x = px, ball.y = H - 40;
      ball.x += vx; ball.y += vy;
      if (ball.x < 6 || ball.x > W - 6) vx = -vx;
      if (ball.y < 6) vy = -vy;
      if (vy > 0 && ball.y > H - 30 && ball.y < H - 18 && Math.abs(ball.x - px) < 45) { vy = -Math.abs(vy); vx = (ball.x - px) / 12; }
      if (ball.y > H) { lives--; if (lives <= 0) { msg = 'Game over — click to restart'; setup(); } else serve(); }
      for (const b of bricks) if (b.alive && ball.x > b.x && ball.x < b.x + bw && ball.y > b.y && ball.y < b.y + bh) { b.alive = false; vy = -vy; score++; break; }
      if (bricks.every((b) => !b.alive)) { msg = 'You cleared it! 🎉 Click to play again'; setup(); }
      draw(); raf = requestAnimationFrame(step);
    }
    function draw() {
      g.fillStyle = '#07070f'; g.fillRect(0, 0, W, H);
      bricks.forEach((b) => { if (b.alive) { g.fillStyle = 'hsl(' + b.hue + ' 80% 60%)'; g.fillRect(b.x + 1, b.y + 1, bw - 2, bh - 2); } });
      g.fillStyle = '#8b5cf6'; g.fillRect(px - 45, H - 24, 90, 8);
      g.fillStyle = '#fff'; g.beginPath(); g.arc(ball.x, ball.y, 6, 0, 7); g.fill();
      g.font = '14px system-ui'; g.fillText('Score ' + score + '   Lives ' + lives, 8, 18);
      if (msg) { g.textAlign = 'center'; g.fillText(msg, W / 2, H / 2 + 60); g.textAlign = 'left'; }
    }
    const mv = (e) => { const r = c.getBoundingClientRect(); px = Math.max(45, Math.min(W - 45, (e.clientX - r.left) / r.width * W)); };
    c.addEventListener('pointermove', mv); c.addEventListener('pointerdown', (e) => { mv(e); launch(); });
    setup(); step();
    return () => { running = false; cancelAnimationFrame(raf); };
  }

  const BUILTIN = [
    { id: 'snake', name: 'Snake', emoji: '🐍', desc: 'Classic. Eat, grow, don\'t crash.', run: snake },
    { id: 'memory', name: 'Memory Match', emoji: '🧠', desc: 'Flip cards and find the music pairs.', run: memory },
    { id: 'breakout', name: 'Breakout', emoji: '🧱', desc: 'Bounce the ball and clear the bricks.', run: breakout }
  ];

  /* ---------------- embeds (localStorage) ---------------- */
  const KEY = 'govibe.embeds';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (_) { return []; } };
  const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (_) {} };

  function open(title, mount) {
    $('mtitle').textContent = title; body.innerHTML = ''; modal.classList.remove('hidden');
    cleanup = mount(body) || null;
  }
  function close() { if (cleanup) cleanup(); cleanup = null; body.innerHTML = ''; modal.classList.add('hidden'); }
  $('mclose').onclick = close;
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) close(); });

  function card(emoji, name, desc, onPlay, onRemove) {
    const d = document.createElement('div'); d.className = 'card';
    const e = document.createElement('div'); e.className = 'emoji'; e.textContent = emoji;
    const h = document.createElement('h2'); h.textContent = name;
    const p = document.createElement('p'); p.textContent = desc;
    const r = document.createElement('div'); r.className = 'row';
    const b = document.createElement('button'); b.className = 'btn primary'; b.textContent = '▶ Play'; b.onclick = onPlay; r.appendChild(b);
    if (onRemove) { const x = document.createElement('button'); x.className = 'btn danger'; x.textContent = 'Remove'; x.onclick = onRemove; r.appendChild(x); }
    d.append(e, h, p, r); return d;
  }

  function render() {
    const list = $('list'); list.innerHTML = '';
    BUILTIN.forEach((gm) => list.appendChild(card(gm.emoji, gm.name, gm.desc, () => open(gm.name, gm.run))));
    load().forEach((gm, i) => list.appendChild(card('🌐', gm.name, 'Embedded game (added by you)', () => {
      open(gm.name, (root) => {
        const f = document.createElement('iframe');
        f.src = gm.url; f.allow = 'fullscreen; autoplay; gamepad';
        f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-pointer-lock allow-forms');
        f.referrerPolicy = 'no-referrer';
        root.appendChild(f);
      });
    }, () => { const v = load(); v.splice(i, 1); save(v); render(); })));
  }

  $('gadd').onclick = () => {
    const name = $('gname').value.trim(), url = $('gurl').value.trim();
    let u; try { u = new URL(url); } catch (_) { return alert('Enter a valid URL.'); }
    if (u.protocol !== 'https:') return alert('Only https:// URLs are allowed.');
    if (!name) return alert('Give the game a name.');
    const v = load(); v.push({ name: name.slice(0, 60), url: u.href }); save(v);
    $('gname').value = $('gurl').value = ''; render();
  };

  render();
})();
