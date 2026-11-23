import type { SavedApp } from '../storage/store';

/** Bundled apps: usable offline immediately, even before the user builds anything. */
export const STARTERS: SavedApp[] = [
  {
    id: 'starter-mood',
    request: 'A journal that tags my mood',
    builtWith: 'starter',
    createdAt: 0,
    updatedAt: 0,
    spec: {
      name: 'Mood Journal',
      emoji: '😊',
      accent: 'violet',
      description: 'Write about your day. Get a private mood tag and a kind reflection.',
      components: [
        { type: 'input', id: 'entry', label: 'How was your day?', multiline: true, placeholder: 'Write freely…' },
        { type: 'ai', id: 'mood', label: 'Tag my mood', prompt: 'Read this journal entry and reply with one emoji and one word for the mood: {entry}' },
        { type: 'ai', id: 'reflection', label: 'Reflect', prompt: 'In two gentle sentences, reflect back what this person is feeling and suggest one small kind action: {entry}' },
        { type: 'save', label: 'Save entry' },
        { type: 'history', label: 'Past entries' },
      ],
    },
  },
  {
    id: 'starter-tone',
    request: 'Rewrite my messages in a different tone',
    builtWith: 'starter',
    createdAt: 0,
    updatedAt: 0,
    spec: {
      name: 'Tone Fixer',
      emoji: '✉️',
      accent: 'blue',
      description: 'Paste a message and rewrite it in the tone you need.',
      components: [
        { type: 'input', id: 'message', label: 'Your message', multiline: true, placeholder: 'Paste an email or text…' },
        { type: 'choice', id: 'tone', label: 'Tone', options: ['Friendly', 'Professional', 'Shorter', 'Apologetic'] },
        { type: 'ai', id: 'rewrite', label: 'Rewrite', prompt: 'Rewrite this message in a {tone} tone. Keep the meaning. Reply with only the rewritten message: {message}' },
        { type: 'save', label: 'Save' },
        { type: 'history', label: 'Saved rewrites' },
      ],
    },
  },
  {
    id: 'starter-notes',
    request: 'Turn meeting notes into action items',
    builtWith: 'starter',
    createdAt: 0,
    updatedAt: 0,
    spec: {
      name: 'Meeting Notes',
      emoji: '📝',
      accent: 'teal',
      description: 'Turn rough notes into a summary and a to-do list.',
      components: [
        { type: 'input', id: 'title', label: 'Meeting', placeholder: 'Weekly sync' },
        { type: 'input', id: 'notes', label: 'Rough notes', multiline: true, placeholder: 'Paste or type notes…' },
        { type: 'ai', id: 'summary', label: 'Summarize', prompt: 'Summarize these meeting notes in two sentences: {notes}' },
        { type: 'ai', id: 'actions', label: 'Action items', prompt: 'List the action items from these notes as short bullet points starting with "- ". Include the owner if mentioned: {notes}' },
        { type: 'save', label: 'Save meeting' },
        { type: 'history', label: 'Past meetings' },
      ],
    },
  },
  {
    id: 'starter-flashcards',
    request: 'Make flashcards from my study notes',
    builtWith: 'starter',
    createdAt: 0,
    updatedAt: 0,
    spec: {
      name: 'Flashcards',
      emoji: '🧠',
      accent: 'amber',
      description: 'Paste study notes and get quiz questions.',
      components: [
        { type: 'input', id: 'topic', label: 'Topic', placeholder: 'Cell biology' },
        { type: 'input', id: 'notes', label: 'Study notes', multiline: true },
        { type: 'ai', id: 'cards', label: 'Make flashcards', prompt: 'Write 4 flashcards from these notes about {topic}. Format each as "Q: ..." then "A: ..." on the next line: {notes}' },
        { type: 'save', label: 'Save deck' },
        { type: 'history', label: 'Saved decks' },
      ],
    },
  },
];
