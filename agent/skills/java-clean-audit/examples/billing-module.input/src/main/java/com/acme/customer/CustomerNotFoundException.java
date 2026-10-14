package com.acme.customer;

public class CustomerNotFoundException extends RuntimeException {
    public CustomerNotFoundException(long id) {
        super("Customer " + id + " not found");
    }
}
