// com/acme/billing/domain/SubscriptionRepository.java
package com.acme.billing.domain;

public interface SubscriptionRepository {
    Subscription get(SubscriptionId id);

    void save(Subscription subscription);
}

// com/acme/billing/domain/SubscriptionBilling.java
package com.acme.billing.domain;

import com.acme.billing.infra.stripe.StripeChargeRequest;
import com.acme.billing.infra.stripe.StripePaymentClient;

public class SubscriptionBilling {
    private final StripePaymentClient stripe = new StripePaymentClient(System.getenv("STRIPE_API_KEY"));
    private final SubscriptionRepository subscriptions;

    public SubscriptionBilling(SubscriptionRepository subscriptions) {
        this.subscriptions = subscriptions;
    }

    public void billMonthly(SubscriptionId id) {
        Subscription subscription = subscriptions.get(id);
        StripeChargeRequest request = new StripeChargeRequest(
                subscription.customerRef(),
                subscription.monthlyPrice().movePointRight(2).longValueExact(),
                "eur");
        stripe.createCharge(request);
        subscription.recordBilled();
        subscriptions.save(subscription);
    }
}
