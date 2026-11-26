// Lets the tests import app modules as they are written for Metro: `import x from './stats'`
// resolves to ./stats.ts. Loaded with `node --import ./tests/register.mjs --test`.
import { register } from 'node:module';

register('./resolve-ts.mjs', import.meta.url);
