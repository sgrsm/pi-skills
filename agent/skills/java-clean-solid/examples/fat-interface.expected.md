# Expected: java-clean-solid on fat-interface

Tests: a fat interface is reported as ISP with evidence from its actual clients.

## Must report

- **Moderate or Major** · ISP / Fat interface · `UserOperations`. Evidence: `UserProfileController` calls only `findById` and `UserCsvExportJob` calls only `exportCsv`, yet both depend on all seven read, write, admin, export, and indexing operations. Acceptable fix: role interfaces shaped by the clients (for example a lookup role for the controller and an export role for the job), migrating one client at a time while the implementation keeps implementing every role, labeled `refactoring`.

## May report

- A Hypothesis note on whether `findById` can return `null`, phrased as something to verify.

## Must not report

- One interface per method.
- Changing the implementation class first, or claiming facts about an implementation the fixture doesn't show.
- DIP findings for the two clients; they already depend on an interface.
