/**
 * An AppSpec is a small JSON description of a single-screen app. Gemini Nano can write one
 * reliably (structured output), and the runtime renders it from prebuilt building blocks.
 */
export const COMPONENT_TYPES = [
  'heading',
  'text',
  'stat',
  'chart',
  'input',
  'choice',
  'checklist',
  'ai',
  'voice',
  'reminder',
  'save',
  'history',
  'game',
] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];

export const INPUT_KINDS = ['text', 'number', 'yesno', 'rating', 'date'] as const;
export type InputKind = (typeof INPUT_KINDS)[number];

export const ACCENTS = ['violet', 'blue', 'teal', 'green', 'amber', 'rose'] as const;
export type Accent = (typeof ACCENTS)[number];

export interface SpecComponent {
  type: ComponentType;
  /** Field id (input / choice / ai). lowercase_snake. */
  id?: string;
  /** Label for inputs, buttons, sections. */
  label?: string;
  /** Static text for heading / text; for voice, the AI's opening line; for reminder, the message. */
  text?: string;
  /** For reminder: daily times as 24-hour "HH:MM". */
  times?: string[];
  placeholder?: string;
  multiline?: boolean;
  /** For input: what kind of value it holds. Typed values make stats and charts reliable. */
  kind?: 'text' | 'number' | 'yesno' | 'rating' | 'date';
  /** Options for a choice, or the items of a checklist. */
  options?: string[];
  /** For ai: a field id the AI's answer is written into (a number field gets just the number). */
  fills?: string;
  /** For ai: run automatically when the entry is saved, if its result is still empty. */
  auto?: boolean;
  /** For history: group entries by day. For stat/chart: see below. */
  groupBy?: 'day';
  /** For history: a field whose numbers are totalled per day, shown on each day's header. */
  total?: string;
  /** game: which built-in game, how fast, and the emoji for the player and the things around it. */
  game?: 'blocks' | 'runner' | 'snake' | 'flyer';
  speed?: 'slow' | 'normal' | 'fast';
  player?: string;
  item?: string;
  /** For chart: how many days to show (7-31). */
  days?: number;
  /** For stat / chart: the field (input, choice, checklist or ai id) whose saved values it reads. */
  field?: string;
  /** For stat / chart: how to combine the values. streak = days in a row with an entry. */
  op?: 'sum' | 'avg' | 'count' | 'min' | 'max' | 'latest' | 'streak';
  /** For stat: which saved entries count. */
  range?: 'today' | 'week' | 'all';
  /** For stat: unit shown after the number, e.g. "kcal". */
  unit?: string;
  /**
   * Instruction for the AI; may reference fields as {field_id}. For voice, who the AI plays in
   * the spoken conversation (its persona and goal).
   */
  prompt?: string;
}

export interface AppSpec {
  name: string;
  emoji: string;
  accent: Accent;
  description: string;
  components: SpecComponent[];
}

/** Flat JSON Schema, kept simple so a small on-device model can follow it. */
export const appSpecJsonSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    emoji: { type: 'string' },
    accent: { type: 'string', enum: [...ACCENTS] },
    description: { type: 'string' },
    components: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [...COMPONENT_TYPES] },
          id: { type: 'string' },
          label: { type: 'string' },
          text: { type: 'string' },
          placeholder: { type: 'string' },
          multiline: { type: 'boolean' },
          options: { type: 'array', items: { type: 'string' } },
          times: { type: 'array', items: { type: 'string' } },
          prompt: { type: 'string' },
          kind: { type: 'string', enum: ['text', 'number', 'yesno', 'rating', 'date'] },
          fills: { type: 'string' },
          auto: { type: 'boolean' },
          field: { type: 'string' },
          op: { type: 'string', enum: ['sum', 'avg', 'count', 'min', 'max', 'latest', 'streak'] },
          range: { type: 'string', enum: ['today', 'week', 'all'] },
          unit: { type: 'string' },
          days: { type: 'number' },
          groupBy: { type: 'string', enum: ['day'] },
          total: { type: 'string' },
          game: { type: 'string', enum: ['blocks', 'runner', 'snake', 'flyer'] },
          speed: { type: 'string', enum: ['slow', 'normal', 'fast'] },
          player: { type: 'string' },
          item: { type: 'string' },
        },
        required: ['type'],
      },
    },
  },
  required: ['name', 'emoji', 'components'],
} as const;
