/**
 * Let plain Node load the app's TypeScript modules.
 *
 * Node strips types itself, but the app imports its siblings as `./kit.js`, as TypeScript's module resolution requires, and there is no `kit.js` on disk. This maps such an import to the `.ts` file beside it.
 *
 * Import this first, then load app modules with a dynamic `import()`: static imports are all resolved before any module runs, so they would be resolved before this hook exists.
 */
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, next) {
    if (
      specifier.startsWith(`.`) &&
      specifier.endsWith(`.js`) &&
      context.parentURL?.startsWith(`file:`)
    ) {
      const url = new URL(specifier, context.parentURL);
      if (!existsSync(fileURLToPath(url))) {
        return next(`${specifier.slice(0, -3)}.ts`, context);
      }
    }
    return next(specifier, context);
  }
});
