// Build: maven.compiler.release=17
package example.solid;

enum Plan { FREE, TEAM, ENTERPRISE }

class PlanPricing {
    Money monthlyPrice(Plan plan, int seats) {
        switch (plan) {
            case FREE:
                return Money.ZERO;
            case TEAM:
                return Money.eur(8).times(seats);
            case ENTERPRISE:
                return Money.eur(20).times(seats);
            default:
                throw new IllegalArgumentException("Unknown plan " + plan);
        }
    }
}

class PlanLimits {
    int maxProjects(Plan plan) {
        switch (plan) {
            case FREE:
                return 3;
            case TEAM:
                return 50;
            default:
                return Integer.MAX_VALUE;
        }
    }
}

class InvoiceText {
    String planLabel(Plan plan) {
        if (plan == Plan.FREE) {
            return "Free";
        }
        if (plan == Plan.TEAM) {
            return "Team";
        }
        return "Enterprise";
    }
}
