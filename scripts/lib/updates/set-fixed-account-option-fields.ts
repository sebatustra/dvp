import {
  assertIsNode,
  bottomUpTransformerVisitor,
  Codama,
  optionTypeNode,
  structFieldTypeNode,
} from "codama";

/**
 * The on-chain `SwapDvp.earliest_settlement_timestamp` is fixed-width (1 tag
 * byte + 8 payload bytes, even for `None`, whose payload is a sentinel), but
 * the IDL models it as a plain Borsh `Option<i64>`. Without this, the
 * generated codec accepts the 386-byte layout the program rejects
 * (`SwapDvp::LEN` is 394).
 *
 * Marking the account field's option `fixed` makes the TS codec consume/emit
 * exactly 1 + 8 bytes, with the tag as source of truth. Instruction args are
 * left as variable-length Borsh. The Rust renderer ignores `fixed`, so the
 * Rust client's strict decoding lives in the handwritten `verify` module.
 */
export function setFixedAccountOptionFields(dvpSwapCodama: Codama): Codama {
  let matched = 0;
  dvpSwapCodama.update(
    bottomUpTransformerVisitor([
      {
        select:
          "[accountNode]swapDvp.[structFieldTypeNode]earliestSettlementTimestamp",
        transform: (node) => {
          assertIsNode(node, "structFieldTypeNode");
          assertIsNode(node.type, "optionTypeNode");
          matched += 1;
          return structFieldTypeNode({
            ...node,
            type: optionTypeNode(node.type.item, {
              prefix: node.type.prefix,
              fixed: true,
            }),
          });
        },
      },
    ]),
  );
  // Fail codegen if the selector stopped matching (e.g. a Codama or IDL
  // rename). A silent no-op would ship a SwapDvp codec that falls back to
  // variable-width Option and accepts the 386-byte forged layout the
  // on-chain program rejects.
  if (matched !== 1) {
    throw new Error(
      `setFixedAccountOptionFields: expected to patch exactly 1 SwapDvp ` +
        `option field, patched ${matched}. The generated codec would accept ` +
        `the forged short layout; refusing to render.`,
    );
  }
  return dvpSwapCodama;
}
