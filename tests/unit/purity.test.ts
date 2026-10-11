import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('评分引擎与浏览器自动化解耦（§7/§21）', () => {
  const pureDirs = ['src/grading', 'src/scoring', 'src/arbiter', 'src/vision', 'src/ocr'];
  for (const dir of pureDirs) {
    it(`${dir}/ 不依赖 playwright（换平台无需改动评分系统）`, () => {
      const files = scanTs(path.join(ROOT, dir));
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        const src = readFileSync(f, 'utf-8');
        expect(src, `${path.relative(ROOT, f)} 不应 import playwright`).not.toMatch(
          /from\s+['"]playwright([^'"]*)['"]/,
        );
      }
    });
  }
});

function scanTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...scanTs(p));
    else if (entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}
