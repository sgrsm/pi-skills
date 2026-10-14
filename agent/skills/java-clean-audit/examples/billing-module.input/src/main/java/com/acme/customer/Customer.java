package com.acme.customer;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;

@Entity
public class Customer {
    @Id
    private Long id;

    private String email;
    private String country;
    private String stripeCustomerId;

    protected Customer() {
    }

    public Long id() {
        return id;
    }

    public String email() {
        return email;
    }

    public String country() {
        return country;
    }

    public String stripeCustomerId() {
        return stripeCustomerId;
    }
}
