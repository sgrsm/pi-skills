# java-clean-audit evaluation fixtures

Calibration data for future skill edits, not runtime references. See `../../java-clean-shared/examples/RUNBOOK.md` for the expected-file format and the evaluation loop.

- `billing-module`: a small Spring Boot module (directory fixture). Expected: a Critical transaction-boundary finding, a package cycle found from imports, a combined DIP and SRP finding for the invoice service, repeated country switches, a Material risks summary, and a refactoring order. The thin controller, Spring Data repository, and JPA mechanics must be left alone.
