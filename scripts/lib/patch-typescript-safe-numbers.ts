import fs from "fs";
import path from "path";

/**
 * Hardens the generated TypeScript instruction codecs against silent
 * precision loss on 64-bit arguments.
 *
 * `@codama/renderers-js` types every u64/i64 arg as `number | bigint` and
 * encodes it with kit's `getU64Encoder` / `getI64Encoder`, which round any
 * `number` above `Number.MAX_SAFE_INTEGER` before it reaches the wire. For a
 * DvP that is source-of-truth corruption (see `safeNumberCodecs.ts`).
 *
 * This patch, run after the JS render:
 *   1. narrows `number | bigint` to `bigint` in the generated arg types, so
 *      the supported surface stops advertising lossless `number`, and
 *   2. swaps the bare `getU64Encoder()` / `getI64Encoder()` calls for the
 *      guarded `getSafe*` variants (imported from `safeNumberCodecs.ts`),
 *      which throw on any `number` so plain-JS callers can't round either.
 *
 * A safety net asserts the unguarded patterns don't survive, so if the
 * codama template changes and the patch no-ops, codegen fails loudly rather
 * than silently shipping the bug.
 */
export function patchTypeScriptSafeNumbers(typescriptClientsDir: string): void {
  const dir = path.join(
    typescriptClientsDir,
    "src",
    "generated",
    "instructions",
  );

  let filesPatched = 0;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".ts")) continue;
    const filePath = path.join(dir, file);
    const src = fs.readFileSync(filePath, "utf-8");

    const usesU64 = src.includes("getU64Encoder()");
    const usesI64 = src.includes("getI64Encoder()");
    if (!usesU64 && !usesI64) continue;

    let patched = src
      // 1. Honest type surface: 64-bit args must be bigint.
      .split("number | bigint")
      .join("bigint")
      // 2. Guarded encoders that reject number at runtime.
      .split("getU64Encoder()")
      .join("getSafeU64Encoder()")
      .split("getI64Encoder()")
      .join("getSafeI64Encoder()");

    // Import the guards actually used. Instruction files live two levels
    // below src, so the hand-written helper is at ../../safeNumberCodecs.
    const imports = [
      usesU64 ? "getSafeU64Encoder" : null,
      usesI64 ? "getSafeI64Encoder" : null,
    ].filter(Boolean);
    const importLine = `import { ${imports.join(", ")} } from "../../safeNumberCodecs";\n`;
    patched = importLine + patched;

    fs.writeFileSync(filePath, patched);
    filesPatched++;
  }

  // Safety net: no unguarded 64-bit surface may survive in any instruction.
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".ts")) continue;
    const src = fs.readFileSync(path.join(dir, file), "utf-8");
    if (
      src.includes("number | bigint") ||
      src.includes("getU64Encoder()") ||
      src.includes("getI64Encoder()")
    ) {
      throw new Error(
        `patchTypeScriptSafeNumbers: unguarded 64-bit arg still present in ${file}`,
      );
    }
  }

  console.log(
    `Guarded 64-bit args against number rounding in ${filesPatched} TypeScript instruction(s).`,
  );
}
