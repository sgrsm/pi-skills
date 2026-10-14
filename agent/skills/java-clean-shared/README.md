# java-clean-shared

Shared reference material for the local `java-clean-*` skills.

This folder is not a standalone skill. It holds the review rules, the smell catalog, and the fixture tooling used by:

- `java-clean-audit`
- `java-clean-code`
- `java-clean-solid`

## When to open this folder

Use it when you want to understand or change the shared conventions behind Java clean-code and SOLID reviews, especially:

- how scope, materiality, severity, and confidence are decided
- how findings are formatted and capped
- which smells each skill reports, and when a look-alike is not reported
- how example fixtures are structured and checked

## Related files

- `references/review-contract.md` - scope, evidence gathering, severity, confidence, behavior-change labels, finding format, and Java/framework constraints
- `references/smell-catalog.md` - canonical smells grouped by owning skill, with look-alikes to skip and first fixes
- `examples/RUNBOOK.md` - fixture format and the manual evaluation loop
- `examples/check-fixtures.sh` - structural fixture check (`check-fixtures.test.sh` tests it)
