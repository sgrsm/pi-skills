# Expected: java-clean-solid on lsp-refused-bequest

Tests: a subtype that refuses inherited operations is reported as LSP, using the caller's type check as evidence.

## Must report

- **Major** · LSP / Refused Bequest · `ArchivedAccountStore`, with `AccountClosingService.close` as evidence. `ArchivedAccountStore` throws `UnsupportedOperationException` for `save` and `delete`, which `AccountStore` presents as ordinary operations, and the caller already checks `instanceof ArchivedAccountStore` to avoid them. Acceptable fix: split read and write roles (for example `AccountReader` and `AccountWriter`) so the archived store only implements reading, or replace the inheritance with composition. Add a contract test for the read role before changing it. Labeled `refactoring` for the split; any change to what `close` does for archived accounts is a `behavior change`.

## May report

- Context-dependent correctness: `close` mutates an archived account in memory and silently skips saving, so the close is lost. This may be part of the main finding.
- Fragile inheritance (Minor): the protected mutable `accounts` map exposed to subclasses.

## Must not report

- Documenting the exceptions as optional operations as the main fix; the caller's `instanceof` check shows the hierarchy already costs callers.
- A deeper hierarchy as the fix.
- DIP because `AccountClosingService` depends on the concrete `AccountStore`, as a separate finding.
