import { existsSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const src = fileURLToPath(new URL("../src/", import.meta.url));
const stubs = {
  "server-only": "export {}",
  "next/headers": "const unavailable = () => { throw new Error(\"No request scope in tests.\"); }; export { unavailable as cookies, unavailable as headers };",
};

function findFile(base) {
  for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(stubs, specifier)) {
      return { url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true };
    }
    let base = null;
    if (specifier.startsWith("@/")) {
      base = src + specifier.slice(2);
    } else if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      base = fileURLToPath(new URL(specifier, context.parentURL));
    }
    const file = base && findFile(base);
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".ts")) {
      return nextLoad(url, { ...context, format: "module-typescript" });
    }
    return nextLoad(url, context);
  },
});
