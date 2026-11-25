/**
 * Game rules for the built-in game block, as pure functions over plain state, so they can be
 * unit-tested and rendered by any view. Each game is original: common arcade mechanics (falling
 * blocks, lane dodging, a growing snake, tap to fly), not a copy of any particular game.
 *
 * Time is passed in explicitly (`dt` in seconds) and randomness through `rng`, so a test can play a
 * whole game deterministically.
 */

export type Rng = () => number;

/* ------------------------------------------------------------------ *
 * Falling blocks: stack shapes, clear full rows.
 * ------------------------------------------------------------------ */

export const BLOCKS_W = 10;
export const BLOCKS_H = 20;

/** The seven four-cell shapes, as rows of 0/1. */
export const SHAPES: number[][][] = [
  [[1, 1, 1, 1]],
  [
    [1, 1],
    [1, 1],
  ],
  [
    [0, 1, 0],
    [1, 1, 1],
  ],
  [
    [1, 0, 0],
    [1, 1, 1],
  ],
  [
    [0, 0, 1],
    [1, 1, 1],
  ],
  [
    [0, 1, 1],
    [1, 1, 0],
  ],
  [
    [1, 1, 0],
    [0, 1, 1],
  ],
];

export interface Piece {
  shape: number[][];
  /** 1-based colour index, so 0 can mean "empty" on the board. */
  color: number;
  x: number;
  y: number;
}

export interface BlocksState {
  /** Row-major, BLOCKS_W × BLOCKS_H; 0 is empty, otherwise a colour index. */
  board: number[];
  piece: Piece;
  next: number;
  /** Shapes still to come in the current bag of seven (each shape once per bag, fair odds). */
  bag: number[];
  score: number;
  lines: number;
  level: number;
  over: boolean;
  /** Seconds since the piece last fell a row. */
  acc: number;
  /** Rows cleared by the last lock, for a flash or a haptic. */
  cleared: number;
}

const LINE_POINTS = [0, 100, 300, 500, 800];

function drawBag(bag: number[], rng: Rng): { id: number; bag: number[] } {
  let b = bag;
  if (!b.length) {
    b = [0, 1, 2, 3, 4, 5, 6];
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [b[i], b[j]] = [b[j], b[i]];
    }
  }
  return { id: b[0], bag: b.slice(1) };
}

const spawn = (id: number): Piece => ({
  shape: SHAPES[id],
  color: id + 1,
  x: Math.floor((BLOCKS_W - SHAPES[id][0].length) / 2),
  y: 0,
});

export function rotate(shape: number[][]): number[][] {
  // Clockwise: the new row r is the old column r read bottom to top.
  return shape[0].map((_, c) => shape.map((row) => row[c]).reverse());
}

export function collides(board: number[], p: Piece): boolean {
  for (let r = 0; r < p.shape.length; r++) {
    for (let c = 0; c < p.shape[r].length; c++) {
      if (!p.shape[r][c]) continue;
      const x = p.x + c;
      const y = p.y + r;
      if (x < 0 || x >= BLOCKS_W || y >= BLOCKS_H) return true;
      if (y >= 0 && board[y * BLOCKS_W + x]) return true;
    }
  }
  return false;
}

export function newBlocks(rng: Rng = Math.random): BlocksState {
  const a = drawBag([], rng);
  const b = drawBag(a.bag, rng);
  return {
    board: Array(BLOCKS_W * BLOCKS_H).fill(0),
    piece: spawn(a.id),
    next: b.id,
    bag: b.bag,
    score: 0,
    lines: 0,
    level: 1,
    over: false,
    acc: 0,
    cleared: 0,
  };
}

/** Seconds per row at a level, before the speed setting. */
export const blocksInterval = (level: number) => Math.max(0.08, 0.7 - (level - 1) * 0.06);

