package com.acme.billing.web;

import com.acme.billing.Invoice;
import com.acme.billing.InvoiceService;
import com.stripe.exception.StripeException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.math.BigDecimal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/invoices")
class InvoiceController {
    private final InvoiceService invoices;

    InvoiceController(InvoiceService invoices) {
        this.invoices = invoices;
    }

    @PostMapping
    InvoiceResponse issue(@Valid @RequestBody IssueInvoiceRequest request) throws StripeException {
        return InvoiceResponse.from(invoices.issue(request.customerId(), request.net()));
    }
}

record IssueInvoiceRequest(@Positive long customerId, @NotNull @Positive BigDecimal net) {
}

record InvoiceResponse(long id, BigDecimal gross) {
    static InvoiceResponse from(Invoice invoice) {
        return new InvoiceResponse(invoice.getId(), invoice.getGross());
    }
}
