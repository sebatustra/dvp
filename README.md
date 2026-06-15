<div align="center">
  <br />
  <h1>Solana DvP</h1>
  <h3>Atomic Delivery-versus-Payment for Solana</h3>
  <br />

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
</div>

A canonical, minimal on-chain program for atomic delivery-versus-payment (DvP) swaps between two parties on Solana. One transaction settles both legs simultaneously — no counterparty risk, no custodian, no intermediary.

## What it does

Two parties — **`user_a`** (seller) and **`user_b`** (buyer) — agree to exchange `amount_a` of `mint_a` (the _asset_ leg) for `amount_b` of `mint_b` (the _cash_ leg). A third party, the **`settlement_authority`**, is the only address allowed to atomically settle the trade. Either party (or, via Cancel, the authority) can abort before settlement and recover their funded leg.

The trade lives as a single `SwapDvp` PDA with two associated escrow ATAs (one per leg). Each side funds its own leg by sending tokens to the corresponding escrow ATA via a plain SPL Transfer — there's no custom funding instruction, so custodian integrations need no special program call. Settlement transfers both legs in a single transaction, refunds any over-deposit to the depositor, and closes the PDA + escrows.

## State

```rust
SwapDvp {
    bump: u8,
    user_a: Pubkey,                              // seller
    user_b: Pubkey,                              // buyer
    mint_a: Pubkey,                              // asset
    mint_b: Pubkey,                              // cash
    settlement_authority: Pubkey,
    amount_a: u64,
    amount_b: u64,
    expiry_timestamp: i64,                       // settlement rejected after this
    nonce: u64,                                  // disambiguates DvPs sharing other seeds
    earliest_settlement_timestamp: Option<i64>,  // optional lower bound on settlement
}
```

PDA seeds: `[b"dvp", settlement_authority, user_a, user_b, mint_a, mint_b, nonce.to_le_bytes(), bump]`.

## Lifecycle

```
                      ┌─────────────────────┐
                      │       Create        │  permissionless
                      └──────────┬──────────┘
                                 │
                ┌────────────────┴────────────────┐
                ▼                                 ▼
         ┌─────────────┐                  ┌─────────────┐
         │ SPL Transfer│                  │ SPL Transfer│  user_a / user_b
         │ → escrow A  │                  │ → escrow B  │  (raw SPL — no
         └──────┬──────┘                  └──────┬──────┘   program call)
                │                                │
                └────────────────┬───────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
 ┌─────────────┐          ┌─────────────┐          ┌─────────────┐
 │  Reclaim X  │          │   Settle    │          │ Cancel /    │
 │  (re-fund   │          │ (cash→A,    │          │ Reject      │
 │   allowed)  │          │  asset→B,   │          │ (refund all,│
 │             │          │  close all) │          │  close all) │
 └─────────────┘          └─────────────┘          └─────────────┘
```

## Instructions

| #   | Name       | Signer                 | Effect                                                                                                                       |
| --- | ---------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 0   | CreateDvp  | any                    | Allocates the SwapDvp PDA, its nonce tombstone, and both escrow ATAs. No funding.                                           |
| 1   | ReclaimDvp | `user_a` or `user_b`   | Drains signer's leg back to them. DvP stays open.                                                                            |
| 2   | SettleDvp  | `settlement_authority` | Transfers `amount_x` of each leg to recipients (cross), refunds any over-deposit to the depositor, closes SwapDvp + escrows. |
| 3   | CancelDvp  | `settlement_authority` | Refunds any funded legs to depositors, closes SwapDvp + escrows.                                                             |
| 4   | RejectDvp  | `user_a` or `user_b`   | Refunds any funded legs to depositors, closes SwapDvp + escrows.                                                             |

### Notes

