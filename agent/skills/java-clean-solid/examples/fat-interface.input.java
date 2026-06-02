package example.solid;

import java.util.List;

interface UserOperations {
    User findById(UserId id);
    List<User> findActiveUsers();
    void save(User user);
    void delete(UserId id);
    CsvFile exportCsv();
    void reindexSearch();
    void lockAccount(UserId id);
}

class UserProfileController {
    private final UserOperations users;

    UserProfileController(UserOperations users) {
        this.users = users;
    }

    UserProfile get(UserId id) {
        return UserProfile.from(users.findById(id));
    }
}

class UserCsvExportJob {
    private final UserOperations users;

    UserCsvExportJob(UserOperations users) {
        this.users = users;
    }

    CsvFile run() {
        return users.exportCsv();
    }
}
