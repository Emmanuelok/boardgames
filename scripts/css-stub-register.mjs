// Registers the CSS-stub loader so `npx tsx --import ...` can import component
// modules (which pull in `.css`) under Node for SSR smoke tests.
import { register } from 'node:module';
register('./css-stub.mjs', import.meta.url);
