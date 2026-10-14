# Expected: java-clean-solid on repeated-switch-ocp

Tests: the same type code handled in several places is reported once as OCP, with the silent defaults as the concrete cost and the smallest Java 17 fix first.

## Must report

- **Major (Moderate acceptable)** · Repeated Switches (OCP) · `PlanPricing.monthlyPrice`, `PlanLimits.maxProjects`, `InvoiceText.planLabel`. Evidence: three classes branch on `Plan`; adding a plan needs three edits, and two sites fail silently: `maxProjects` gives any new plan unlimited projects through `default`, and `planLabel` labels it "Enterprise". Acceptable fixes: move the price per seat, project limit, and label onto the `Plan` enum, or use exhaustive `switch` expressions without `default` so the compiler flags every site. Labeled `refactoring`.

## May report

- Magic literal (Minor): prices and limits as literals, if they are moved onto the enum anyway.

## Must not report

- A strategy registry, a Spring bean per plan, or a plugin mechanism as the first step.
- Three separate findings, one per switch.
- Pattern-matching `switch` over sealed records as the fix. The build targets Java 17, where pattern switches aren't final, and the enum already allows exhaustive switches.
