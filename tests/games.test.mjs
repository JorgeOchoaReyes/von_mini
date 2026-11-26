// Rules for the built-in games, played deterministically. Run with `npm test` (Node runs the
// TypeScript module directly).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/games/logic.ts';

/** Small deterministic random source (mulberry32). */
function seeded(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Runs `tick` for `seconds` at `fps`. */
function run(state, tick, seconds, fps = 60, each) {
  let s = state;
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames && !s.over; i++) {
    s = tick(s, 1 / fps);
    each?.(s, i);
  }
  return s;
}

const finite = (o) => JSON.stringify(o, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? assert.fail(`${k} is ${v}`) : v));

/* ------------------------------- shared ------------------------------- */

test('substeps splits a frame into steps no longer than the limit', () => {
  for (const dt of [0, 1 / 240, 1 / 120, 1 / 60, 1 / 30, 0.1, 5]) {
    const { n, h } = G.substeps(dt);
    if (dt === 0) {
      assert.equal(n, 0);
      continue;
    }
    assert.ok(h <= G.STEP + 1e-12, `h ${h} for dt ${dt}`);
    assert.ok(Math.abs(n * h - Math.min(dt, G.MAX_FRAME)) < 1e-12);
  }
});

/* ---------------------------- falling blocks ---------------------------- */

const blocksAt = (shapeId, x, y, board) => {
  const s = G.newBlocks(seeded(3));
  const piece = { ...G.spawn(shapeId), x, y };
  return { ...s, piece, board: board ?? s.board };
};

test('every shape returns to itself after four turns either way, and turns stay in its box', () => {
  for (const shape of G.SHAPES) {
    let cw = shape;
    let ccw = shape;
    for (let i = 0; i < 4; i++) {
      cw = G.rotate(cw, 1);
      ccw = G.rotate(ccw, -1);
      assert.equal(cw.flat().filter(Boolean).length, 4);
    }
    assert.deepEqual(cw, shape);
    assert.deepEqual(ccw, shape);
    assert.deepEqual(G.rotate(G.rotate(shape, 1), -1), shape);
  }
});

test('pieces spawn centred with their top row on the board', () => {
  for (let id = 0; id < 7; id++) {
    const p = G.spawn(id);
    const cells = [];
    p.shape.forEach((row, r) => row.forEach((v, c) => v && cells.push([p.x + c, p.y + r])));
    assert.equal(Math.min(...cells.map(([, y]) => y)), 0, `shape ${id}`);
    const xs = cells.map(([x]) => x);
    assert.ok(Math.min(...xs) >= 3 && Math.max(...xs) <= 6, `shape ${id} centred`);
  }
});

test('the bag deals each of the seven shapes once per seven pieces', () => {
  let s = G.newBlocks(seeded(7));
  const seen = [s.piece.id];
  const rng = seeded(8);
  for (let i = 0; i < 27; i++) {
    s = G.blocksHold({ ...s, canHold: true, hold: null }, rng); // cheap way to advance a piece
    seen.push(s.piece.id);
  }
  for (let b = 0; b + 7 <= seen.length; b += 7) assert.deepEqual([...seen.slice(b, b + 7)].sort(), [0, 1, 2, 3, 4, 5, 6]);
});

test('a turn against the wall kicks the piece in instead of failing', () => {
  // Long piece standing vertically against the right wall.
  const s = blocksAt(0, 0, 0);
  const upright = { ...s, piece: { ...s.piece, shape: G.rotate(s.piece.shape, 1), x: G.BLOCKS_W - 3 } };
  assert.ok(!G.collides(upright.board, upright.piece));
  const turned = G.blocksRotate(upright, 1);
  assert.notDeepEqual(turned.piece.shape, upright.piece.shape, 'it turned');
  assert.ok(!G.collides(turned.board, turned.piece));
});

