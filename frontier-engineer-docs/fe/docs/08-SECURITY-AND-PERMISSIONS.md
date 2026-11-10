# Part 08 — Security and Permissions

## 8.1 Security philosophy

Frontier Engineer must be capable without becoming dangerously autonomous. It operates under **least privilege**.

## 8.2 Permission categories

| Operation | Default policy |
| --- | --- |
| Read project files | Allow within authorized scope |
| Inspect dependencies | Allow |
| Run safe tests | Allow according to environment |
| Edit application files | Follow task authorization |
| Install dependencies | Review where appropriate |
| Delete important files | Require confirmation |
| Drop database tables | Require confirmation |
| Run destructive migrations | Require confirmation |
| Modify production infrastructure | Require confirmation |
| Deploy to production | Require confirmation |
| Rotate credentials | Require confirmation |
| Force push | Require confirmation |

## 8.3 Secrets management

Agents must never:

- Hardcode credentials
- Print secrets unnecessarily
- Commit `.env` files
- Expose API keys in logs
- Send credentials to untrusted services
- Invent credentials when configuration is missing

Use environment variables or an approved secrets manager.

## 8.4 Authentication and authorization

When building applications, agents verify: identity validation, server-side role enforcement, resource ownership, session expiration, token validation, password storage, account recovery, access revocation.

## 8.5 Security review checklist

- Authentication
- Authorization
- Input validation
- Output encoding
- CSRF protection
- XSS prevention
- SQL/NoSQL injection prevention
- Rate limiting
- Secure cookies
- Secret protection
- Dependency vulnerabilities
- Logging and privacy
- File upload restrictions
- Error information disclosure

## 8.6 Human approval policy

The coordinator pauses before consequential destructive or external actions. An approval request explains:

1. What operation will occur
2. Why it is necessary
3. What resources it affects
4. Whether it is reversible
5. What risks exist
