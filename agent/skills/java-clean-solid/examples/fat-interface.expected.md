# Expected: java-clean-solid on fat-interface

Tests: a fat interface is reported as ISP with evidence from its actual clients.

## Must report

- **Moderate or Major** · ISP / Fat interface · `UserOperations`. Evidence: `UserProfileController` calls only `findById` and `UserCsvExportJob` calls only `exportCsv`, yet both depend on all seven read, write, admin, export, and indexing operations. Acceptable fix: role interfaces shaped by the visible clients (for example a lookup role for the controller and an export role for the job), migrating one client at a time while the implementation keeps implementing every role, labeled `refactoring`. Methods without visible clients stay where they are.

## May report

- A To verify line on whether `findById` can return `null`.
- A To verify line on where the CSV formatting lives today.

## Must not report

- One interface per method, or role interfaces for clients the fixture doesn't show.
- A numbered finding about what the unseen implementation does (for example that it formats the CSV, or that the job is a pass-through around storage).
- Changing the implementation class first.
- DIP or "abstraction owned by the wrong side" findings for the two clients; they already depend on an interface.
