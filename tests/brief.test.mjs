import assert from 'node:assert/strict';
import { test } from 'node:test';

import { briefBase, briefEarlier, withLatestChange } from '../src/ai/brief.ts';
import { htmlPrompt } from '../src/ai/prompts.ts';

const chat = [
  { role: 'user', text: 'Make the frog white' },
  { role: 'assistant', text: 'Updating the app.' },
];

test('the code writer gets the recent chat with a follow-up', () => {
  const b1 = withLatestChange('A frog crossing game.', 'Make the frog white');
  const b2 = withLatestChange(b1, 'No, the legs too', chat);
  assert.equal(briefBase(b2), 'A frog crossing game.');
  assert.match(b2, /Latest change #2: No, the legs too$/);
  assert.match(briefEarlier(b2), /User: Make the frog white\nvon mini: Updating the app\./);
  const prompt = htmlPrompt('x', '{}', b2, '<!doctype html><html></html>');
  assert.match(prompt, /change to their app: "No, the legs too"/);
  assert.match(prompt, /chat so far[\s\S]*User: Make the frog white/);
  assert.match(prompt, /What the app is: A frog crossing game\.\n/);
});

test('the chat is replaced, not piled up, on each change', () => {
  let b = 'A game.';
  for (let i = 0; i < 5; i++) b = withLatestChange(b, `change ${i}`, [{ role: 'user', text: `ask ${i}` }]);
  assert.equal((b.match(/Earlier in this chat/g) ?? []).length, 1);
  assert.match(b, /User: ask 4\n\nLatest change #5: change 4$/);
  assert.equal(briefBase(b), 'A game.');
});

test('no chat, no chat section', () => {
  const b = withLatestChange('A game.', 'faster');
  assert.equal(briefEarlier(b), undefined);
  assert.doesNotMatch(htmlPrompt('x', '{}', b, '<html></html>'), /chat so far/);
});