- **No custom funding instruction.** Each party deposits by sending tokens directly to the escrow ATA (derivable from public state). Always use `TransferChecked` — unchecked transfers fail for Token-2022 mints with `Pausable` or `TransferHook` extensions.
- **`CreateDvp` is permissionless — a record is not proof of agreement.** Only the payer signs; `user_a`, `user_b`, and `settlement_authority` do not. Use a **cryptographically random 64-bit nonce** per trade to prevent squatting, and always **verify stored terms on-chain** (`amount_a`, `amount_b`, `expiry`, `user_a`, `user_b`, `settlement_authority`) before depositing.
- **Settle clamps to `amount_x`.** Over-deposits are refunded to the depositor — they never leak to the counterparty. Ensure all four user ATAs exist before calling `SettleDvp` (two recipients + two surplus-refund ATAs), or the transaction reverts.
- **Expiry applies only to `Settle`.** `Reclaim`, `Cancel`, and `Reject` always work regardless of expiry, so funds are never permanently stranded. Expiry is capped at one year from creation. All time gates use `Clock::unix_timestamp` — budget ~60s of drift from wall-clock time.
- **Nonces are single-use forever.** A nonce tombstone PDA is created at `CreateDvp` and never closed, so a settled or cancelled DvP address can never be reused.
- **Token-2022.** Each leg carries its own `token_program`, so a single DvP can mix SPL and Token-2022 mints. Blocked extensions: `TransferFee`, `InterestBearing`, `ScaledUiAmount`, `ConfidentialTransfer`, `NonTransferable`. Accepted but treat as trusted-authority risk: `PermanentDelegate`, `Pausable`, `DefaultAccountState`, `TransferHook` — any of these authorities can stall settlement until they cooperate.

## Errors

| Code | Variant                       | When                                                                                                                                 |
| ---- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | `SignerNotParty`              | Reclaim/Reject signer is not `user_a` or `user_b`                                                                                    |
| 1    | `DvpExpired`                  | Settle after `expiry_timestamp`                                                                                                      |
| 2    | `SettlementAuthorityMismatch` | Settle/Cancel signer is not `settlement_authority`                                                                                   |
| 3    | `SettlementTooEarly`          | Settle when `now < earliest_settlement_timestamp`                                                                                    |
| 4    | `LegNotFunded`                | Settle when an escrow holds less than its target amount                                                                              |
| 5    | `ExpiryNotInFuture`           | Create with `expiry_timestamp <= now`                                                                                                |
| 6    | `EarliestAfterExpiry`         | Create with `earliest > expiry`                                                                                                      |
| 7    | `SelfDvp`                     | Create with `user_a == user_b`                                                                                                       |
| 8    | `SameMint`                    | Create with `mint_a == mint_b`                                                                                                       |
| 9    | `ZeroAmount`                  | Create with `amount_a == 0` or `amount_b == 0`                                                                                       |
| 10   | `BlockedMintExtension`        | Create with a Token-2022 mint carrying an unsupported extension (TransferFee, InterestBearing, ScaledUiAmount, ConfidentialTransfer, ConfidentialTransferFeeConfig, NonTransferable) |
| 11   | `SettlementAuthorityIsParty`  | Create with `settlement_authority` equal to `user_a` or `user_b`                                                                    |
| 12   | `SettlementAuthorityExecutable` | Create with an executable `settlement_authority` (can't be credited closed-account rent)                                          |
| 13   | `NonceAlreadyUsed`            | Create reusing a `(seeds, nonce)` that already has a nonce tombstone (the address was used by a prior DvP)                          |
| 14   | `ExpiryTooFarInFuture`        | Create with `expiry_timestamp` more than one year past creation time                                                                |

## Build & test

```sh
make build              # generate clients + cargo-build-sbf
make unit-test          # program crate's #[cfg(test)] modules + JS client tests
make integration-test   # build + LiteSVM integration tests
make fmt                # cargo fmt + clippy + pnpm format
make verify-program-id  # pre-deploy: deploy keypair matches the declared program ID
```

The integration tests live in `tests/integration-tests/` and run against the compiled `.so` via [LiteSVM](https://github.com/LiteSVM/litesvm). See `tests/integration-tests/src/` for one directory per instruction.

### Deploying

The address in `declare_id!` (and therefore the IDL and generated clients) is a temporary placeholder. Its keypair is not available, so the program has not been deployed to it and that ID is not the program's real address. A real deployment must:

1. Generate a fresh program keypair (`solana-keygen new -o target/deploy/dvp_swap_program-keypair.json`).
2. Set `declare_id!` to its pubkey and regenerate the IDL and clients (`make build`).
3. Run `make verify-program-id` to confirm the deploy keypair matches the declared ID.
4. `solana program deploy --program-id target/deploy/dvp_swap_program-keypair.json target/deploy/dvp_swap_program.so`.

`cargo-build-sbf` writes a random deploy keypair that does not match `declare_id!`, so deploying without these steps (or without an explicit `--program-id`) publishes to the wrong address.

## Layout

```
program/         on-chain program (no_std, pinocchio-based)
clients/rust/    Codama-generated Rust client
clients/typescript/  Codama-generated TypeScript client
idl/             generated Codama IDL
tests/integration-tests/   LiteSVM integration tests
```

## Audit

This program has been audited by [Cantina](https://cantina.xyz/portfolio/fe870bb4-d96d-4902-8aec-9dfcfa2d6a79).
