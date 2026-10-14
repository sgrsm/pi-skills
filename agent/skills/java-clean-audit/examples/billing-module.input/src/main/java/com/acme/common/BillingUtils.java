package com.acme.common;

import java.nio.charset.StandardCharsets;
import java.util.Set;

public final class BillingUtils {
    private static final Set<String> EU_COUNTRIES = Set.of("DE", "FR", "IT", "ES", "NL");

    private BillingUtils() {
    }

    public static byte[] toPdf(String text) {
        return text.getBytes(StandardCharsets.UTF_8);
    }

    public static String maskIban(String iban) {
        return iban.substring(0, 4) + "****" + iban.substring(iban.length() - 4);
    }

    public static boolean isEuCountry(String countryCode) {
        return EU_COUNTRIES.contains(countryCode);
    }
}