test('a landed piece waits for the lock delay, and sliding resets it up to a limit', () => {
  let s = blocksAt(2, 4, G.BLOCKS_H - 2); // T resting on the floor
  assert.ok(G.collides(s.board, { ...s.piece, y: s.piece.y + 1 }), 'on the floor');
  s = G.blocksTick(s, 0.3, 1, seeded(1));
  assert.equal(s.piece.y, G.BLOCKS_H - 2, 'not locked yet');
  s = G.blocksMove(s, 1);
  assert.equal(s.lockT, 0, 'moving resets the delay');
  s = G.blocksTick(s, 0.3, 1, seeded(1));
  assert.equal(s.board.filter(Boolean).length, 0, 'still not locked');
  // Keep wiggling: after MAX_RESETS the delay stops resetting and the piece locks.
  let locked = false;
  for (let i = 0; i < 40 && !locked; i++) {
    s = G.blocksMove(s, i % 2 ? 1 : -1);
    s = G.blocksTick(s, 0.1, 1, seeded(1));
    locked = s.board.some(Boolean);
  }
  assert.ok(locked, 'locks eventually');
});

test('hard drop locks at once and scores 2 a row; soft drop scores 1 a row', () => {
  const s = blocksAt(1, 4, 0);
  const dropped = G.blocksDrop(s, seeded(2));
  assert.equal(dropped.score, (G.BLOCKS_H - 2) * 2);
  assert.equal(dropped.board.filter(Boolean).length, 4);
  let soft = G.blocksSoft(blocksAt(1, 4, 0), true);
  soft = G.blocksTick(soft, 0.1, 1, seeded(2));
  assert.ok(soft.piece.y >= 3 && soft.score === soft.piece.y, `soft ${soft.piece.y} rows, ${soft.score} points`);
});

test('clearing rows scores by level, combos add up, and four rows back to back pay more', () => {
  // Board with the bottom four rows full except column 0; a vertical long piece fills them.
  const board = Array(G.BLOCKS_W * G.BLOCKS_H).fill(0);
  for (let y = G.BLOCKS_H - 4; y < G.BLOCKS_H; y++) for (let x = 1; x < G.BLOCKS_W; x++) board[y * G.BLOCKS_W + x] = 3;
  const base = blocksAt(0, 0, 0, board);
  const upright = { ...base, piece: { ...base.piece, shape: G.rotate(base.piece.shape, 1), x: -2 } };
  assert.ok(!G.collides(board, upright.piece));
  const quad = G.blocksDrop(upright, seeded(4));
  assert.equal(quad.lines, 4);
  assert.deepEqual(quad.clearedRows, [16, 17, 18, 19]);
  assert.ok(quad.b2b);
  assert.equal(quad.score, 800 + 2000 + (G.BLOCKS_H - 4) * 2, 'four rows + perfect clear + drop');
  assert.equal(quad.combo, 0);
  assert.ok(quad.fx.some((f) => f.text?.includes('PERFECT')));
  assert.equal(quad.buzz, 'heavy');
});

test('hold swaps once per piece and keeps the preview queue intact', () => {
  const s = G.newBlocks(seeded(5));
  const first = s.piece.id;
  const queue = s.queue;
  const held = G.blocksHold(s, seeded(6));
  assert.equal(held.hold, first);
  assert.equal(held.piece.id, queue[0]);
  assert.equal(held.canHold, false);
  assert.deepEqual(G.blocksHold(held, seeded(6)).piece, held.piece, 'second hold does nothing');
  // After a lock, hold swaps back without touching the queue.
  const dropped = G.blocksDrop(held, seeded(6));
  assert.ok(dropped.canHold);
  const swapped = G.blocksHold(dropped, seeded(6));
  assert.equal(swapped.piece.id, first);
  assert.deepEqual(swapped.queue, dropped.queue);
});

test('stacking to the top ends the game', () => {
  let s = G.newBlocks(seeded(9));
  for (let i = 0; i < 200 && !s.over; i++) s = G.blocksDrop(s, seeded(i));
  assert.ok(s.over);
  finite(s);
});

test('falling blocks survive a long fuzz with random input', () => {
  const rng = seeded(11);
  let s = G.newBlocks(rng);
  for (let i = 0; i < 20000 && !s.over; i++) {
    const r = rng();
    if (r < 0.1) s = G.blocksMove(s, -1);
    else if (r < 0.2) s = G.blocksMove(s, 1);
    else if (r < 0.25) s = G.blocksRotate(s, rng() < 0.5 ? 1 : -1);
    else if (r < 0.27) s = G.blocksHold(s, rng);
    else if (r < 0.28) s = G.blocksDrop(s, rng);
    else if (r < 0.3) s = G.blocksSoft(s, rng() < 0.5);
    s = G.blocksTick(s, 1 / 60, 1, rng);
    assert.ok(!G.collides(s.board, s.piece) || s.over, 'piece never overlaps the board');
  }
  finite(s);
});

