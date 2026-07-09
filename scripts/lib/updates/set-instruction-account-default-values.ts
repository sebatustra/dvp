import {
  Codama,
  publicKeyValueNode,
  setInstructionAccountDefaultValuesVisitor,
} from "codama";

const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
const ATA_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

export function setInstructionAccountDefaultValues(
  contraSwapCodama: Codama,
): Codama {
  contraSwapCodama.update(
    setInstructionAccountDefaultValuesVisitor([
      {
        account: "systemProgram",
        defaultValue: publicKeyValueNode(SYSTEM_PROGRAM_ID),
      },
      // Note: `tokenProgram` (singular) is deliberately NOT defaulted. Only
      // ReclaimDvp has that account, and the program stores a per-leg token
      // program at CreateDvp and rejects a mismatch, so a legacy-SPL default
      // would produce an IncorrectProgramId failure for any Token-2022 leg.
      // Callers must pass the funded leg's token program explicitly.
      {
        account: "associatedTokenProgram",
        defaultValue: publicKeyValueNode(ATA_PROGRAM_ID),
      },
    ]),
  );
  return contraSwapCodama;
}
