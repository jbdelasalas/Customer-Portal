# Documentation

Three manuals, for three different readers.

| Manual | For | Covers |
|---|---|---|
| **[Staff Manual](STAFF-MANUAL.md)** | Your team | Reviewing applications, approving customers, the notarised CIS, resetting passwords |
| **[Customer Guide](CUSTOMER-GUIDE.md)** | Applicants | What to prepare, filling in the form, photos, signing, what happens next |
| **[Technical Manual](ADMIN-MANUAL.md)** | Whoever maintains it | Running it, changing the form, the database, storage, email, security, troubleshooting |

Also in the project root:

- **[DEPLOY.md](../DEPLOY.md)** — how the deployment was set up, and what is
  still outstanding
- **[README.md](../README.md)** — what the system is and how it is built

## Sending the customer guide out

The Customer Guide is written to be shared as-is. Paste it into an email, print
it, or convert it to PDF — it contains nothing internal.

The Staff Manual and Technical Manual are internal: the Staff Manual explains
what to verify when checking an ID against a selfie, and the Technical Manual
describes the security model.

## Keeping these current

These describe the system as it stood on 2026-09-10. Two things will date them
soonest:

- **Email is not switched on.** Both the Staff Manual and Customer Guide say
  so and tell people to phone instead. When Resend is configured, those
  passages need removing.
- **Orders, deliveries and statements** have APIs but no screens. The Staff
  Manual notes this under Current limitations.