/* ------------------------------ lane runner ------------------------------ */

test('the runner always leaves a lane open, and coins never sit on obstacles', () => {
  let s = G.newRunner();
  const rng = seeded(12);
  for (let i = 0; i < 60 * 120; i++) {
    s = G.runnerTick({ ...s, over: false }, 1 / 60, 1, rng);
    const rows = new Map();
    for (const o of s.obstacles) rows.set(o.id - (o.id % 1), o);
    // Obstacles spawned together share a y.
    const byY = new Map();
    for (const o of s.obstacles) byY.set(o.y.toFixed(6), (byY.get(o.y.toFixed(6)) ?? 0) + 1);
    for (const count of byY.values()) assert.ok(count < G.LANES);
    for (const c of s.coins) assert.ok(!s.obstacles.some((o) => o.lane === c.lane && Math.abs(o.y - c.y) < 0.1));
  }
});

test('the runner plays the same at 30 and 120 frames a second', () => {
  const a = run(G.newRunner(), (s, dt) => G.runnerTick(s, dt, 1, () => 0.99), 6, 30);
  const b = run(G.newRunner(), (s, dt) => G.runnerTick(s, dt, 1, () => 0.99), 6, 120);
  assert.ok(Math.abs(a.distance - b.distance) < 1e-6, `${a.distance} vs ${b.distance}`);
});

test('the runner eases between lanes and picks up coins', () => {
  let s = G.runnerMove(G.newRunner(), 1);
  assert.equal(s.lane, 2);
  s = G.runnerTick(s, 1 / 60, 1, seeded(1));
  assert.ok(s.x > 1 && s.x < 2);
  s = { ...s, coins: [{ id: 99, lane: 2, y: G.RUNNER_Y - 0.01 }], obstacles: [] };
  s = G.runnerTick(s, 1 / 60, 1, () => 0.99);
  assert.equal(s.bonus, 25);
  assert.ok(s.fx.some((f) => f.text === '+25'));
});

/* --------------------------------- snake --------------------------------- */

test('snake grows, keeps smooth-motion history, and food never lands on it', () => {
  const rng = seeded(13);
  let s = G.newSnake(rng);
  for (let i = 0; i < 5000 && !s.over; i++) {
    // Steer toward the food, avoiding an immediate reverse.
    const [hx, hy] = s.body[0];
    const [fx, fy] = s.food;
    const want = fx > hx ? 'right' : fx < hx ? 'left' : fy > hy ? 'down' : 'up';
    s = G.snakeTurn(s, want);
    s = G.snakeStep(s, rng);
    assert.equal(s.prev.length, s.body.length);
    if (s.food) assert.ok(!s.body.some(([x, y]) => x === s.food[0] && y === s.food[1]));
  }
  assert.ok(s.eaten > 5, `ate ${s.eaten}`);
});

test('filling the board wins', () => {
  // A body that fills every cell but one, with the food in that cell, right in front of the head.
  const body = [];
  for (let y = 0; y < G.SNAKE_N; y++) for (let x = 0; x < G.SNAKE_N; x++) body.push([y % 2 ? G.SNAKE_N - 1 - x : x, y]);
  const food = body.shift(); // free cell (0,0); head is at (1,0) moving left
  const s = { ...G.newSnake(seeded(1)), body, prev: body, dir: 'left', queue: [], food };
  const next = G.snakeStep(s, seeded(1));
  assert.ok(next.won && next.over);
  assert.equal(next.food, null);
});

test('snake turns can be queued but never reverse into itself', () => {
  let s = G.newSnake(seeded(1));
  s = G.snakeTurn(s, 'left');
  assert.deepEqual(s.queue, []);
  s = G.snakeTurn(G.snakeTurn(s, 'up'), 'left');
  assert.deepEqual(s.queue, ['up', 'left']);
});

/* --------------------------------- flyer --------------------------------- */

test('the flyer falls the same at any frame rate, and the ceiling does not end the run', () => {
  const start = G.flyerFlap(G.newFlyer());
  const a = run(start, (s, dt) => G.flyerTick(s, dt, 1, () => 0.5), 0.6, 30);
  const b = run(start, (s, dt) => G.flyerTick(s, dt, 1, () => 0.5), 0.6, 144);
  assert.ok(Math.abs(a.y - b.y) < 0.01, `${a.y} vs ${b.y}`);
  let s = start;
  for (let i = 0; i < 30; i++) s = G.flyerTick(G.flyerFlap(s), 1 / 60, 1, () => 0.5);
  assert.ok(!s.over || s.y > 0.5, 'flapping into the ceiling is not a crash');
});

