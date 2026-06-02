package example.clean;

import java.math.BigDecimal;
import java.time.Instant;

class CheckoutService {
    private final OrderRepository repository;
    private final ReceiptMailer mailer;
    private final EventPublisher events;

    CheckoutService(OrderRepository repository, ReceiptMailer mailer, EventPublisher events) {
        this.repository = repository;
        this.mailer = mailer;
        this.events = events;
    }

    Receipt checkout(Order order) {
        if (order == null) {
            throw new IllegalArgumentException("order is required");
        }
        if (order.lines().isEmpty()) {
            throw new IllegalArgumentException("order must contain at least one line");
        }

        BigDecimal subtotal = BigDecimal.ZERO;
        for (OrderLine line : order.lines()) {
            BigDecimal lineTotal = line.price().multiply(BigDecimal.valueOf(line.quantity()));
            subtotal = subtotal.add(lineTotal);
        }

        BigDecimal tax = subtotal.multiply(new BigDecimal("0.20"));
        BigDecimal total = subtotal.add(tax);
        order.markCheckedOut(total, Instant.now());

        repository.save(order);
        Receipt receipt = new Receipt(order.id(), total);
        mailer.send(order.customerEmail(), "Your receipt: " + total);
        events.publish(new OrderCheckedOut(order.id(), total));
        return receipt;
    }
}
