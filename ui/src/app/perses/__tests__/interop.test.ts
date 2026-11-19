import { describe, expect, it } from 'vitest';
import { rewriteFederationChunk, toWebpackEsmModule } from '../federation-chunk';

describe('Perses Module Federation interop contract (H5)', () => {
  it('wraps ESM namespace objects with non-enumerable __esModule: true and preserves getters', () => {
    let dynamicVal = 42;
    const ns = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(ns, 'answer', {
      enumerable: true,
      get: () => dynamicVal,
    });

    const wrapped = toWebpackEsmModule(ns) as Record<string, unknown>;
    expect(wrapped.__esModule).toBe(true);
    expect(Object.keys(wrapped)).toEqual(['answer']);
    expect(wrapped.answer).toBe(42);
    dynamicVal = 99;
    expect(wrapped.answer).toBe(99);

    // Idempotent when already marked __esModule
    expect(toWebpackEsmModule(wrapped)).toBe(wrapped);
  });

  it('rewrites Rollup/Vite async federation factory chunks to expose __esModule', () => {
    const sampleChunk = `function getShared() { return async () => { const mod = await loadMod(); return () => mod; } }`;
    const rewritten = rewriteFederationChunk(sampleChunk);
    expect(rewritten).not.toBeNull();
    expect(rewritten).toContain("'__esModule'");

    // Unrelated code returns null (no-op)
    expect(rewriteFederationChunk('export const x = 1;')).toBeNull();
  });
});
