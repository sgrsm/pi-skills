package com.acme.billing;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.mail.javamail.JavaMailSender;

@SpringBootTest
class InvoiceServiceTest {
    @Autowired
    InvoiceService service;

    @MockBean
    JavaMailSender mail;

    @Test
    @Disabled("needs STRIPE_API_KEY and a Stripe test customer")
    void appliesGermanVat() throws Exception {
        Invoice invoice = service.issue(1L, new BigDecimal("100.00"));

        assertThat(invoice.getGross()).isEqualByComparingTo("119.00");
    }
}
