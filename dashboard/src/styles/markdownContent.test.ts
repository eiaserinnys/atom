import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');

describe('markdown content typography', () => {
  test('uses compact heading sizes for rendered markdown', () => {
    expect(css).toMatch(/\.markdown-content h1 \{[^}]*font-size: 1\.4em;/);
    expect(css).toMatch(/\.markdown-content h2 \{[^}]*font-size: 1\.2em;/);
    expect(css).not.toContain('font-size: 3.5rem');
    expect(css).not.toContain('font-size: 2.5rem');
  });
});
