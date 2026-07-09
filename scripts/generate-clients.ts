import fs from "fs";
import path from "path";
import { preserveConfigFiles } from "./lib/utils";
import { createDvpSwapCodamaBuilder } from "./lib/dvp-swap-codama-builder";
import { patchRustCpiAccountFlags } from "./lib/patch-rust-cpi-account-flags";
import { renderVisitor as renderRustVisitor } from "@codama/renderers-rust";
import { renderVisitor as renderJavaScriptVisitor } from "@codama/renderers-js";

const projectRoot = path.join(__dirname, "..");
const idlDir = path.join(projectRoot, "idl");
const dvpSwapIdl = JSON.parse(
  fs.readFileSync(path.join(idlDir, "dvp_swap_program.json"), "utf-8"),
);
const rustClientsDir = path.join(__dirname, "..", "clients", "rust");
const typescriptClientsDir = path.join(
  __dirname,
  "..",
  "clients",
  "typescript",
);

const dvpSwapCodama = createDvpSwapCodamaBuilder(dvpSwapIdl)
  .setInstructionAccountDefaultValues()
  .setFixedAccountOptionFields()
  .build();

const configPreserver = preserveConfigFiles(
  typescriptClientsDir,
  rustClientsDir,
);

dvpSwapCodama.accept(
  renderRustVisitor(path.join(rustClientsDir, "src", "generated"), {
    formatCode: true,
    crateFolder: rustClientsDir,
    deleteFolderBeforeRendering: true,
  }),
);

// Correct the swapped CPI remaining-account flags emitted by
// @codama/renderers-rust (see patch-rust-cpi-account-flags.ts).
patchRustCpiAccountFlags(rustClientsDir);

dvpSwapCodama.accept(
  renderJavaScriptVisitor(path.join(typescriptClientsDir, "src", "generated"), {
    formatCode: true,
    deleteFolderBeforeRendering: true,
  }),
);

configPreserver.restore();