test('a flyer that never flaps hits the ground', () => {
  const s = run(G.flyerFlap(G.newFlyer()), (x, dt) => G.flyerTick(x, dt, 1, () => 0.5), 10);
  assert.ok(s.over);
});

/* -------------------------------- bricks -------------------------------- */

test('the ball stays in the box and breaks bricks with a perfect paddle', () => {
  const rng = seeded(21);
  let s = G.newBricks();
  let broke = 0;
  for (let i = 0; i < 60 * 90 && !s.over; i++) {
    // Track the ball with the paddle.
    s = G.bricksMove(s, s.ball.x - s.paddle);
    const before = s.bricks.reduce((a, b) => a + b, 0);
    s = G.bricksTick(s, 1 / 60, 1, rng);
    broke += Math.max(0, before - s.bricks.reduce((a, b) => a + b, 0));
    assert.ok(s.ball.x >= 0 && s.ball.x <= 1, `x ${s.ball.x}`);
    assert.ok(s.ball.y >= 0, `y ${s.ball.y}`);
  }
  assert.equal(s.lives, G.START_LIVES, 'a perfect paddle never loses the ball');
  assert.ok(broke >= 20 || s.level > 1, `broke ${broke}`);
});

test('a fast ball cannot pass through a brick, and side hits bounce sideways', () => {
  const s0 = { ...G.newBricks(), stuck: false, bricks: Array(G.BRICK_ROWS * G.BRICK_COLS).fill(0) };
  // One brick in the middle of row 2; ball coming straight up from below, very fast.
  const k = 2 * G.BRICK_COLS + 3;
  const bricks = [...s0.bricks];
  bricks[k] = 1;
  const cx = 3.5 / G.BRICK_COLS;
  let s = { ...s0, bricks: [...bricks, 1], ball: { x: cx, y: 0.6, vx: 0, vy: -4 } };
  s = { ...s, bricks: bricks.map((v, i) => (i === G.BRICK_COLS * G.BRICK_ROWS - 1 ? 1 : v)) }; // keep the level alive
  for (let i = 0; i < 30; i++) s = G.bricksTick(s, 1 / 30, 1, seeded(1));
  assert.equal(s.bricks[k], 0, 'the brick was hit, not skipped');
  // Side hit: ball moving right into a brick's left face.
  const side = { ...s0, bricks: bricks.map((v, i) => (i === G.BRICK_COLS * G.BRICK_ROWS - 1 ? 1 : v)) };
  const top = G.BRICK_TOP + 2 * G.BRICK_H + G.BRICK_H / 2;
  let t = { ...side, ball: { x: 3 / G.BRICK_COLS - 0.05, y: top, vx: 0.5, vy: 0 } };
  for (let i = 0; i < 20 && t.bricks[k]; i++) t = G.bricksTick(t, 1 / 60, 1, seeded(1));
  assert.equal(t.bricks[k], 0);
  assert.ok(t.ball.vx < 0, 'bounced back left');
});

test('missing the ball costs a life and serves again', () => {
  let s = { ...G.newBricks(), stuck: false, ball: { x: 0.05, y: 0.95, vx: 0, vy: 1 }, paddle: 0.8 };
  s = run(s, (x, dt) => G.bricksTick(x, dt, 1, seeded(1)), 0.5);
  assert.equal(s.lives, G.START_LIVES - 1);
  assert.ok(s.stuck);
});

/* -------------------------------- shooter -------------------------------- */

test('the shooter scores kills, levels up, and plays the same at any frame rate', () => {
  const a = run(G.newShooter(), (s, dt) => G.shooterTick(s, dt, 1, () => 0.5), 8, 30);
  const b = run(G.newShooter(), (s, dt) => G.shooterTick(s, dt, 1, () => 0.5), 8, 120);
  assert.ok(Math.abs(a.score - b.score) <= 10 && Math.abs(a.kills - b.kills) <= 1, `${a.kills} vs ${b.kills}`);
  assert.ok(a.kills > 0);
  const rng = seeded(31);
  let s = G.newShooter();
  for (let i = 0; i < 60 * 120 && !s.over; i++) {
    const target = s.enemies.reduce((m, e) => (e.y > (m?.y ?? -1) ? e : m), null);
    if (target) s = G.shooterMove(s, (target.x - s.ship) * 0.3);
    s = G.shooterTick(s, 1 / 60, 1, rng);
  }
  assert.ok(s.level > 1, `level ${s.level}`);
  finite(s);
});

