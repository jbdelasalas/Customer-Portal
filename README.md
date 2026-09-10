# Customer Portal

A standalone customer portal: prospective customers apply online, staff review
and approve, and approved customers place orders at their contracted prices,
track deliveries, and view their statement of account.

This is a **separate system** from the ERP — its own repository, its own
database, its own deploy. It shares no tables with the ERP. Every table that
will eventually need to line up with an ERP record carries a nullable `erp_ref`
column; nothing reads or writes the ERP today.

## Manuals

- **[Staff Manual](docs/STAFF-MANUAL.md)** — reviewing and approving applications
- **[Customer Guide](docs/CUSTOMER-GUIDE.md)** — for applicants; safe to send out as-is
- **[Technical Manual](docs/ADMIN-MANUAL.md)** — running, changing and troubleshooting the system

## Stack

Next.js 14 (App Router) · TypeScript · PostgreSQL via `pg` · Tailwind ·
`jose` for JWTs · `zod` for request validation.

## Getting started

```bash
npm install
cp .env.example .env.local     # then fill in the database URL and JWT secrets
npm run db:migrate
npm run db:seed
npm run dev
```

Generate the JWT secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

The seed prints the superadmin credentials it creates. Change that password
immediately. Override them up front with `SEED_ADMIN_EMAIL` and
`SEED_ADMIN_PASSWORD`.

## How the onboarding form works

**Forms are data, not code.** A form lives in `form_versions.schema` as JSON —
sections, fields, validation rules and required documents. The UI renders
whatever it finds there, `src/lib/forms.ts` validates against it, and approval
maps answers onto customer columns via each field's `mapsTo`.

That means changing the form is a data change:

1. Edit `db/seeds/customer_application_form.json`
2. Run `npm run db:seed`

A new version is published and the old one retired. Applications already in
flight keep rendering and validating against the version they started on, so a
mid-review form change never invalidates someone's half-finished submission.

Supported field types: `text`, `textarea`, `number`, `email`, `phone`, `date`,
`select`, `multiselect`, `radio`, `checkbox`, `section_note`. Any field can
carry a `showIf` to appear conditionally, and a `mapsTo` to populate the
customer record on approval.

> The seeded form is a **placeholder** built from the fields these applications
> usually need. Replace it with the real format.

## The flow

```
Customer                          Staff
────────                          ─────
register  ──▶ /apply
              fill form (autosaves)
              upload documents
              submit          ──▶  review queue
                                   ├─ ask for more info ──┐
                                   ├─ reject              │
                                   └─ approve             │
                                      creates customer,   │
                                      assigns code,       │
                                      links the login  ◀──┘
              /portal ◀────────────── account unlocked
              place orders, track deliveries, view statement
```

Approval happens in a single transaction: create the customer, seed a default
delivery site, stamp the application, link the applicant's login, notify. It
cannot half-apply.

## Layout

```
db/migrations/     001 init · 002 auth · 003 customers
                   004 onboarding · 005 catalog+orders · 006 billing
db/seeds/          the application form definition
scripts/           migrate.mjs, seed.mjs
src/lib/           db, auth, forms (the engine), storage, api helpers
src/app/api/       auth · public · applications · staff · portal
src/app/           landing, register, login, apply, portal, staff
src/components/    FormRenderer, DocumentUpload
```

## Security model

- **Two populations, one users table**, split by `user_type`. A `staff` row can
  never carry a `customer_id` (enforced by a check constraint).
- **`requireCustomer()` is the tenancy boundary.** It re-reads `customer_id`
  from the database rather than trusting the JWT, so revoking access takes
  effect on the next request. Every customer-facing query scopes to the id it
  returns.
- **Prices are resolved server-side.** What the client sends for price is
  ignored; `effective_price()` decides.
- **Order totals and credit limits are checked before the write**, not in the UI.
- Refresh tokens are stored hashed. Login is rate-limited with lockout, and
  every failure mode returns one identical message so the endpoint can't be
  used to enumerate accounts.
- Uploads are stored under a generated UUID; the applicant's filename is kept
  in the database only and never touches the filesystem path.

## Staff roles

`superadmin`, `portal_admin`, `onboarding`, `sales`, `logistics`, `finance`,
`viewer` — see `002_auth.sql` for the permission grants.

## ERP integration

Deliberately not built yet. The seams are in place: `erp_ref` and
`erp_synced_at` on `companies`, `customers`, `products`, `orders`, `invoices`
and `payments`. When you're ready, the integration reads those columns and
reconciles — no schema change needed.

## Status

Working end to end: registration, the schema-driven application with autosave
and document upload, the staff review queue, approval that provisions a
customer, and the portal's catalogue/orders/statement APIs.

Not built yet: staff-side order fulfilment screens, the order-placement UI
(the API is done), invoice PDF generation, email delivery (verification and
reset tokens are created but not sent), and ERP sync.
