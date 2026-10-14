# Expected: java-clean-solid on dip-infrastructure-in-core

Tests: domain code that constructs and imports a vendor client is reported as DIP, while the existing domain-owned port is left alone.

## Must report

- **Major** · DIP / Dependency on volatile details · `SubscriptionBilling`. Evidence: the domain class imports `com.acme.billing.infra.stripe`, constructs `StripePaymentClient` itself with a key from `System.getenv`, and builds a Stripe-shaped request (cents, currency string), so `billMonthly` can't be tested without Stripe and the environment. Acceptable fix: a domain-owned `PaymentGateway` port with domain types (for example `charge(CustomerRef, Money)`), injected through the constructor and implemented by a Stripe adapter in `infra` that does the cents and currency mapping, labeled `refactoring`.

## May report

- The cents conversion and the hard-coded `"eur"` as adapter concerns, within the main finding.
- Non-atomic side effects (Context-dependent), as a finding or a To verify line: if `subscriptions.save` fails after the charge, the subscription is charged but not marked billed.
- Primitive Obsession: `monthlyPrice()` as an amount without a currency.

## Must not report

- A new interface for `SubscriptionRepository`, which is already a domain-owned port.
- An interface for `Subscription` or other domain types.
- An abstract factory, plugin system, or payment-provider registry as the first step.
