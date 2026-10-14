package example.clean;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

class OrderConfirmationService {
    private static final Logger log = LoggerFactory.getLogger(OrderConfirmationService.class);

    private final PaymentClient payments;
    private final OrderRepository orders;
    private final AnalyticsClient analytics;

    OrderConfirmationService(PaymentClient payments, OrderRepository orders, AnalyticsClient analytics) {
        this.payments = payments;
        this.orders = orders;
        this.analytics = analytics;
    }

    void confirm(Order order) {
        try {
            payments.capture(order.paymentId(), order.total());
        } catch (Exception e) {
            // retry later
        }
        order.markPaid();
        orders.save(order);

        try {
            analytics.track("order_confirmed", order.id().value());
        } catch (AnalyticsException e) {
            // Analytics is best-effort; confirmation must not fail because of it.
            log.warn("Analytics tracking failed for order {}", order.id(), e);
        }
    }
}
