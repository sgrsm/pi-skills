package example.solid;

import java.util.HashMap;
import java.util.Map;

class AccountStore {
    protected final Map<AccountId, Account> accounts = new HashMap<>();

    Account load(AccountId id) {
        Account account = accounts.get(id);
        if (account == null) {
            throw new AccountNotFoundException(id);
        }
        return account;
    }

    void save(Account account) {
        accounts.put(account.id(), account);
    }

    void delete(AccountId id) {
        accounts.remove(id);
    }
}

class ArchivedAccountStore extends AccountStore {
    @Override
    void save(Account account) {
        throw new UnsupportedOperationException("archived accounts are read-only");
    }

    @Override
    void delete(AccountId id) {
        throw new UnsupportedOperationException("archived accounts are read-only");
    }
}

class AccountClosingService {
    private final AccountStore store;

    AccountClosingService(AccountStore store) {
        this.store = store;
    }

    void close(AccountId id) {
        Account account = store.load(id);
        account.close();
        if (!(store instanceof ArchivedAccountStore)) {
            store.save(account);
        }
    }
}