function lock(s: BlocksState, rng: Rng): BlocksState {
  const board = [...s.board];
  const { piece } = s;
  piece.shape.forEach((row, r) =>
    row.forEach((v, c) => {
      const y = piece.y + r;
      if (v && y >= 0) board[y * BLOCKS_W + piece.x + c] = piece.color;
    }),
  );
  // Remove full rows and add empty ones on top.
  const rows: number[][] = [];
  for (let y = 0; y < BLOCKS_H; y++) rows.push(board.slice(y * BLOCKS_W, (y + 1) * BLOCKS_W));
  const kept = rows.filter((row) => row.some((v) => !v));
  const cleared = BLOCKS_H - kept.length;
  const nextBoard = [...Array.from({ length: cleared }, () => Array(BLOCKS_W).fill(0)), ...kept].flat();
  const lines = s.lines + cleared;
  const level = 1 + Math.floor(lines / 10);
  const { id, bag } = drawBag(s.bag, rng);
  const piece2 = spawn(s.next);
  return {
    ...s,
    board: nextBoard,
    piece: piece2,
    next: id,
    bag,
    lines,
    level,
    score: s.score + LINE_POINTS[cleared] * s.level,
    over: collides(nextBoard, piece2),
    acc: 0,
    cleared,
  };
}

/** One row down, locking the piece if it can't move. */
export function blocksFall(s: BlocksState, rng: Rng = Math.random): BlocksState {
  if (s.over) return s;
  const moved = { ...s.piece, y: s.piece.y + 1 };
  if (!collides(s.board, moved)) return { ...s, piece: moved, acc: 0, cleared: 0 };
  return lock(s, rng);
}

/** Advances time; the piece falls once per interval (scaled by `speed`, 1 = normal). */
export function blocksTick(s: BlocksState, dt: number, speed = 1, rng: Rng = Math.random): BlocksState {
  if (s.over) return s;
  let next = { ...s, acc: s.acc + dt, cleared: 0 };
  const step = blocksInterval(s.level) / speed;
  // At most a few rows per frame, so a long pause (app in background) can't drop a whole stack.
  for (let i = 0; i < 3 && next.acc >= step && !next.over; i++) {
    const acc = next.acc - step;
    next = blocksFall(next, rng);
    if (!next.over) next = { ...next, acc };
  }
  return next;
}

export function blocksMove(s: BlocksState, dx: number): BlocksState {
  if (s.over) return s;
  const moved = { ...s.piece, x: s.piece.x + dx };
  return collides(s.board, moved) ? s : { ...s, piece: moved };
}

export function blocksRotate(s: BlocksState): BlocksState {
  if (s.over) return s;
  const shape = rotate(s.piece.shape);
  // Nudge sideways if the rotated piece would overlap a wall or a block.
  for (const kick of [0, -1, 1, -2, 2, -3, 3]) {
    const p = { ...s.piece, shape, x: s.piece.x + kick };
    if (!collides(s.board, p)) return { ...s, piece: p };
  }
  return s;
}

/** Drops the piece to the bottom at once: 2 points per row dropped. */
export function blocksDrop(s: BlocksState, rng: Rng = Math.random): BlocksState {
  if (s.over) return s;
  let p = s.piece;
  let rows = 0;
  while (!collides(s.board, { ...p, y: p.y + 1 })) {
    p = { ...p, y: p.y + 1 };
    rows++;
  }
  return lock({ ...s, piece: p, score: s.score + rows * 2 }, rng);
}

/** Where the piece would land, for a faint guide. */
export function ghostY(s: BlocksState): number {
  let p = s.piece;
  while (!collides(s.board, { ...p, y: p.y + 1 })) p = { ...p, y: p.y + 1 };
  return p.y;
}

/* ------------------------------------------------------------------ *
 * Lane runner: switch between three lanes to dodge what comes at you.
 * ------------------------------------------------------------------ */

export const LANES = 3;
/** Where the player sits, as a fraction of the track's height from the top. */
export const RUNNER_Y = 0.85;
const HIT = 0.06;

export interface Obstacle {
  id: number;
  lane: number;
  /** 0 at the top of the track, 1 at the bottom. */
  y: number;
}

export interface RunnerState {
  lane: number;
  obstacles: Obstacle[];
  /** Track lengths per second. */
  speed: number;
  distance: number;
  /** Distance until the next row of obstacles. */
  gap: number;
  nextId: number;
  score: number;
  over: boolean;
}

export function newRunner(): RunnerState {
  return { lane: 1, obstacles: [], speed: 0.5, distance: 0, gap: 0.3, nextId: 1, score: 0, over: false };
}

export function runnerMove(s: RunnerState, dir: -1 | 1): RunnerState {
  if (s.over) return s;
  return { ...s, lane: Math.min(LANES - 1, Math.max(0, s.lane + dir)) };
}

