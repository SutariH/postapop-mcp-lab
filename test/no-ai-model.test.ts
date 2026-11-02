// The server runs no AI model. The person's own AI tool reads the links and
// writes the posts, on the person's account. This test walks the import graph
// from every entry point and fails if any file on the way imports an AI SDK
// or calls an AI service's address.

import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
const ENTRY_POINTS = ['src/stdio.ts', 'src/http.ts', 'src/remote.ts'].map((file) => path.join(ROOT, file));

/** Packages that call a language model. A name ending in "/" covers its scope. */
const AI_PACKAGES = ['@anthropic-ai/', 'openai', '@openai/', '@google/genai', '@google/generative-ai', 'ai', '@ai-sdk/', '@mistralai/', 'cohere-ai', 'ollama'];
/** Addresses of AI services, for code that calls them with fetch. */
const AI_HOSTS = /api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com|api\.mistral\.ai|api\.cohere\.(?:ai|com)/;
const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;

function isAiPackage(name: string) {
  return AI_PACKAGES.some((ai) => (ai.endsWith('/') ? name.startsWith(ai) : name === ai || name.startsWith(`${ai}/`)));
}

function resolveImport(from: string, name: string) {
  const target = path.resolve(path.dirname(from), name);
  const typescript = target.replace(/\.js$/, '.ts');
  if (existsSync(typescript)) return typescript;
  if (existsSync(target)) return target;
  throw new Error(`Cannot find ${name}, imported by ${from}`);
}

/** Every file reachable from the entry points, and every AI use on the way. */
function walk(entryPoints: string[]) {
  const files = new Set<string>();
  const problems: string[] = [];
  const queue = [...entryPoints];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);

    const code = readFileSync(file, 'utf8');
    if (AI_HOSTS.test(code)) problems.push(`${path.basename(file)} calls an AI service`);
    for (const match of code.matchAll(IMPORT)) {
      const name = match[1] ?? match[2] ?? match[3] ?? match[4] ?? '';
      if (name.startsWith('.')) queue.push(resolveImport(file, name));
      else if (isAiPackage(name)) problems.push(`${path.basename(file)} imports ${name}`);
    }
  }

  return { files, problems };
}

function filesIn(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesIn(path.join(folder, entry.name)) : [path.join(folder, entry.name)],
  );
}

describe('no AI model on the server', () => {
  it('finds no AI SDK and no AI service address on any path from an entry point', () => {
    const { problems } = walk(ENTRY_POINTS);

    expect(problems).toEqual([]);
  });

  it('reaches every file in src/, so no tool is outside the check', () => {
    const { files } = walk(ENTRY_POINTS);

    expect(filesIn(path.join(ROOT, 'src')).filter((file) => !files.has(file))).toEqual([]);
  });

  it('has no AI SDK in the dependencies', () => {
    const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };

    expect(Object.keys(manifest.dependencies).filter(isAiPackage)).toEqual([]);
  });

  // A check that never fails proves nothing. These build a tiny project with
  // a tool that uses a model, and make sure the walk catches it.
  it('catches a tool that imports an AI SDK, two files away', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'no-ai-'));
    writeFileSync(path.join(folder, 'server.ts'), "import { registerTool } from './tool.js';\n");
    writeFileSync(path.join(folder, 'tool.ts'), "import OpenAI from 'openai';\nexport const registerTool = () => new OpenAI();\n");

    expect(walk([path.join(folder, 'server.ts')]).problems).toEqual(['tool.ts imports openai']);
  });

  it('catches a tool that calls a model with fetch', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'no-ai-'));
    writeFileSync(path.join(folder, 'server.ts'), "export { summarize } from './tool.js';\n");
    writeFileSync(path.join(folder, 'tool.ts'), "export const summarize = () => fetch('https://api.anthropic.com/v1/messages');\n");

    expect(walk([path.join(folder, 'server.ts')]).problems).toEqual(['tool.ts calls an AI service']);
  });
});
