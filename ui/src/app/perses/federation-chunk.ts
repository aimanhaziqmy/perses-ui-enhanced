const FEDERATION_FACTORY_PATTERN =
  /return\s+async\s*\(\)\s*=>\s*\{\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+([A-Za-z_$][\w$]*)\(\)\s*;?\s*return\s*\(\)\s*=>\s*\1\s*;?\s*\}/g;

export function toWebpackEsmModule<T extends object>(mod: T): T {
  if (Object.prototype.hasOwnProperty.call(mod, '__esModule')) {
    return mod;
  }
  const cloned = Object.create(null) as Record<PropertyKey, unknown>;
  for (const key of Reflect.ownKeys(mod)) {
    if (key === '__esModule') continue;
    const desc = Object.getOwnPropertyDescriptor(mod, key);
    if (desc) {
      Object.defineProperty(cloned, key, desc);
    }
  }
  Object.defineProperty(cloned, '__esModule', {
    value: true,
    enumerable: false,
    configurable: false,
  });
  return cloned as T;
}

export function rewriteFederationChunk(code: string): string | null {
  FEDERATION_FACTORY_PATTERN.lastIndex = 0;
  if (!FEDERATION_FACTORY_PATTERN.test(code)) {
    return null;
  }
  FEDERATION_FACTORY_PATTERN.lastIndex = 0;
  return code.replace(FEDERATION_FACTORY_PATTERN, (_match, modVar: string, fnVar: string) => {
    return `return async () => { const ${modVar} = await ${fnVar}(); const wrapped = ${modVar} && typeof ${modVar} === 'object' && !Object.prototype.hasOwnProperty.call(${modVar}, '__esModule') ? (() => { const o = Object.create(null); Object.defineProperty(o, '__esModule', { value: true }); for (const k of Object.keys(${modVar})) { Object.defineProperty(o, k, { enumerable: true, get: () => ${modVar}[k] }); } if ('default' in ${modVar} && !Object.prototype.hasOwnProperty.call(o, 'default')) { Object.defineProperty(o, 'default', { enumerable: true, get: () => ${modVar}.default }); } return o; })() : ${modVar}; return () => wrapped; }`;
  });
}
