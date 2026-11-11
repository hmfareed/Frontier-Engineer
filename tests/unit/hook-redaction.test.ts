import { describe, expect, it } from "vitest";
import { redactString, redactValue } from "../../scripts/hooks/lib/secret-redactor.ts";

describe("secret redaction engine", () => {
  it("redacts PEM private keys", () => {
    const raw =
      ["-----BEGIN", "RSA", "PRIVATE", "KEY-----"].join(" ") +
      "\nMIIEowIBAAKCAQEA0\n" +
      ["-----END", "RSA", "PRIVATE", "KEY-----"].join(" ");
    expect(redactString(raw)).toBe("[REDACTED_PRIVATE_KEY]");
  });

  it("redacts GitHub personal access tokens", () => {
    const token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";
    expect(redactString(`token is ${token}`)).toBe("token is ghp_[REDACTED]");
  });

  it("redacts AWS access keys", () => {
    const key = "AKIAIOSFODNN7EXAMPLE";
    expect(redactString(`key=${key}`)).toBe("key=[REDACTED_AWS_KEY]");
  });

  it("redacts Sentry auth tokens", () => {
    const token = "sntrys_1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    expect(redactString(`SENTRY_AUTH_TOKEN=${token}`)).toBe("SENTRY_AUTH_TOKEN=sntrys_[REDACTED]");
  });

  it("redacts passwords in database connection strings", () => {
    const uri = "postgresql://readonly_user:SuperSecretPass123@localhost:5432/frontier";
    expect(redactString(uri)).toBe("postgresql://readonly_user:[REDACTED]@localhost:5432/frontier");
  });

  it("redacts Bearer tokens", () => {
    const header = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
    expect(redactString(header)).toBe("Authorization: Bearer [REDACTED]");
  });

  it("recursively redacts complex objects and sensitive key-values", () => {
    const data = {
      user: "alice",
      token: "secret-token-123",
      config: {
        apiKey: "xyz987",
        nested: ["safe", "Authorization: Bearer my-secret-jwt"],
      },
    };
    const sanitized = redactValue(data) as typeof data;
    expect(sanitized.user).toBe("alice");
    expect(sanitized.token).toBe("[REDACTED]");
    expect(sanitized.config.apiKey).toBe("[REDACTED]");
    expect(sanitized.config.nested[0]).toBe("safe");
    expect(sanitized.config.nested[1]).toBe("Authorization: Bearer [REDACTED]");
  });
});
