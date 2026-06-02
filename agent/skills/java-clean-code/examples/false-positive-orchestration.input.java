package example.clean;

class SubscriptionRenewalService {
    private final RenewalValidator validator;
    private final RenewalPricing pricing;
    private final SubscriptionRepository repository;
    private final RenewalEvents events;
    private final RenewalMailer mailer;

    SubscriptionRenewalService(
            RenewalValidator validator,
            RenewalPricing pricing,
            SubscriptionRepository repository,
            RenewalEvents events,
            RenewalMailer mailer) {
        this.validator = validator;
        this.pricing = pricing;
        this.repository = repository;
        this.events = events;
        this.mailer = mailer;
    }

    RenewalReceipt renew(RenewalCommand command) {
        validator.validate(command);
        RenewalQuote quote = pricing.quote(command);
        Subscription subscription = repository.renew(command.subscriptionId(), quote);
        events.renewed(subscription.id(), quote.total());
        mailer.sendRenewalReceipt(subscription.ownerEmail(), quote.total());
        return new RenewalReceipt(subscription.id(), quote.total());
    }
}