export function runnerTick(s: RunnerState, dt: number, speedFactor = 1, rng: Rng = Math.random): RunnerState {
  if (s.over) return s;
  const d = Math.min(dt, 0.05) * s.speed * speedFactor;
  let nextId = s.nextId;
  const obstacles = s.obstacles.map((o) => ({ ...o, y: o.y + d })).filter((o) => o.y < 1.1);
  let gap = s.gap - d;
  if (gap <= 0) {
    // One or two blocked lanes per row, never all three, so there is always a way through.
    const first = Math.floor(rng() * LANES);
    obstacles.push({ id: nextId++, lane: first, y: -0.05 });
    if (rng() < 0.35) obstacles.push({ id: nextId++, lane: (first + 1 + Math.floor(rng() * 2)) % LANES, y: -0.05 });
    gap = 0.32 + rng() * 0.25;
  }
  const over = obstacles.some((o) => o.lane === s.lane && Math.abs(o.y - RUNNER_Y) < HIT);
  const distance = s.distance + d;
  return {
    ...s,
    obstacles,
    gap,
    nextId,
    distance,
    // Gets faster the further you go, up to about triple speed.
    speed: Math.min(1.6, 0.5 + distance * 0.012),
    score: Math.floor(distance * 10),
    over,
  };
}

/* ------------------------------------------------------------------ *
 * Snake: eat, grow, don't hit the walls or yourself.
 * ------------------------------------------------------------------ */

export const SNAKE_N = 15;
export type Dir = 'up' | 'down' | 'left' | 'right';
const DELTA: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };

export interface SnakeState {
  /** Head first, as [x, y]. */
  body: [number, number][];
  dir: Dir;
  /** Turns queued by quick swipes, applied one per step. */
  queue: Dir[];
  food: [number, number];
  score: number;
  over: boolean;
  acc: number;
  ate: boolean;
}

function placeFood(body: [number, number][], rng: Rng): [number, number] {
  const free: [number, number][] = [];
  for (let y = 0; y < SNAKE_N; y++) for (let x = 0; x < SNAKE_N; x++) if (!body.some(([bx, by]) => bx === x && by === y)) free.push([x, y]);
  return free[Math.floor(rng() * free.length)] ?? [0, 0];
}

export function newSnake(rng: Rng = Math.random): SnakeState {
  const mid = Math.floor(SNAKE_N / 2);
  const body: [number, number][] = [
    [mid, mid],
    [mid - 1, mid],
    [mid - 2, mid],
  ];
  return { body, dir: 'right', queue: [], food: placeFood(body, rng), score: 0, over: false, acc: 0, ate: false };
}

export function snakeTurn(s: SnakeState, dir: Dir): SnakeState {
  if (s.over) return s;
  const last = s.queue[s.queue.length - 1] ?? s.dir;
  if (dir === last || dir === OPPOSITE[last] || s.queue.length >= 2) return s;
  return { ...s, queue: [...s.queue, dir] };
}

export function snakeStep(s: SnakeState, rng: Rng = Math.random): SnakeState {
  if (s.over) return s;
  const [dir, ...queue] = s.queue.length ? s.queue : [s.dir];
  const [dx, dy] = DELTA[dir];
  const head: [number, number] = [s.body[0][0] + dx, s.body[0][1] + dy];
  const ate = head[0] === s.food[0] && head[1] === s.food[1];
  // The tail moves away this step unless the snake grows, so moving into it is allowed.
  const rest = ate ? s.body : s.body.slice(0, -1);
  const hit =
    head[0] < 0 || head[1] < 0 || head[0] >= SNAKE_N || head[1] >= SNAKE_N || rest.some(([x, y]) => x === head[0] && y === head[1]);
  if (hit) return { ...s, dir, queue, over: true, ate: false };
  const body: [number, number][] = [head, ...rest];
  return {
    ...s,
    body,
    dir,
    queue: s.queue.length ? queue : [],
    food: ate ? placeFood(body, rng) : s.food,
    score: s.score + (ate ? 1 : 0),
    ate,
  };
}

/** Seconds per step: starts relaxed and speeds up as the snake grows. */
export const snakeInterval = (score: number) => Math.max(0.07, 0.2 - score * 0.004);

