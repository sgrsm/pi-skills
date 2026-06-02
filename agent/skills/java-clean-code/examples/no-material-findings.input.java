package example.clean;

import java.math.BigDecimal;
import java.util.Objects;

final class DiscountPolicy {
    private static final BigDecimal VIP_DISCOUNT = new BigDecimal("0.20");
    private static final BigDecimal STANDARD_DISCOUNT = new BigDecimal("0.05");

    Money apply(Customer customer, Money total) {
        Objects.requireNonNull(customer, "customer");
        Objects.requireNonNull(total, "total");

        if (customer.isVip()) {
            return total.minus(total.multiply(VIP_DISCOUNT));
        }
        return total.minus(total.multiply(STANDARD_DISCOUNT));
    }
}
