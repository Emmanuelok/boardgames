// Node ESM loader hook: stub out `.css` imports so component modules can be
// imported under tsx/node for SSR smoke tests (Vite handles CSS in real builds).
export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) {
    return { format: 'module', source: 'export default {};', shortCircuit: true };
  }
  return nextLoad(url, context);
}
