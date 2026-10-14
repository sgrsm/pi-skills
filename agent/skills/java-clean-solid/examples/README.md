# java-clean-solid evaluation fixtures

Calibration data for future skill edits, not runtime references. See `../../java-clean-shared/examples/RUNBOOK.md` for the expected-file format and the evaluation loop.

Findings expected:

- `fat-interface`: ISP with evidence from what each client calls.
- `lsp-refused-bequest`: a subtype that throws for inherited writes, with the caller's `instanceof` check as evidence.
- `dip-infrastructure-in-core`: domain code that constructs a vendor client; the existing domain-owned port is left alone.
- `repeated-switch-ocp`: the same enum switched on in three classes, with silent defaults as the cost; Java 17 fixes only.

Restraint expected:

- `valid-application-service`: a cohesive application service isn't flagged for SRP because it has several collaborators.
- `sealed-exhaustive-switch`: exhaustive switches over a sealed hierarchy on Java 21 aren't treated as an OCP violation.

The `java-clean-code` fixture `god-class-root-cause` also applies to this skill.
