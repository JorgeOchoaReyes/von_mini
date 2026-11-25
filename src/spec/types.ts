/**
 * An AppSpec is a small JSON description of a single-screen app. Gemini Nano can write one
 * reliably (structured output), and the runtime renders it from prebuilt building blocks.
 */
export const COMPONENT_TYPES = ['heading', 'text', 'input', 'choice', 'ai', 'voice', 'save', 'history'] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];

export const ACCENTS = ['violet', 'blue', 'teal', 'green', 'amber', 'rose'] as const;
export type Accent = (typeof ACCENTS)[number];

export interface SpecComponent {
  type: ComponentType;
  /** Field id (input / choice / ai). lowercase_snake. */
  id?: string;
  /** Label for inputs, buttons, sections. */
  label?: string;
  /** Static text for heading / text; for voice, the AI's opening line. */
  text?: string;
  placeholder?: string;
  multiline?: boolean;
  /** Options for a choice. */
  options?: string[];
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
          prompt: { type: 'string' },
        },
        required: ['type'],
      },
    },
  },
  required: ['name', 'emoji', 'components'],
} as const;
