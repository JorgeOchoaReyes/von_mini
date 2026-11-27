/**
 * Game rules for the built-in game block, as pure functions over plain state, so they can be
 * unit-tested and rendered by any view. Each game is original: common arcade mechanics (falling
 * blocks, lane dodging, a growing snake, tap to fly), not a copy of any particular game.
 *
 * Time is passed in explicitly (`dt` in seconds) and randomness through `rng`, so a test can play a
 * whole game deterministically. Continuous games advance in fixed sub-steps (see `substeps`), so
 * they play at the same speed at 30 or 120 frames a second and fast things can't skip through each
 * other.
 *
 * Every tick and action also reports what just happened, for the view to dress up: `fx` (particle
 * bursts and floating score labels, positioned as fractions of the board) and `buzz` (a haptic).
 */

export type Rng = () => number;

/* ------------------------------------------------------------------ *
 * Shared
 * ------------------------------------------------------------------ */

/** The longest simulation step: short enough that nothing tunnels through anything. */
export const STEP = 1 / 120;
/** A frame longer than this (a hiccup, a tab coming back) is treated as this long. */
export const MAX_FRAME = 0.1;

/** Splits a frame's `dt` into `n` equal steps of `h` seconds, each no longer than `max`. */
export function substeps(dt: number, max = STEP): { n: number; h: number } {
  const t = Math.min(Math.max(dt, 0), MAX_FRAME);
  if (t === 0) return { n: 0, h: 0 };
  const n = Math.max(1, Math.ceil(t / max - 1e-9));
  return { n, h: t / n };
}

/** Something worth showing: a particle burst and/or a floating label, at a spot on the board. */
export interface Fx {
  /** Position as fractions of the board, 0..1 from the left and from the top. */
  x: number;
  y: number;
  /** A floating label, like "+100" or "COMBO ×3". */
  text?: string;
  /** Particles in this colour. */
  color?: string;
  /** A bigger moment (several lines, a level cleared): more particles, bigger text. */
  big?: boolean;
}

export type Buzz = 'light' | 'medium' | 'heavy' | 'success' | 'error' | null;

/** Shared empty list, so a quiet frame doesn't look like a new event to the view. */
export const NO_FX: Fx[] = [];

/** Fields every game state carries for the view. */
interface Feedback {
  fx: Fx[];
  buzz: Buzz;
}

const quiet = { fx: NO_FX, buzz: null as Buzz };

