package com.acme.customer;

import com.acme.billing.InvoiceService;
import java.math.BigDecimal;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

@Service
public class CustomerService {
    private static final BigDecimal CREDIT_LIMIT = new BigDecimal("500");

    private final CustomerRepository customers;
    private final InvoiceService invoices;

    public CustomerService(CustomerRepository customers, @Lazy InvoiceService invoices) {
        this.customers = customers;
        this.invoices = invoices;
    }

    public Customer get(long id) {
        return customers.findById(id).orElseThrow(() -> new CustomerNotFoundException(id));
    }

    public boolean canPlaceOrder(long customerId) {
        return invoices.outstandingBalance(customerId).compareTo(CREDIT_LIMIT) < 0;
    }
}