export function snakeTick(s: SnakeState, dt: number, speed = 1, rng: Rng = Math.random): SnakeState {
  if (s.over) return s;
  let next = { ...s, acc: s.acc + dt, ate: false };
  for (let i = 0; i < 3 && !next.over && next.acc >= snakeInterval(next.score) / speed; i++) {
    const acc = next.acc - snakeInterval(next.score) / speed;
    next = { ...snakeStep(next, rng), acc };
  }
  return next;
}

/* ------------------------------------------------------------------ *
 * Flyer: tap to rise, fall otherwise, slip through the gaps.
 * ------------------------------------------------------------------ */

export const FLYER_X = 0.28;
export const FLYER_R = 0.035;
export const WALL_W = 0.14;

export interface Wall {
  id: number;
  /** Left edge, as a fraction of the width. */
  x: number;
  /** Centre of the gap, as a fraction of the height. */
  gapY: number;
  gapH: number;
  passed: boolean;
}

export interface FlyerState {
  y: number;
  vy: number;
  walls: Wall[];
  nextId: number;
  score: number;
  over: boolean;
  /** Nothing moves until the first tap. */
  started: boolean;
}

const GRAVITY = 1.9;
const FLAP = -0.62;
const SCROLL = 0.32;

export function newFlyer(): FlyerState {
  return { y: 0.45, vy: 0, walls: [], nextId: 1, score: 0, over: false, started: false };
}

export function flyerFlap(s: FlyerState): FlyerState {
  if (s.over) return s;
  return { ...s, vy: FLAP, started: true };
}

export function flyerTick(s: FlyerState, dt: number, speed = 1, rng: Rng = Math.random): FlyerState {
  if (s.over || !s.started) return s;
  const t = Math.min(dt, 0.05);
  const vy = s.vy + GRAVITY * t;
  const y = s.y + vy * t;
  let nextId = s.nextId;
  let score = s.score;
  const walls = s.walls
    .map((w) => ({ ...w, x: w.x - SCROLL * speed * t }))
    .filter((w) => w.x > -WALL_W)
    .map((w) => {
      if (!w.passed && w.x + WALL_W < FLYER_X - FLYER_R) {
        score++;
        return { ...w, passed: true };
      }
      return w;
    });
  const last = walls[walls.length - 1];
  if (!last || last.x < 0.55) {
    // Gaps get a little narrower as the score climbs.
    const gapH = Math.max(0.24, 0.34 - score * 0.004);
    walls.push({ id: nextId++, x: 1.05, gapY: 0.25 + rng() * 0.5, gapH, passed: false });
  }
  const hitWall = walls.some(
    (w) => FLYER_X + FLYER_R > w.x && FLYER_X - FLYER_R < w.x + WALL_W && (y - FLYER_R < w.gapY - w.gapH / 2 || y + FLYER_R > w.gapY + w.gapH / 2),
  );
  return { ...s, y, vy, walls, nextId, score, over: hitWall || y > 1 - FLYER_R || y < FLYER_R };
}

/* ------------------------------------------------------------------ *
 * Shared by the arcade games below: lives, levels and a short grace
 * period after a hit, so one mistake can't cost two lives.
 * ------------------------------------------------------------------ */

export const START_LIVES = 3;
const GRACE = 1;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------------------ *
 * Bricks: bounce the ball off the paddle to break every brick.
 * ------------------------------------------------------------------ */

export const BRICK_COLS = 8;
export const BRICK_ROWS = 5;
export const BRICK_TOP = 0.1;
export const BRICK_H = 0.045;
export const PADDLE_Y = 0.92;
export const PADDLE_W = 0.24;
export const BALL_R = 0.018;

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface BricksState {
  paddle: number;
  ball: Ball;
  /** The ball rests on the paddle until `wait` runs out (after a lost ball or a new level). */
  stuck: boolean;
  wait: number;
  /** Row-major hit points per brick; 0 is gone. */
  bricks: number[];
  lives: number;
  level: number;
  score: number;
  over: boolean;
}

/** Brick layout for a level: from level 3, the top rows take two hits. */
export function brickLayout(level: number): number[] {
  return Array.from({ length: BRICK_ROWS * BRICK_COLS }, (_, i) => (level >= 3 && Math.floor(i / BRICK_COLS) < Math.min(BRICK_ROWS, level - 2) ? 2 : 1));
}