/** Keeps the stronger of two haptics. */
function stronger(a: Buzz, b: Buzz): Buzz {
  const rank: Record<Exclude<Buzz, null>, number> = { light: 1, medium: 2, success: 3, heavy: 4, error: 5 };
  if (!a) return b;
  if (!b) return a;
  return rank[b] > rank[a] ? b : a;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const START_LIVES = 3;
/** Seconds of protection after losing a life, so one mistake can't cost two. */
const GRACE = 1;

/** Palettes shared with the view, so particles match what broke. */
export const BLOCK_COLORS = ['#3BA7F0', '#F5C518', '#A066E8', '#2E6FE0', '#F08A24', '#2FBF5B', '#E8483F'];
export const BRICK_ROW_COLORS = ['#E8483F', '#F08A24', '#F5C518', '#2FBF5B', '#3BA7F0'];
export const GOLD = '#F5C518';
export const RED = '#E8483F';
export const GREEN = '#2FBF5B';

/* ------------------------------------------------------------------ *
 * Falling blocks: stack shapes, clear full rows.
 *
 * Pieces turn about their own centre (each shape is a square matrix), with wall and floor kicks;
 * a piece that lands can still slide or turn for half a second (a lock delay, reset by moving, up
 * to a limit); soft drop, hard drop, hold, a three-piece preview, combos for clearing on
 * consecutive pieces and a bonus for back-to-back four-row clears.
 * ------------------------------------------------------------------ */

export const BLOCKS_W = 10;
export const BLOCKS_H = 20;

/** The seven four-cell shapes, as square matrices so a turn keeps the piece in place. */
export const SHAPES: number[][][] = [
  [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  [
    [1, 1],
    [1, 1],
  ],
  [
    [0, 1, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  [
    [1, 0, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  [
    [0, 0, 1],
    [1, 1, 1],
    [0, 0, 0],
  ],
  [
    [0, 1, 1],
    [1, 1, 0],
    [0, 0, 0],
  ],
  [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 0],
  ],
];

/** A shape without its empty rows and columns, for the preview and hold boxes. */
export function trimShape(shape: number[][]): number[][] {
  const rows = shape.filter((r) => r.some(Boolean));
  const cols = rows[0].map((_, c) => c).filter((c) => rows.some((r) => r[c]));
  return rows.map((r) => cols.map((c) => r[c]));
}

export interface Piece {
  /** Index into SHAPES. */
  id: number;
  shape: number[][];
  /** 1-based colour index, so 0 can mean "empty" on the board. */
  color: number;
  x: number;
  y: number;
}

export interface BlocksState extends Feedback {
  /** Row-major, BLOCKS_W × BLOCKS_H; 0 is empty, otherwise a colour index. */
  board: number[];
  piece: Piece;
  /** The next pieces, soonest first. */
  queue: number[];
  /** Shapes still to come in the current bag of seven (each shape once per bag, fair odds). */
  bag: number[];
  /** The held shape, and whether this piece may still swap with it. */
  hold: number | null;
  canHold: boolean;
  score: number;
  lines: number;
  level: number;
  over: boolean;
  /** Seconds since the piece last fell a row. */
  acc: number;
  /** Soft drop held down. */
  soft: boolean;
  /** Seconds the piece has rested on something, and how many moves have reset that. */
  lockT: number;
  resets: number;
  /** Consecutive pieces that cleared rows (−1 when the last piece cleared none). */
  combo: number;
  /** The last clear was four rows, so another earns a bonus. */
  b2b: boolean;
  /** Rows (board indices, top = 0) cleared by the last lock, for a flash. */
  clearedRows: number[];
}

const LINE_POINTS = [0, 100, 300, 500, 800];
export const LOCK_DELAY = 0.5;
export const MAX_RESETS = 15;
/** Seconds per row while soft-dropping. */
const SOFT_INTERVAL = 0.03;
const QUEUE = 3;

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

/** A new piece at the top, its first filled row on the board's first row. */
export function spawn(id: number): Piece {
  const shape = SHAPES[id];
  const top = shape.findIndex((r) => r.some(Boolean));
  return { id, shape, color: id + 1, x: Math.floor((BLOCKS_W - shape[0].length) / 2), y: -top };
}

/** Turns a square matrix a quarter: `dir` 1 is clockwise, −1 counter-clockwise. */
export function rotate(shape: number[][], dir: 1 | -1 = 1): number[][] {
  const n = shape.length;
  return shape.map((_, r) => shape.map((__, c) => (dir === 1 ? shape[n - 1 - c][r] : shape[c][n - 1 - r])));
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

const grounded = (s: { board: number[]; piece: Piece }) => collides(s.board, { ...s.piece, y: s.piece.y + 1 });

export function newBlocks(rng: Rng = Math.random): BlocksState {
  let bag: number[] = [];
  const ids: number[] = [];
  for (let i = 0; i <= QUEUE; i++) {
    const d = drawBag(bag, rng);
    ids.push(d.id);
    bag = d.bag;
  }
  return {
    board: Array(BLOCKS_W * BLOCKS_H).fill(0),
    piece: spawn(ids[0]),
    queue: ids.slice(1),
    bag,
    hold: null,
    canHold: true,
    score: 0,
    lines: 0,
    level: 1,
    over: false,
    acc: 0,
    soft: false,
    lockT: 0,
    resets: 0,
    combo: -1,
    b2b: false,
    clearedRows: [],
    ...quiet,
  };
}

/** Seconds per row at a level, before the speed setting: gentle at first, quick by level 15. */
export const blocksInterval = (level: number) => Math.max(0.05, 0.8 * Math.pow(0.86, level - 1));

/** Where the piece would land, for a faint guide. */
export function ghostY(s: { board: number[]; piece: Piece }): number {
  let y = s.piece.y;
  while (!collides(s.board, { ...s.piece, y: y + 1 })) y++;
  return y;
}

/** Puts the next piece in play: from the queue, or `held` when swapping with the hold box. */
function nextPiece(s: BlocksState, rng: Rng, held?: number): BlocksState {
  const id = held ?? s.queue[0];
  let queue = held === undefined ? s.queue.slice(1) : s.queue;
  let { bag } = s;
  while (queue.length < QUEUE) {
    const d = drawBag(bag, rng);
    queue = [...queue, d.id];
    bag = d.bag;
  }
  const piece = spawn(id);
  return { ...s, piece, queue, bag, acc: 0, lockT: 0, resets: 0, over: collides(s.board, piece) };
}

/** Fixes the piece in place, clears full rows, scores, and brings in the next piece. */
function lock(s: BlocksState, rng: Rng, extraFx: Fx[] = [], extraBuzz: Buzz = null): BlocksState {
  const board = [...s.board];
  const { piece } = s;
  let above = false;
  piece.shape.forEach((row, r) =>
    row.forEach((v, c) => {
      if (!v) return;
      const y = piece.y + r;
      if (y < 0) above = true;
      else board[y * BLOCKS_W + piece.x + c] = piece.color;
    }),
  );
  const clearedRows: number[] = [];
  for (let y = 0; y < BLOCKS_H; y++) if (board.slice(y * BLOCKS_W, (y + 1) * BLOCKS_W).every(Boolean)) clearedRows.push(y);
  const n = clearedRows.length;
  const kept: number[] = [];
  for (let y = 0; y < BLOCKS_H; y++) if (!clearedRows.includes(y)) kept.push(...board.slice(y * BLOCKS_W, (y + 1) * BLOCKS_W));
  const nextBoard = [...Array(n * BLOCKS_W).fill(0), ...kept];

  const fx: Fx[] = [...extraFx];
  let buzz: Buzz = extraBuzz ?? 'light';
  let points = 0;
  let combo = s.combo;
  let b2b = s.b2b;
  if (n > 0) {
    combo++;
    const quad = n === 4;
    points = LINE_POINTS[n] * s.level * (quad && s.b2b ? 1.5 : 1);
    if (combo > 0) points += 50 * combo * s.level;
    b2b = quad;
    const perfect = nextBoard.every((v) => !v);
    if (perfect) points += 2000 * s.level;
    for (const y of clearedRows) fx.push({ x: 0.5, y: (y + 0.5) / BLOCKS_H, color: BLOCK_COLORS[(piece.color - 1) % BLOCK_COLORS.length], big: n >= 4 });
    const midY = (clearedRows[0] + clearedRows[n - 1] + 1) / 2 / BLOCKS_H;
    const label = perfect ? 'PERFECT CLEAR!' : n === 4 ? (quad && s.b2b ? 'BACK TO BACK!' : 'FOUR ROWS!') : n > 1 ? `${n} ROWS` : '';
    fx.push({ x: 0.5, y: midY, text: `${label ? `${label} ` : ''}+${Math.round(points)}`, big: n >= 3 || perfect });
    if (combo > 0) fx.push({ x: 0.5, y: Math.max(0.08, midY - 0.08), text: `COMBO ×${combo + 1}` });
    buzz = n >= 4 || perfect ? 'heavy' : 'medium';
  } else {
    combo = -1;
  }
  points = Math.round(points);
  const lines = s.lines + n;
  const level = 1 + Math.floor(lines / 10);
  if (level > s.level) buzz = stronger(buzz, 'success');
  const locked: BlocksState = {
    ...s,
    board: nextBoard,
    lines,
    level,
    score: s.score + points,
    combo,
    b2b,
    canHold: true,
    soft: s.soft,
    clearedRows,
    fx,
    buzz,
  };
  // A piece that locks partly above the top is a top-out.
  if (above) return { ...locked, over: true };
  const next = nextPiece(locked, rng);
  return next.over ? { ...next, buzz: 'error' } : next;
}

/** Advances time: gravity (faster while soft-dropping), and the lock delay once landed. */
export function blocksTick(s: BlocksState, dt: number, speed = 1, rng: Rng = Math.random): BlocksState {
  if (s.over) return s;
  const t = Math.min(Math.max(dt, 0), MAX_FRAME);
  let next: BlocksState = { ...s, ...quiet, clearedRows: s.clearedRows.length ? [] : s.clearedRows };
  const fall = blocksInterval(s.level) / speed;
  const step = s.soft ? Math.min(fall, SOFT_INTERVAL) : fall;
  let acc = next.acc + t;
  let { piece, score } = next;
  while (acc >= step && !grounded({ board: next.board, piece })) {
    acc -= step;
    piece = { ...piece, y: piece.y + 1 };
    if (s.soft) score += 1;
  }
  const onGround = grounded({ board: next.board, piece });
  // Resting pieces don't bank gravity: sliding off a ledge shouldn't drop several rows at once.
  if (onGround) acc = Math.min(acc, step);
  // Reaching a new lowest row gives a fresh lock delay; otherwise the delay runs while landed.
  const fell = piece.y > next.piece.y;
  const lockT = onGround ? (fell ? 0 : next.lockT) + t : 0;
  next = { ...next, piece, score, acc, lockT, resets: fell ? 0 : next.resets };
  if (onGround && lockT >= LOCK_DELAY) return lock(next, rng);
  return next;
}

/** After a successful move or turn: a landed piece gets a fresh lock delay, up to a limit. */
function afterShift(s: BlocksState, moved: Piece): BlocksState {
  const wasDown = grounded(s);
  const next = { ...s, ...quiet, piece: moved };
  if (!wasDown && !grounded(next)) return next;
  if (next.resets >= MAX_RESETS) return next;
  return { ...next, lockT: 0, resets: next.resets + 1 };
}

export function blocksMove(s: BlocksState, dx: number): BlocksState {
  if (s.over) return s;
  const moved = { ...s.piece, x: s.piece.x + dx };
  return collides(s.board, moved) ? { ...s, ...quiet } : afterShift(s, moved);
}

/** Wall and floor kicks, tried in order: in place, sideways, up, then wider for the long piece. */
const KICKS: [number, number][] = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, -1],
  [1, -1],
  [-1, -1],
  [2, 0],
  [-2, 0],
  [0, -2],
];

export function blocksRotate(s: BlocksState, dir: 1 | -1 = 1): BlocksState {
  if (s.over) return s;
  if (s.piece.id === 1) return { ...s, ...quiet }; // the square looks the same every way
  const shape = rotate(s.piece.shape, dir);
  for (const [dx, dy] of KICKS) {
    const p = { ...s.piece, shape, x: s.piece.x + dx, y: s.piece.y + dy };
    if (!collides(s.board, p)) return afterShift(s, p);
  }
  return { ...s, ...quiet };
}

/** Soft drop on or off (a finger dragging down, or the down key held). */
export function blocksSoft(s: BlocksState, on: boolean): BlocksState {
  if (s.over || s.soft === on) return s;
  return { ...s, ...quiet, soft: on, acc: on ? Math.max(s.acc, SOFT_INTERVAL) : 0 };
}

/** Drops the piece to the bottom at once: 2 points per row dropped. */
export function blocksDrop(s: BlocksState, rng: Rng = Math.random): BlocksState {
  if (s.over) return s;
  const y = ghostY(s);
  const rows = y - s.piece.y;
  const piece = { ...s.piece, y };
  const trail: Fx[] = rows > 0 ? [{ x: (piece.x + piece.shape.length / 2) / BLOCKS_W, y: (y + 1) / BLOCKS_H, color: BLOCK_COLORS[(piece.color - 1) % BLOCK_COLORS.length] }] : [];
  return lock({ ...s, piece, score: s.score + rows * 2, soft: false }, rng, trail, 'medium');
}

/** Puts the piece aside (or swaps it with the one already held); once per piece. */
export function blocksHold(s: BlocksState, rng: Rng = Math.random): BlocksState {
  if (s.over || !s.canHold) return { ...s, ...quiet };
  const held = s.piece.id;
  const next = s.hold === null ? nextPiece({ ...s, hold: held }, rng) : nextPiece({ ...s, hold: held }, rng, s.hold);
  return { ...next, canHold: false, fx: NO_FX, buzz: 'light' };
}

/* ------------------------------------------------------------------ *
 * Lane runner: switch between three lanes to dodge what comes at you,
 * and pick up coins on the way.
 * ------------------------------------------------------------------ */

export const LANES = 3;
/** Where the player sits, as a fraction of the track's height from the top. */
export const RUNNER_Y = 0.85;
const HIT = 0.055;
const COIN_POINTS = 25;

export interface Obstacle {
  id: number;
  lane: number;
  /** 0 at the top of the track, 1 at the bottom. */
  y: number;
}

export interface RunnerState extends Feedback {
  lane: number;
  /** Where the player is drawn: eases toward `lane`, so a switch slides instead of jumping. */
  x: number;
  obstacles: Obstacle[];
  coins: Obstacle[];
  /** Track lengths per second. */
  speed: number;
  distance: number;
  /** Distance until the next row of obstacles. */
  gap: number;
  nextId: number;
  /** Points from coins, on top of the distance. */
  bonus: number;
  score: number;
  over: boolean;
}

export function newRunner(): RunnerState {
  return { lane: 1, x: 1, obstacles: [], coins: [], speed: 0.5, distance: 0, gap: 0.3, nextId: 1, bonus: 0, score: 0, over: false, ...quiet };
}

export function runnerMove(s: RunnerState, dir: -1 | 1): RunnerState {
  if (s.over) return s;
  return { ...s, ...quiet, lane: clamp(s.lane + dir, 0, LANES - 1) };
}

export function runnerTick(s: RunnerState, dt: number, speedFactor = 1, rng: Rng = Math.random): RunnerState {
  if (s.over) return s;
  const { n, h } = substeps(dt);
  let { obstacles, coins, gap, nextId, distance, bonus, speed, x } = s;
  const fx: Fx[] = [];
  let buzz: Buzz = null;
  for (let i = 0; i < n; i++) {
    const d = h * speed * speedFactor;
    x += (s.lane - x) * Math.min(1, h * 22);
    obstacles = obstacles.map((o) => ({ ...o, y: o.y + d })).filter((o) => o.y < 1.1);
    coins = coins.map((o) => ({ ...o, y: o.y + d })).filter((o) => o.y < 1.1);
    gap -= d;
    if (gap <= 0) {
      // One or two blocked lanes per row, never all three, so there is always a way through.
      const first = Math.floor(rng() * LANES);
      const blocked = [first];
      if (rng() < 0.35) blocked.push((first + 1 + Math.floor(rng() * 2)) % LANES);
      for (const lane of blocked) obstacles.push({ id: nextId++, lane, y: -0.05 });
      // Coins sit between rows, in a lane the row just placed leaves open.
      const open = [0, 1, 2].filter((l) => !blocked.includes(l));
      if (rng() < 0.55) coins.push({ id: nextId++, lane: open[Math.floor(rng() * open.length)], y: -0.05 - 0.16 });
      gap = 0.32 + rng() * 0.25;
    }
    distance += d;
    speed = Math.min(1.6, 0.5 + distance * 0.012);
    const got = coins.find((c) => c.lane === s.lane && Math.abs(c.y - RUNNER_Y) < HIT);
    if (got) {
      coins = coins.filter((c) => c !== got);
      bonus += COIN_POINTS;
      fx.push({ x: (s.lane + 0.5) / LANES, y: RUNNER_Y, text: `+${COIN_POINTS}`, color: GOLD });
      buzz = stronger(buzz, 'light');
    }
    if (obstacles.some((o) => o.lane === s.lane && Math.abs(o.y - RUNNER_Y) < HIT)) {
      fx.push({ x: (s.lane + 0.5) / LANES, y: RUNNER_Y, color: RED, big: true });
      return { ...s, x, obstacles, coins, gap, nextId, distance, speed, bonus, score: Math.floor(distance * 10) + bonus, over: true, fx, buzz: 'error' };
    }
  }
  return { ...s, x, obstacles, coins, gap, nextId, distance, speed, bonus, score: Math.floor(distance * 10) + bonus, fx: fx.length ? fx : NO_FX, buzz };
}

/* ------------------------------------------------------------------ *
 * Snake: eat, grow, don't hit the walls or yourself.
 * ------------------------------------------------------------------ */

export const SNAKE_N = 15;
export type Dir = 'up' | 'down' | 'left' | 'right';
const DELTA: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };
const FOOD_POINTS = 10;

export interface SnakeState extends Feedback {
  /** Head first, as [x, y]. */
  body: [number, number][];
  /** Where each segment was before the last step, for smooth drawing between cells. */
  prev: [number, number][];
  dir: Dir;
  /** Turns queued by quick swipes, applied one per step. */
  queue: Dir[];
  /** Null once the board is full. */
  food: [number, number] | null;
  eaten: number;
  score: number;
  over: boolean;
  /** Filled the whole board. */
  won: boolean;
  acc: number;
  ate: boolean;
}

function placeFood(body: [number, number][], rng: Rng): [number, number] | null {
  const taken = new Set(body.map(([x, y]) => y * SNAKE_N + x));
  const free: [number, number][] = [];
  for (let y = 0; y < SNAKE_N; y++) for (let x = 0; x < SNAKE_N; x++) if (!taken.has(y * SNAKE_N + x)) free.push([x, y]);
  return free.length ? free[Math.floor(rng() * free.length)] : null;
}

export function newSnake(rng: Rng = Math.random): SnakeState {
  const mid = Math.floor(SNAKE_N / 2);
  const body: [number, number][] = [
    [mid, mid],
    [mid - 1, mid],
    [mid - 2, mid],
  ];
  return { body, prev: body, dir: 'right', queue: [], food: placeFood(body, rng), eaten: 0, score: 0, over: false, won: false, acc: 0, ate: false, ...quiet };
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
  const ate = !!s.food && head[0] === s.food[0] && head[1] === s.food[1];
  // The tail moves away this step unless the snake grows, so moving into it is allowed.
  const rest = ate ? s.body : s.body.slice(0, -1);
  const hit = head[0] < 0 || head[1] < 0 || head[0] >= SNAKE_N || head[1] >= SNAKE_N || rest.some(([x, y]) => x === head[0] && y === head[1]);
  const at = (p: [number, number]): Fx => ({ x: (p[0] + 0.5) / SNAKE_N, y: (p[1] + 0.5) / SNAKE_N });
  if (hit) return { ...s, dir, queue, over: true, ate: false, fx: [{ ...at(s.body[0]), color: RED, big: true }], buzz: 'error' };
  const body: [number, number][] = [head, ...rest];
  // Each segment slides from where it was; a new tail segment appears where the old tail was.
  const prev = body.map((_, i) => s.body[Math.min(i, s.body.length - 1)]);
  const food = ate ? placeFood(body, rng) : s.food;
  const eaten = s.eaten + (ate ? 1 : 0);
  const won = ate && food === null;
  return {
    ...s,
    body,
    prev,
    dir,
    queue,
    food,
    eaten,
    score: s.score + (ate ? FOOD_POINTS * (1 + Math.floor(eaten / 10)) : 0),
    ate,
    won,
    over: won,
    fx: ate ? [{ ...at(head), text: `+${FOOD_POINTS * (1 + Math.floor(eaten / 10))}`, color: GREEN }] : NO_FX,
    buzz: won ? 'success' : ate ? 'light' : null,
  };
}

/** Seconds per step: starts relaxed and speeds up as the snake grows. */
export const snakeInterval = (eaten: number) => Math.max(0.07, 0.2 - eaten * 0.004);

export function snakeTick(s: SnakeState, dt: number, speed = 1, rng: Rng = Math.random): SnakeState {
  if (s.over) return s;
  let next: SnakeState = { ...s, acc: s.acc + Math.min(Math.max(dt, 0), MAX_FRAME), ate: false, ...quiet };
  let fx: Fx[] = [];
  let buzz: Buzz = null;
  for (let i = 0; i < 3 && !next.over && next.acc >= snakeInterval(next.eaten) / speed; i++) {
    const acc = next.acc - snakeInterval(next.eaten) / speed;
    next = { ...snakeStep(next, rng), acc };
    fx = fx.concat(next.fx);
    buzz = stronger(buzz, next.buzz);
  }
  return { ...next, fx: fx.length ? fx : NO_FX, buzz };
}

/** How far the snake is between its last cell and the next, 0..1, for smooth drawing. */
export const snakeProgress = (s: SnakeState, speed = 1) => (s.over ? 1 : clamp(s.acc / (snakeInterval(s.eaten) / speed), 0, 1));

/* ------------------------------------------------------------------ *
 * Flyer: tap to rise, fall otherwise, slip through the gaps.
 * ------------------------------------------------------------------ */

export const FLYER_X = 0.28;
export const FLYER_R = 0.035;
/** Collisions use a slightly smaller circle than the sprite: near misses should feel fair. */
const FLYER_HIT = FLYER_R * 0.8;
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

export interface FlyerState extends Feedback {
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
  return { y: 0.45, vy: 0, walls: [], nextId: 1, score: 0, over: false, started: false, ...quiet };
}

export function flyerFlap(s: FlyerState): FlyerState {
  if (s.over) return s;
  return { ...s, ...quiet, vy: FLAP, started: true };
}

export function flyerTick(s: FlyerState, dt: number, speed = 1, rng: Rng = Math.random): FlyerState {
  if (s.over || !s.started) return s.fx === NO_FX && !s.buzz ? s : { ...s, ...quiet };
  const { n, h } = substeps(dt);
  let { y, vy, walls, nextId, score } = s;
  const fx: Fx[] = [];
  let buzz: Buzz = null;
  for (let i = 0; i < n; i++) {
    vy += GRAVITY * h;
    y += vy * h;
    // The ceiling stops you rather than ending the run.
    if (y < FLYER_R) [y, vy] = [FLYER_R, Math.max(vy, 0)];
    walls = walls
      .map((w) => ({ ...w, x: w.x - SCROLL * speed * h }))
      .filter((w) => w.x > -WALL_W)
      .map((w) => {
        if (!w.passed && w.x + WALL_W < FLYER_X - FLYER_R) {
          score++;
          fx.push({ x: FLYER_X, y: y - 0.06, text: '+1', color: GOLD });
          buzz = stronger(buzz, 'light');
          return { ...w, passed: true };
        }
        return w;
      });
    const last = walls[walls.length - 1];
    if (!last || last.x < 0.55) {
      // Gaps get a little narrower as the score climbs, and never jump too far from the last one.
      const gapH = Math.max(0.24, 0.34 - score * 0.004);
      const from = last ? last.gapY : 0.5;
      const gapY = clamp(from + (rng() - 0.5) * 0.55, 0.22, 0.78);
      walls.push({ id: nextId++, x: 1.05, gapY, gapH, passed: false });
    }
    const hitWall = walls.some(
      (w) => FLYER_X + FLYER_HIT > w.x && FLYER_X - FLYER_HIT < w.x + WALL_W && (y - FLYER_HIT < w.gapY - w.gapH / 2 || y + FLYER_HIT > w.gapY + w.gapH / 2),
    );
    if (hitWall || y > 1 - FLYER_R) {
      fx.push({ x: FLYER_X, y, color: RED, big: true });
      return { ...s, y, vy, walls, nextId, score, over: true, fx, buzz: 'error' };
    }
  }
  return { ...s, y, vy, walls, nextId, score, fx: fx.length ? fx : NO_FX, buzz };
}

/* ------------------------------------------------------------------ *
 * Bricks: bounce the ball off the paddle to break every brick.
 * ------------------------------------------------------------------ */

export const BRICK_COLS = 8;
export const BRICK_ROWS = 5;
export const BRICK_TOP = 0.1;
export const BRICK_H = 0.045;
export const PADDLE_Y = 0.92;
export const PADDLE_W = 0.24;
export const PADDLE_H = 0.018;
export const BALL_R = 0.018;
/** The board is drawn taller than it is wide; positions are fractions of each, so the ball's
 *  radius in height units is the width radius divided by the board's aspect ratio. */
export const BRICKS_ASPECT = 1.45;
const BALL_RY = BALL_R / BRICKS_ASPECT;

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface BricksState extends Feedback {
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
  /** Bricks broken since the ball last touched the paddle: each one scores more. */
  chain: number;
  over: boolean;
}

/** Brick layout for a level: from level 3, the top rows take two hits. */
export function brickLayout(level: number): number[] {
  return Array.from({ length: BRICK_ROWS * BRICK_COLS }, (_, i) => (level >= 3 && Math.floor(i / BRICK_COLS) < Math.min(BRICK_ROWS, level - 2) ? 2 : 1));
}

export function newBricks(): BricksState {
  return {
    paddle: 0.5,
    ball: { x: 0.5, y: PADDLE_Y - BALL_RY, vx: 0, vy: 0 },
    stuck: true,
    wait: 0.8,
    bricks: brickLayout(1),
    lives: START_LIVES,
    level: 1,
    score: 0,
    chain: 0,
    over: false,
    ...quiet,
  };
}

/** Ball speed in board widths per second; the height axis is scaled to match. */
const ballSpeed = (level: number, speed: number) => 0.62 * (1 + 0.08 * (level - 1)) * speed;
const MAX_SPEEDUP = 1.45;

export function bricksMove(s: BricksState, dx: number): BricksState {
  if (s.over) return s;
  return { ...s, ...quiet, paddle: clamp(s.paddle + dx, PADDLE_W / 2, 1 - PADDLE_W / 2) };
}

export function bricksTick(s: BricksState, dt: number, speed = 1, rng: Rng = Math.random): BricksState {
  if (s.over) return s;
  const { n, h } = substeps(dt, 1 / 240);
  const t = n * h;
  if (s.stuck) {
    const wait = s.wait - t;
    const ball = { ...s.ball, x: s.paddle, y: PADDLE_Y - BALL_RY };
    if (wait > 0) return { ...s, ...quiet, wait, ball };
    const v = ballSpeed(s.level, speed);
    const angle = (rng() < 0.5 ? -1 : 1) * (0.25 + rng() * 0.3); // radians off vertical
    return { ...s, ...quiet, stuck: false, wait: 0, chain: 0, ball: { ...ball, vx: Math.sin(angle) * v, vy: (-Math.cos(angle) * v) / BRICKS_ASPECT } };
  }
  let { x, y, vx, vy } = s.ball;
  let { bricks, score, chain } = s;
  const fx: Fx[] = [];
  let buzz: Buzz = null;
  const base = ballSpeed(s.level, speed);
  for (let i = 0; i < n; i++) {
    x += vx * h;
    y += vy * h;
    if (x < BALL_R) [x, vx] = [BALL_R, Math.abs(vx)];
    if (x > 1 - BALL_R) [x, vx] = [1 - BALL_R, -Math.abs(vx)];
    if (y < BALL_RY) [y, vy] = [BALL_RY, Math.abs(vy)];
    // Paddle: where it hits sets the angle, like aiming; each return is a touch quicker.
    if (vy > 0 && y + BALL_RY >= PADDLE_Y && y - BALL_RY <= PADDLE_Y + PADDLE_H && Math.abs(x - s.paddle) <= PADDLE_W / 2 + BALL_R) {
      const cur = Math.hypot(vx, vy * BRICKS_ASPECT);
      const v = Math.min(cur * 1.015, base * MAX_SPEEDUP);
      const off = clamp((x - s.paddle) / (PADDLE_W / 2), -1, 1);
      // Never straight up: a dead-centre hit would bounce in the same column forever.
      const sign = off !== 0 ? Math.sign(off) : vx >= 0 ? 1 : -1;
      const angle = sign * clamp(Math.abs(off) * 1.05, 0.22, 1.05);
      vx = Math.sin(angle) * v;
      vy = (-Math.cos(angle) * v) / BRICKS_ASPECT;
      y = PADDLE_Y - BALL_RY;
      chain = 0;
      buzz = stronger(buzz, 'light');
    }
    // Bricks: find the overlapped brick with the deepest overlap, and bounce off the side it was hit on.
    let best = -1;
    let bestDepth = 0;
    let bestAxis: 'x' | 'y' = 'y';
    const r0 = Math.floor((y - BALL_RY - BRICK_TOP) / BRICK_H);
    const r1 = Math.floor((y + BALL_RY - BRICK_TOP) / BRICK_H);
    const c0 = Math.floor((x - BALL_R) * BRICK_COLS);
    const c1 = Math.floor((x + BALL_R) * BRICK_COLS);
    for (let r = Math.max(0, r0); r <= Math.min(BRICK_ROWS - 1, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.min(BRICK_COLS - 1, c1); c++) {
        const k = r * BRICK_COLS + c;
        if (!bricks[k]) continue;
        const left = c / BRICK_COLS;
        const top = BRICK_TOP + r * BRICK_H;
        const ox = Math.min(x + BALL_R, left + 1 / BRICK_COLS) - Math.max(x - BALL_R, left);
        const oy = Math.min(y + BALL_RY, top + BRICK_H) - Math.max(y - BALL_RY, top);
        if (ox <= 0 || oy <= 0) continue;
        // Compare overlaps in the same units (board widths).
        const depth = Math.min(ox, oy * BRICKS_ASPECT);
        if (depth > bestDepth) {
          bestDepth = depth;
          best = k;
          bestAxis = ox < oy * BRICKS_ASPECT ? 'x' : 'y';
        }
      }
    }
    if (best >= 0) {
      bricks = [...bricks];
      bricks[best]--;
      chain++;
      const pts = 10 * s.level * Math.min(chain, 8);
      score += pts;
      const r = Math.floor(best / BRICK_COLS);
      const c = best % BRICK_COLS;
      const left = c / BRICK_COLS;
      const top = BRICK_TOP + r * BRICK_H;
      if (bestAxis === 'x') {
        vx = x < left + 0.5 / BRICK_COLS ? -Math.abs(vx) : Math.abs(vx);
        x = vx < 0 ? left - BALL_R : left + 1 / BRICK_COLS + BALL_R;
      } else {
        vy = y < top + BRICK_H / 2 ? -Math.abs(vy) : Math.abs(vy);
        y = vy < 0 ? top - BALL_RY : top + BRICK_H + BALL_RY;
      }
      fx.push({ x: (c + 0.5) / BRICK_COLS, y: top + BRICK_H / 2, color: BRICK_ROW_COLORS[r % BRICK_ROW_COLORS.length], text: bricks[best] ? undefined : `+${pts}` });
      buzz = stronger(buzz, bricks[best] ? 'light' : 'medium');
    }
    if (y > 1 + BALL_RY) {
      const lives = s.lives - 1;
      fx.push({ x, y: 1, color: RED, big: true });
      if (lives <= 0) return { ...s, lives: 0, over: true, ball: { x, y, vx, vy }, bricks, score, chain, fx, buzz: 'error' };
      return { ...s, lives, stuck: true, wait: 0.8, chain: 0, ball: { x: s.paddle, y: PADDLE_Y - BALL_RY, vx: 0, vy: 0 }, bricks, score, fx, buzz: 'error' };
    }
    if (bricks.every((b) => b === 0)) {
      const level = s.level + 1;
      const bonus = 100 * s.level;
      fx.push({ x: 0.5, y: 0.45, text: `LEVEL CLEAR +${bonus}`, big: true, color: GOLD });
      return { ...s, level, score: score + bonus, chain: 0, bricks: brickLayout(level), stuck: true, wait: 1, ball: { x: s.paddle, y: PADDLE_Y - BALL_RY, vx: 0, vy: 0 }, fx, buzz: 'success' };
    }
  }
  return { ...s, ball: { x, y, vx, vy }, bricks, score, chain, fx: fx.length ? fx : NO_FX, buzz };
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
  /** Hits left: tougher ones (from level 3) take two, and score triple. */
  hp: number;
  tough: boolean;
}

export interface ShooterState extends Feedback {
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
  /** Seconds played, for the scrolling starfield. */
  elapsed: number;
}

export function newShooter(): ShooterState {
  return { ship: 0.5, shots: [], enemies: [], lives: START_LIVES, level: 1, score: 0, kills: 0, over: false, fireAcc: 0, spawnAcc: 0.6, grace: 0, nextId: 1, elapsed: 0, ...quiet };
}

export function shooterMove(s: ShooterState, dx: number): ShooterState {
  if (s.over) return s;
  return { ...s, ...quiet, ship: clamp(s.ship + dx, 0.06, 0.94) };
}

export function shooterTick(s: ShooterState, dt: number, speed = 1, rng: Rng = Math.random): ShooterState {
  if (s.over) return s;
  const { n, h } = substeps(dt);
  let { nextId, score, kills, level, lives, grace, shots, enemies, fireAcc, spawnAcc } = s;
  const fx: Fx[] = [];
  let buzz: Buzz = null;
  for (let i = 0; i < n; i++) {
    grace = Math.max(0, grace - h);
    shots = shots.map((b) => ({ ...b, y: b.y - 1.4 * h })).filter((b) => b.y > -0.05);
    fireAcc += h;
    if (fireAcc >= 0.28) {
      fireAcc -= 0.28;
      shots.push({ id: nextId++, x: s.ship, y: SHIP_Y - 0.04 });
    }
    const fall = (0.12 + 0.02 * level) * speed;
    enemies = enemies.map((e) => {
      let x = e.x + e.vx * h;
      let vx = e.vx;
      if (x < 0.05 || x > 0.95) [x, vx] = [clamp(x, 0.05, 0.95), -vx];
      return { ...e, x, vx, y: e.y + fall * h };
    });
    spawnAcc -= h;
    if (spawnAcc <= 0) {
      spawnAcc = Math.max(0.35, 1.1 - 0.08 * level) / speed;
      const tough = level >= 3 && rng() < Math.min(0.35, 0.1 * (level - 2));
      enemies.push({ id: nextId++, x: 0.08 + rng() * 0.84, y: -0.04, vx: (rng() < 0.5 ? -1 : 1) * (0.05 + rng() * 0.15), hp: tough ? 2 : 1, tough });
    }
    // Shots against enemies.
    const used = new Set<number>();
    enemies = enemies.flatMap((e) => {
      const b = shots.find((sh) => !used.has(sh.id) && Math.abs(sh.x - e.x) < 0.055 && Math.abs(sh.y - e.y) < 0.045);
      if (!b) return [e];
      used.add(b.id);
      if (e.hp > 1) {
        fx.push({ x: e.x, y: e.y, color: GOLD });
        return [{ ...e, hp: e.hp - 1 }];
      }
      const pts = 10 * level * (e.tough ? 3 : 1);
      score += pts;
      kills++;
      fx.push({ x: e.x, y: e.y, color: RED, text: `+${pts}` });
      buzz = stronger(buzz, 'light');
      if (kills % 15 === 0) {
        level++;
        buzz = stronger(buzz, 'success');
      }
      return [];
    });
    shots = shots.filter((b) => !used.has(b.id));
    // Enemies that reach you, or get past.
    let hit = false;
    enemies = enemies.filter((e) => {
      const rams = e.y > SHIP_Y - 0.04 && e.y < SHIP_Y + 0.04 && Math.abs(e.x - s.ship) < 0.08;
      // One that gets past flies off the bottom before it counts, so it's seen leaving rather
      // than vanishing just above the edge.
      const past = e.y > 1.04;
      if (rams || past) {
        hit = true;
        fx.push(rams ? { x: s.ship, y: SHIP_Y, color: RED, big: true } : { x: e.x, y: 0.95, color: RED, text: 'Missed!' });
        return false;
      }
      return true;
    });
    if (hit && grace === 0) {
      lives--;
      grace = GRACE;
      buzz = 'error';
      if (lives <= 0) break;
    }
  }
  return { ...s, shots, enemies, nextId, score, kills, level, lives, grace, fireAcc, spawnAcc, elapsed: s.elapsed + n * h, over: lives <= 0, fx: fx.length ? fx : NO_FX, buzz };
}

/* ------------------------------------------------------------------ *
 * Catch: slide the basket under the good things, away from the bad.
 * Catching in a row builds a multiplier; a rare golden one is worth more.
 * ------------------------------------------------------------------ */

export const BASKET_Y = 0.9;
const CATCH_HALF_W = 0.12;
/** The basket's mouth, as heights above and below its line. */
const CATCH_ABOVE = 0.05;
const CATCH_BELOW = 0.03;

export interface Falling {
  id: number;
  x: number;
  y: number;
  kind: 'good' | 'bad' | 'gold';
}

export interface CatchState extends Feedback {
  basket: number;
  items: Falling[];
  lives: number;
  level: number;
  score: number;
  caught: number;
  /** Good catches in a row: every 5 adds to the multiplier, up to ×5. */
  streak: number;
  over: boolean;
  spawnAcc: number;
  nextId: number;
  /** Set for one frame when something is caught or missed, for the view. */
  event: 'catch' | 'ouch' | null;
}

export const catchMultiplier = (streak: number) => Math.min(5, 1 + Math.floor(streak / 5));

export function newCatch(): CatchState {
  return { basket: 0.5, items: [], lives: START_LIVES, level: 1, score: 0, caught: 0, streak: 0, over: false, spawnAcc: 0.5, nextId: 1, event: null, ...quiet };
}

export function catchMove(s: CatchState, dx: number): CatchState {
  if (s.over) return s;
  return { ...s, ...quiet, basket: clamp(s.basket + dx, 0.08, 0.92) };
}

export function catchTick(s: CatchState, dt: number, speed = 1, rng: Rng = Math.random): CatchState {
  if (s.over) return s;
  const { n, h } = substeps(dt);
  let { nextId, score, caught, level, lives, streak, items, spawnAcc } = s;
  let event: CatchState['event'] = null;
  const fx: Fx[] = [];
  let buzz: Buzz = null;
  for (let i = 0; i < n && lives > 0; i++) {
    const fall = (0.35 + 0.04 * level) * speed;
    const kept: Falling[] = [];
    for (const it of items) {
      const prevY = it.y;
      const y = it.y + fall * h;
      // Caught anywhere in the basket's mouth, not only on one line: sliding under a fruit just
      // as it reaches the basket counts. Checked over the whole step, so speed can't skip it.
      const inMouth = prevY <= BASKET_Y + CATCH_BELOW && y >= BASKET_Y - CATCH_ABOVE;
      if (inMouth && Math.abs(it.x - s.basket) < CATCH_HALF_W) {
        if (it.kind === 'bad') {
          lives--;
          streak = 0;
          event = 'ouch';
          fx.push({ x: it.x, y: BASKET_Y, color: RED, big: true });
          buzz = 'error';
        } else {
          const mult = catchMultiplier(streak);
          const pts = 10 * level * mult * (it.kind === 'gold' ? 5 : 1);
          score += pts;
          caught++;
          streak++;
          event = 'catch';
          fx.push({ x: it.x, y: BASKET_Y - 0.04, color: it.kind === 'gold' ? GOLD : GREEN, text: `+${pts}`, big: it.kind === 'gold' });
          if (catchMultiplier(streak) > mult) fx.push({ x: 0.5, y: 0.4, text: `×${catchMultiplier(streak)}!`, big: true, color: GOLD });
          buzz = stronger(buzz, it.kind === 'gold' ? 'medium' : 'light');
          if (caught % 10 === 0) {
            level++;
            buzz = stronger(buzz, 'success');
          }
        }
        continue;
      }
      if (y > 1.02) {
        // Letting a good one drop costs a life, arcade style.
        if (it.kind !== 'bad') {
          lives--;
          streak = 0;
          event = 'ouch';
          fx.push({ x: it.x, y: 0.98, color: RED });
          buzz = 'error';
        }
        continue;
      }
      kept.push({ ...it, y });
    }
    items = kept;
    spawnAcc -= h;
    if (spawnAcc <= 0) {
      spawnAcc = Math.max(0.35, 0.9 - 0.05 * level) / speed;
      const roll = rng();
      const kind: Falling['kind'] = roll < Math.min(0.4, 0.18 + 0.02 * level) ? 'bad' : roll > 0.96 ? 'gold' : 'good';
      items.push({ id: nextId++, x: 0.08 + rng() * 0.84, y: -0.04, kind });
    }
  }
  return { ...s, items, nextId, score, caught, level, lives, streak, spawnAcc, event, over: lives <= 0, fx: fx.length ? fx : NO_FX, buzz };
}

/* ------------------------------------------------------------------ *
 * Whack: tap things as they pop up, before they hide again.
 * Hits in a row build a multiplier; bombs and escapes break it.
 * ------------------------------------------------------------------ */

export const HOLES = 9;

export interface Hole {
  kind: 'none' | 'good' | 'bad';
  /** Seconds until it hides. */
  t: number;
  id: number;
}

export interface WhackState extends Feedback {
  holes: Hole[];
  lives: number;
  level: number;
  score: number;
  hits: number;
  streak: number;
  over: boolean;
  spawnAcc: number;
  nextId: number;
}

const holeAt = (i: number) => ({ x: ((i % 3) + 0.5) / 3, y: (Math.floor(i / 3) + 0.5) / 3 });
export const whackMultiplier = (streak: number) => Math.min(4, 1 + Math.floor(streak / 6));

export function newWhack(): WhackState {
  return {
    holes: Array.from({ length: HOLES }, () => ({ kind: 'none' as const, t: 0, id: 0 })),
    lives: START_LIVES,
    level: 1,
    score: 0,
    hits: 0,
    streak: 0,
    over: false,
    spawnAcc: 0.8,
    nextId: 1,
    ...quiet,
  };
}

export function whackTick(s: WhackState, dt: number, speed = 1, rng: Rng = Math.random): WhackState {
  if (s.over) return s;
  const t = Math.min(Math.max(dt, 0), MAX_FRAME);
  let { lives, nextId, streak } = s;
  const fx: Fx[] = [];
  let buzz: Buzz = null;
  const holes = s.holes.map((h, i) => {
    if (h.kind === 'none') return h;
    const left = h.t - t;
    if (left > 0) return { ...h, t: left };
    // A good one that got away costs a life; a bad one hiding is fine.
    if (h.kind === 'good') {
      lives--;
      streak = 0;
      fx.push({ ...holeAt(i), color: RED });
      buzz = 'error';
    }
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
  return { ...s, holes, lives, nextId, streak, spawnAcc, over: lives <= 0, fx: fx.length ? fx : NO_FX, buzz };
}

export function whackHit(s: WhackState, i: number): WhackState {
  if (s.over || !s.holes[i] || s.holes[i].kind === 'none') return s;
  const holes = [...s.holes];
  const kind = holes[i].kind;
  holes[i] = { kind: 'none', t: 0, id: holes[i].id };
  if (kind === 'bad') {
    const lives = s.lives - 1;
    return { ...s, holes, lives, streak: 0, over: lives <= 0, fx: [{ ...holeAt(i), color: RED, big: true }], buzz: 'error' };
  }
  const hits = s.hits + 1;
  const streak = s.streak + 1;
  const mult = whackMultiplier(s.streak);
  const pts = 10 * s.level * mult;
  const level = 1 + Math.floor(hits / 10);
  const fx: Fx[] = [{ ...holeAt(i), color: GOLD, text: `+${pts}` }];
  if (whackMultiplier(streak) > mult) fx.push({ x: 0.5, y: 0.5, text: `×${whackMultiplier(streak)}!`, big: true, color: GOLD });
  return { ...s, holes, hits, streak, score: s.score + pts, level, fx, buzz: level > s.level ? 'success' : 'light' };
}
