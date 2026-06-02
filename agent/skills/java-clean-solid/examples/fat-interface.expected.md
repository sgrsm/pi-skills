# Expected SOLID review

## Findings

- **Severity:** Major
  **Principle or design smell:** ISP / fat interface
  **Location:** `UserOperations`
  **Evidence:** `UserProfileController` needs only `findById`, while `UserCsvExportJob` needs only `exportCsv`, yet both depend on the full interface with read, write, admin, export, and indexing operations.
  **Impact:** Clients and tests must depend on operations they do not use, increasing mock setup and coupling unrelated change reasons.
  **Smallest safe refactor:** Split role-focused interfaces around real clients, for example `UserReader`, `UserWriter`, `UserExporter`, and `UserAdminOperations`; migrate one client at a time.
  **Labels:** `coupling`, `testability`, `maintenance`