export function newBricks(): BricksState {
  return {
    paddle: 0.5,
    ball: { x: 0.5, y: PADDLE_Y - BALL_R, vx: 0, vy: 0 },
    stuck: true,
    wait: 0.8,
    bricks: brickLayout(1),
    lives: START_LIVES,
    level: 1,
    score: 0,
    over: false,
  };
}

const ballSpeed = (level: number, speed: number) => 0.6 * (1 + 0.1 * (level - 1)) * speed;

export function bricksMove(s: BricksState, dx: number): BricksState {
  if (s.over) return s;
  return { ...s, paddle: clamp(s.paddle + dx, PADDLE_W / 2, 1 - PADDLE_W / 2) };
}

export function bricksTick(s: BricksState, dt: number, speed = 1, rng: Rng = Math.random): BricksState {
  if (s.over) return s;
  const t = Math.min(dt, 0.04);
  if (s.stuck) {
    const wait = s.wait - t;
    const ball = { ...s.ball, x: s.paddle, y: PADDLE_Y - BALL_R };
    if (wait > 0) return { ...s, wait, ball };
    const v = ballSpeed(s.level, speed);
    const angle = (rng() - 0.5) * 0.9; // radians off vertical
    return { ...s, stuck: false, wait: 0, ball: { ...ball, vx: Math.sin(angle) * v, vy: -Math.cos(angle) * v } };
  }
  let { x, y, vx, vy } = s.ball;
  x += vx * t;
  y += vy * t;
  if (x < BALL_R) [x, vx] = [BALL_R, Math.abs(vx)];
  if (x > 1 - BALL_R) [x, vx] = [1 - BALL_R, -Math.abs(vx)];
  if (y < BALL_R) [y, vy] = [BALL_R, Math.abs(vy)];
  // Paddle: where it hits sets the angle, like aiming.
  if (vy > 0 && y + BALL_R >= PADDLE_Y && y < PADDLE_Y + 0.03 && Math.abs(x - s.paddle) <= PADDLE_W / 2 + BALL_R) {
    const v = Math.hypot(vx, vy);
    const off = clamp((x - s.paddle) / (PADDLE_W / 2), -1, 1);
    // Never straight up: a dead-centre hit would bounce in the same column forever.
    const sign = off !== 0 ? Math.sign(off) : vx >= 0 ? 1 : -1;
    const angle = sign * Math.max(0.22, Math.abs(off) * 1.05);
    vx = Math.sin(angle) * v;
    vy = -Math.cos(angle) * v;
    y = PADDLE_Y - BALL_R;
  }
  let { bricks, score, level, lives } = s;
  // One brick per frame: the cell the ball is in.
  const col = Math.floor(x * BRICK_COLS);
  const row = Math.floor((y - BRICK_TOP) / BRICK_H);
  if (row >= 0 && row < BRICK_ROWS && col >= 0 && col < BRICK_COLS && bricks[row * BRICK_COLS + col] > 0) {
    bricks = [...bricks];
    bricks[row * BRICK_COLS + col]--;
    score += 10 * level;
    vy = -vy;
  }
  if (y > 1) {
    lives--;
    if (lives <= 0) return { ...s, lives: 0, over: true, ball: { x, y, vx, vy }, bricks, score };
    return { ...s, lives, stuck: true, wait: 0.8, ball: { x: s.paddle, y: PADDLE_Y - BALL_R, vx: 0, vy: 0 }, bricks, score };
  }
  if (bricks.every((b) => b === 0)) {
    level++;
    return { ...s, level, score: score + 100 * (level - 1), bricks: brickLayout(level), stuck: true, wait: 1, ball: { x: s.paddle, y: PADDLE_Y - BALL_R, vx: 0, vy: 0 } };
  }
  return { ...s, ball: { x, y, vx, vy }, bricks, score };
}

/* ------------------------------------------------------------------ *
 * Shooter: your ship fires on its own; slide it to hit what comes down.
 * ------------------------------------------------------------------ */

export const SHIP_Y = 0.88;

export interface Shot {
  id: number;
  x: number;
  y: number;
}
export interface Enemy {
  id: number;
  x: number;
  y: number;
  vx: number;
}

