package com.acme.billing;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import java.math.BigDecimal;

@Entity
public class Invoice {
    @Id
    @GeneratedValue
    private Long id;

    private long customerId;
    private BigDecimal net;
    private BigDecimal gross;
    private boolean paid;
    private String chargeId;

    protected Invoice() {
    }

    public Invoice(long customerId, BigDecimal net, BigDecimal gross) {
        this.customerId = customerId;
        this.net = net;
        this.gross = gross;
    }

    public void markPaid(String chargeId) {
        this.paid = true;
        this.chargeId = chargeId;
    }

    public Long getId() {
        return id;
    }

    public long getCustomerId() {
        return customerId;
    }

    public BigDecimal getNet() {
        return net;
    }

    public BigDecimal getGross() {
        return gross;
    }

    public boolean isPaid() {
        return paid;
    }
}
