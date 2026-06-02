package example.framework;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.stereotype.Service;

@Entity
@Table(name = "customers")
@NoArgsConstructor // required by JPA
class CustomerEntity {
    @Id
    @GeneratedValue
    private Long id;

    private String email;
    private String displayName;

    CustomerEntity(String email, String displayName) {
        this.email = email;
        this.displayName = displayName;
    }

    Long id() {
        return id;
    }

    String email() {
        return email;
    }

    String displayName() {
        return displayName;
    }
}

@Data
@NoArgsConstructor
@AllArgsConstructor
class CustomerResponseDto {
    private Long id;
    private String email;
    private String displayName;
}

@Service
class CustomerLookupService {
    private final CustomerRepository customers;

    CustomerLookupService(CustomerRepository customers) {
        this.customers = customers;
    }

    CustomerResponseDto get(Long id) {
        CustomerEntity customer = customers.getById(id);
        return new CustomerResponseDto(customer.id(), customer.email(), customer.displayName());
    }
}
