package example.clean;

import java.time.Clock;
import java.time.Instant;

class LoyaltyService {
    private final MemberRepository members;
    private final Clock clock;

    LoyaltyService(MemberRepository members, Clock clock) {
        this.members = members;
        this.clock = clock;
    }

    boolean isEligibleForReward(MemberId id) {
        Member member = members.get(id);
        if (member.points() < 1_000) {
            return false;
        }
        member.deductPoints(1_000);
        member.recordRewardClaimed(Instant.now(clock));
        members.save(member);
        return true;
    }

    int pointsBalance(MemberId id) {
        return members.get(id).points();
    }
}

class RewardBanner {
    private final LoyaltyService loyalty;

    RewardBanner(LoyaltyService loyalty) {
        this.loyalty = loyalty;
    }

    String render(MemberId id) {
        return loyalty.isEligibleForReward(id)
                ? "You have a reward waiting!"
                : "Keep collecting points";
    }
}