export interface ShooterState {
  ship: number;
  shots: Shot[];
  enemies: Enemy[];
  lives: number;
  level: number;
  score: number;
  kills: number;
  over: boolean;
  fireAcc: number;
  spawnAcc: number;
  /** Seconds of protection left after a hit. */
  grace: number;
  nextId: number;
}

export function newShooter(): ShooterState {
  return { ship: 0.5, shots: [], enemies: [], lives: START_LIVES, level: 1, score: 0, kills: 0, over: false, fireAcc: 0, spawnAcc: 0.6, grace: 0, nextId: 1 };
}

export function shooterMove(s: ShooterState, dx: number): ShooterState {
  if (s.over) return s;
  return { ...s, ship: clamp(s.ship + dx, 0.06, 0.94) };
}

export function shooterTick(s: ShooterState, dt: number, speed = 1, rng: Rng = Math.random): ShooterState {
  if (s.over) return s;
  const t = Math.min(dt, 0.05);
  let { nextId, score, kills, level, lives, grace } = s;
  grace = Math.max(0, grace - t);
  let shots = s.shots.map((b) => ({ ...b, y: b.y - 1.4 * t })).filter((b) => b.y > -0.05);
  let fireAcc = s.fireAcc + t;
  if (fireAcc >= 0.28) {
    fireAcc = 0;
    shots.push({ id: nextId++, x: s.ship, y: SHIP_Y - 0.04 });
  }
  const fall = (0.12 + 0.02 * level) * speed;
  let enemies = s.enemies.map((e) => {
    let x = e.x + e.vx * t;
    let vx = e.vx;
    if (x < 0.05 || x > 0.95) [x, vx] = [clamp(x, 0.05, 0.95), -vx];
    return { ...e, x, vx, y: e.y + fall * t };
  });
  let spawnAcc = s.spawnAcc - t;
  if (spawnAcc <= 0) {
    spawnAcc = Math.max(0.35, 1.1 - 0.08 * level) / speed;
    enemies.push({ id: nextId++, x: 0.08 + rng() * 0.84, y: -0.04, vx: (rng() < 0.5 ? -1 : 1) * (0.05 + rng() * 0.15) });
  }
  // Shots against enemies.
  const hitShots = new Set<number>();
  enemies = enemies.filter((e) => {
    const b = shots.find((sh) => !hitShots.has(sh.id) && Math.abs(sh.x - e.x) < 0.06 && Math.abs(sh.y - e.y) < 0.04);
    if (!b) return true;
    hitShots.add(b.id);
    score += 10 * level;
    kills++;
    if (kills % 15 === 0) level++;
    return false;
  });
  shots = shots.filter((b) => !hitShots.has(b.id));
  // Enemies that reach you, or get past.
  let hit = false;
  enemies = enemies.filter((e) => {
    const rams = e.y > SHIP_Y - 0.04 && e.y < SHIP_Y + 0.04 && Math.abs(e.x - s.ship) < 0.08;
    if (rams || e.y > 0.97) {
      hit = true;
      return false;
    }
    return true;
  });
  if (hit && grace === 0) {
    lives--;
    grace = GRACE;
  }
  return { ...s, shots, enemies, nextId, score, kills, level, lives, grace, fireAcc, spawnAcc, over: lives <= 0 };
}

/* ------------------------------------------------------------------ *
 * Catch: slide the basket under the good things, away from the bad.
 * ------------------------------------------------------------------ */

export const BASKET_Y = 0.9;

export interface Falling {
  id: number;
  x: number;
  y: number;
  bad: boolean;
}

export interface CatchState {
  basket: number;
  items: Falling[];
  lives: number;
  level: number;
  score: number;
  caught: number;
  over: boolean;
  spawnAcc: number;
  nextId: number;
  /** Set for one frame when something is caught or missed, for haptics. */
  event: 'catch' | 'ouch' | null;
}

export function newCatch(): CatchState {
  return { basket: 0.5, items: [], lives: START_LIVES, level: 1, score: 0, caught: 0, over: false, spawnAcc: 0.5, nextId: 1, event: null };
}

export function catchMove(s: CatchState, dx: number): CatchState {
  if (s.over) return s;
  return { ...s, basket: clamp(s.basket + dx, 0.08, 0.92) };
}

