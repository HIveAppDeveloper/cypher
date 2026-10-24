/** Test-only resolver for the two existing TypeScript application stacks. */
import { registerHooks } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(process.env.WIRE_TEST_WORKSPACE || resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const ts = createRequire(resolve(root, 'atlas/package.json'))('typescript');
function file(path) { try { return statSync(path).isFile(); } catch { return false; } }
function candidate(base) {
  if (file(base)) return base;
  if (base.endsWith('.js') && file(base.slice(0, -3) + '.ts')) return base.slice(0, -3) + '.ts';
  for (const ext of ['.ts', '.tsx', '.mjs', '.js']) if (file(base + ext)) return base + ext;
  for (const ext of ['.ts', '.tsx', '.mjs', '.js']) if (file(resolve(base, 'index' + ext))) return resolve(base, 'index' + ext);
  return null;
}
registerHooks({ load(url, context, nextLoad) {
  if (/\.tsx?$/.test(url) && !url.includes('/node_modules/')) {
    const source = readFileSync(fileURLToPath(url), 'utf8');
    return { format: 'module', source: ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, verbatimModuleSyntax: true } }).outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}, resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const match = candidate(resolve(root, 'atlas', specifier.slice(2)));
    if (match) return { url: pathToFileURL(match).href, shortCircuit: true };
  }
  if (specifier === 'next/server') return nextResolve('next/server.js', context);
  if (specifier === 'next/headers') return nextResolve('next/headers.js', context);
  if (specifier.startsWith('.')) {
    const match = candidate(resolve(dirname(fileURLToPath(context.parentURL)), specifier));
    if (match) return { url: pathToFileURL(match).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