/* -------------------------------- catcher -------------------------------- */

test('the basket catches fast items instead of letting them slip through', () => {
  let s = { ...G.newCatch(), items: [{ id: 1, x: 0.5, y: 0.8, kind: 'good' }], level: 40, spawnAcc: 99 };
  s = run(s, (x, dt) => G.catchTick(x, dt, 1.35, seeded(1)), 0.5, 20);
  assert.equal(s.caught, 1);
  assert.equal(s.lives, G.START_LIVES);
});

test('catching in a row builds the multiplier; a bomb breaks it', () => {
  let s = { ...G.newCatch(), spawnAcc: 99 };
  for (let i = 0; i < 6; i++) {
    s = { ...s, items: [{ id: i + 1, x: 0.5, y: G.BASKET_Y - 0.001, kind: 'good' }] };
    s = G.catchTick(s, 1 / 60, 1, seeded(1));
  }
  assert.equal(s.streak, 6);
  assert.equal(G.catchMultiplier(s.streak), 2);
  s = { ...s, items: [{ id: 50, x: 0.5, y: G.BASKET_Y - 0.001, kind: 'bad' }] };
  s = G.catchTick(s, 1 / 60, 1, seeded(1));
  assert.equal(s.streak, 0);
  assert.equal(s.lives, G.START_LIVES - 1);
});

/* --------------------------------- whack --------------------------------- */

test('whack: hits score and build a streak, bombs and escapes cost lives', () => {
  let s = G.newWhack();
  for (let i = 0; i < 7; i++) {
    s = { ...s, holes: s.holes.map((h, j) => (j === 4 ? { kind: 'good', t: 1, id: 100 + i } : h)) };
    s = G.whackHit(s, 4);
  }
  assert.equal(s.hits, 7);
  assert.equal(s.streak, 7);
  assert.ok(s.score > 70, 'the streak multiplied later hits');
  s = { ...s, holes: s.holes.map((h, j) => (j === 0 ? { kind: 'bad', t: 1, id: 200 } : h)) };
  s = G.whackHit(s, 0);
  assert.equal(s.lives, G.START_LIVES - 1);
  assert.equal(s.streak, 0);
  assert.deepEqual(G.whackHit(s, 8), s, 'tapping an empty hole changes nothing');
});

/* ------------------------------ every game ------------------------------ */

test('every game survives minutes of random play without bad numbers', () => {
  const rng = seeded(99);
  const games = [
    [G.newRunner(), (s) => G.runnerTick(rng() < 0.05 ? G.runnerMove(s, rng() < 0.5 ? -1 : 1) : s, 1 / 45, 1.35, rng)],
    [G.newSnake(rng), (s) => G.snakeTick(rng() < 0.1 ? G.snakeTurn(s, ['up', 'down', 'left', 'right'][Math.floor(rng() * 4)]) : s, 1 / 45, 1.35, rng)],
    [G.flyerFlap(G.newFlyer()), (s) => G.flyerTick(rng() < 0.06 ? G.flyerFlap(s) : s, 1 / 45, 1.35, rng)],
    [G.newBricks(), (s) => G.bricksTick(G.bricksMove(s, (rng() - 0.5) * 0.1), 1 / 45, 1.35, rng)],
    [G.newShooter(), (s) => G.shooterTick(G.shooterMove(s, (rng() - 0.5) * 0.1), 1 / 45, 1.35, rng)],
    [G.newCatch(), (s) => G.catchTick(G.catchMove(s, (rng() - 0.5) * 0.1), 1 / 45, 1.35, rng)],
    [G.newWhack(), (s) => G.whackTick(rng() < 0.1 ? G.whackHit(s, Math.floor(rng() * 9)) : s, 1 / 45, 1.35, rng)],
  ];
  for (const [start, tick] of games) {
    let s = start;
    for (let i = 0; i < 45 * 180 && !s.over; i++) s = tick(s);
    finite(s);
    assert.ok(Array.isArray(s.fx));
  }
});