export function catchTick(s: CatchState, dt: number, speed = 1, rng: Rng = Math.random): CatchState {
  if (s.over) return s;
  const t = Math.min(dt, 0.05);
  let { nextId, score, caught, level, lives } = s;
  let event: CatchState['event'] = null;
  const fall = (0.35 + 0.04 * level) * speed;
  const items: Falling[] = [];
  for (const it of s.items) {
    const y = it.y + fall * t;
    if (y >= BASKET_Y - 0.03 && y <= BASKET_Y + 0.03 && Math.abs(it.x - s.basket) < 0.11) {
      if (it.bad) {
        lives--;
        event = 'ouch';
      } else {
        score += 10 * level;
        caught++;
        event = 'catch';
        if (caught % 10 === 0) level++;
      }
      continue;
    }
    if (y > 1.02) {
      // Letting a good one drop costs a life, arcade style.
      if (!it.bad) {
        lives--;
        event = 'ouch';
      }
      continue;
    }
    items.push({ ...it, y });
  }
  let spawnAcc = s.spawnAcc - t;
  if (spawnAcc <= 0) {
    spawnAcc = Math.max(0.35, 0.9 - 0.05 * level) / speed;
    items.push({ id: nextId++, x: 0.08 + rng() * 0.84, y: -0.04, bad: rng() < Math.min(0.4, 0.18 + 0.02 * level) });
  }
  return { ...s, items, nextId, score, caught, level, lives, spawnAcc, event, over: lives <= 0 };
}

/* ------------------------------------------------------------------ *
 * Whack: tap things as they pop up, before they hide again.
 * ------------------------------------------------------------------ */

export const HOLES = 9;

export interface Hole {
  kind: 'none' | 'good' | 'bad';
  /** Seconds until it hides. */
  t: number;
  id: number;
}

export interface WhackState {
  holes: Hole[];
  lives: number;
  level: number;
  score: number;
  hits: number;
  over: boolean;
  spawnAcc: number;
  nextId: number;
}

export function newWhack(): WhackState {
  return {
    holes: Array.from({ length: HOLES }, () => ({ kind: 'none' as const, t: 0, id: 0 })),
    lives: START_LIVES,
    level: 1,
    score: 0,
    hits: 0,
    over: false,
    spawnAcc: 0.8,
    nextId: 1,
  };
}

export function whackTick(s: WhackState, dt: number, speed = 1, rng: Rng = Math.random): WhackState {
  if (s.over) return s;
  const t = Math.min(dt, 0.05);
  let { lives, nextId } = s;
  const holes = s.holes.map((h) => {
    if (h.kind === 'none') return h;
    const left = h.t - t;
    if (left > 0) return { ...h, t: left };
    // A good one that got away costs a life; a bad one hiding is fine.
    if (h.kind === 'good') lives--;
    return { kind: 'none' as const, t: 0, id: h.id };
  });
  let spawnAcc = s.spawnAcc - t;
  if (spawnAcc <= 0) {
    // Level 1 is forgiving (long-lived, spaced out); each level is a little faster.
    spawnAcc = Math.max(0.4, 1.15 - 0.07 * s.level) / speed;
    const empty = holes.map((h, i) => (h.kind === 'none' ? i : -1)).filter((i) => i >= 0);
    if (empty.length) {
      const i = empty[Math.floor(rng() * empty.length)];
      holes[i] = { kind: rng() < 0.15 ? 'bad' : 'good', t: Math.max(0.7, 2 - 0.12 * s.level) / speed, id: nextId++ };
    }
  }
  return { ...s, holes, lives, nextId, spawnAcc, over: lives <= 0 };
}

export function whackHit(s: WhackState, i: number): WhackState {
  if (s.over || !s.holes[i] || s.holes[i].kind === 'none') return s;
  const holes = [...s.holes];
  const kind = holes[i].kind;
  holes[i] = { kind: 'none', t: 0, id: holes[i].id };
  if (kind === 'bad') {
    const lives = s.lives - 1;
    return { ...s, holes, lives, over: lives <= 0 };
  }
  const hits = s.hits + 1;
  return { ...s, holes, hits, score: s.score + 10 * s.level, level: 1 + Math.floor(hits / 10) };
}
