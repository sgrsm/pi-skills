package com.acme.billing;

import com.acme.customer.Customer;
import com.acme.customer.CustomerService;
import com.stripe.Stripe;
import com.stripe.exception.StripeException;
import com.stripe.model.Charge;
import com.stripe.param.ChargeCreateParams;
import java.math.BigDecimal;
import java.math.RoundingMode;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InvoiceService {
    private final InvoiceRepository invoices;
    private final CustomerService customers;
    private final JavaMailSender mail;

    public InvoiceService(InvoiceRepository invoices, CustomerService customers, JavaMailSender mail) {
        this.invoices = invoices;
        this.customers = customers;
        this.mail = mail;
        Stripe.apiKey = System.getenv("STRIPE_API_KEY");
    }

    @Transactional
    public Invoice issue(long customerId, BigDecimal net) throws StripeException {
        Customer customer = customers.get(customerId);
        BigDecimal vat = switch (customer.country()) {
            case "DE" -> new BigDecimal("0.19");
            case "FR" -> new BigDecimal("0.20");
            default -> BigDecimal.ZERO;
        };
        BigDecimal gross = net.add(net.multiply(vat)).setScale(2, RoundingMode.HALF_UP);
        Invoice invoice = invoices.save(new Invoice(customerId, net, gross));

        Charge charge = Charge.create(ChargeCreateParams.builder()
                .setAmount(gross.movePointRight(2).longValueExact())
                .setCurrency("eur")
                .setCustomer(customer.stripeCustomerId())
                .build());
        invoice.markPaid(charge.getId());

        SimpleMailMessage message = new SimpleMailMessage();
        message.setTo(customer.email());
        message.setSubject("Invoice " + invoice.getId());
        message.setText("Amount charged: " + gross + " EUR");
        mail.send(message);
        return invoice;
    }

    public BigDecimal outstandingBalance(long customerId) {
        return invoices.findByCustomerIdAndPaidFalse(customerId).stream()
                .map(Invoice::getGross)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }
}
