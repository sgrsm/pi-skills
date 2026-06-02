package example.solid;

class CheckoutService {
    private final CartRepository carts;
    private final CheckoutPolicy checkoutPolicy;
    private final PaymentGateway paymentGateway;
    private final ReceiptRepository receipts;
    private final CheckoutEvents events;

    CheckoutService(
            CartRepository carts,
            CheckoutPolicy checkoutPolicy,
            PaymentGateway paymentGateway,
            ReceiptRepository receipts,
            CheckoutEvents events) {
        this.carts = carts;
        this.checkoutPolicy = checkoutPolicy;
        this.paymentGateway = paymentGateway;
        this.receipts = receipts;
        this.events = events;
    }

    Receipt checkout(CheckoutCommand command) {
        Cart cart = carts.get(command.cartId());
        checkoutPolicy.validate(cart);
        Payment payment = paymentGateway.charge(cart.total(), command.paymentMethod());
        Receipt receipt = receipts.create(cart.id(), payment.id(), cart.total());
        events.checkedOut(cart.id(), receipt.id());
        return receipt;
    }
}
