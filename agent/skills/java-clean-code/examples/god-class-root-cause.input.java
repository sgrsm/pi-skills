package example.clean;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.MeterRegistry;
import java.math.BigDecimal;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Service;

@Service
class CustomerManager {
    private final JdbcTemplate jdbc;
    private final JavaMailSender mail;
    private final ObjectMapper json;
    private final MeterRegistry metrics;

    CustomerManager(JdbcTemplate jdbc, JavaMailSender mail, ObjectMapper json, MeterRegistry metrics) {
        this.jdbc = jdbc;
        this.mail = mail;
        this.json = json;
        this.metrics = metrics;
    }

    Customer register(String n, String e, String c) {
        if (e == null || !e.contains("@")) {
            throw new IllegalArgumentException("bad email");
        }
        jdbc.update("insert into customers(name, email, country) values (?, ?, ?)", n, e, c);
        SimpleMailMessage msg = new SimpleMailMessage();
        msg.setTo(e);
        msg.setSubject("Welcome!");
        msg.setText("Hello " + n);
        mail.send(msg);
        metrics.counter("customers.registered").increment();
        return new Customer(n, e, c);
    }

    String exportJson(String c) throws JsonProcessingException {
        List<Customer> list = jdbc.query(
                "select name, email, country from customers where country = ?",
                (rs, i) -> new Customer(rs.getString("name"), rs.getString("email"), rs.getString("country")),
                c);
        return json.writeValueAsString(list);
    }

    BigDecimal vatRate(String c) {
        switch (c) {
            case "DE":
                return new BigDecimal("0.19");
            case "FR":
                return new BigDecimal("0.20");
            default:
                return BigDecimal.ZERO;
        }
    }

    void sendNewsletter(String subject, String body) {
        List<String> emails = jdbc.queryForList("select email from customers", String.class);
        for (String e : emails) {
            SimpleMailMessage msg = new SimpleMailMessage();
            msg.setTo(e);
            msg.setSubject(subject);
            msg.setText(body);
            mail.send(msg);
        }
        metrics.counter("newsletter.sent").increment(emails.size());
    }
}
