package com.acme.billing;

import com.acme.common.BillingUtils;
import com.acme.customer.Customer;
import org.springframework.stereotype.Component;

@Component
public class InvoicePdfRenderer {
    public byte[] render(Invoice invoice, Customer customer) {
        String vatNote = switch (customer.country()) {
            case "DE" -> "inkl. 19% MwSt.";
            case "FR" -> "TVA 20% incluse";
            default -> "";
        };
        String text = "Invoice " + invoice.getId() + "\n"
                + "Net: " + invoice.getNet() + " EUR\n"
                + "Gross: " + invoice.getGross() + " EUR " + vatNote;
        return BillingUtils.toPdf(text);
    }
}
