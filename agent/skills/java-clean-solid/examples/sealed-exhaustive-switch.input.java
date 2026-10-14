// Build: maven.compiler.release=21
package example.solid;

import java.time.YearMonth;

sealed interface PaymentMethod permits Card, BankTransfer, Wallet {}

record Card(String last4, YearMonth expiry) implements PaymentMethod {}

record BankTransfer(Iban iban) implements PaymentMethod {}

record Wallet(String provider, String token) implements PaymentMethod {}

final class PaymentFees {
    private static final int CARD_FEE_PERCENT = 2;
    private static final Money BANK_TRANSFER_FEE = Money.eur(1);
    private static final int WALLET_FEE_PERCENT = 3;

    Money feeFor(PaymentMethod method, Money amount) {
        return switch (method) {
            case Card card -> amount.percent(CARD_FEE_PERCENT);
            case BankTransfer transfer -> BANK_TRANSFER_FEE;
            case Wallet wallet -> amount.percent(WALLET_FEE_PERCENT);
        };
    }
}

final class PaymentDescriptions {
    String describe(PaymentMethod method) {
        return switch (method) {
            case Card(String last4, YearMonth expiry) -> "Card ending " + last4;
            case BankTransfer(Iban iban) -> "Transfer from " + iban.masked();
            case Wallet(String provider, String token) -> provider + " wallet";
        };
    }
}
