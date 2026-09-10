# Art Fresh Customer Portal — Technical Manual

For whoever maintains this system.

| | |
|---|---|
| **Production** | <https://customer-portal-nine-delta.vercel.app> |
| **Repository** | <https://github.com/jbdelasalas/Customer-Portal> (public) |
| **Hosting** | Vercel, project `customer-portal`, region `sin1` (Singapore) |
| **Database** | Supabase `seteoooczdumqaibrzdl`, ap-southeast-1 |
| **Storage** | Supabase bucket `onboarding-docs` (private, 20 MB cap) |
| **Code** | `~/OneDrive/Documents/customer-portal` |

> **This is a separate system from the ERP.** Different repository, different
> database. The ERP is Supabase project `hmwwvbxrpjrjonkycsty` — never point
> this project's migrations at it. Portal tables carry a nullable `erp_ref`
> column as the future reconciliation seam; nothing reads or writes the ERP
> today.

---

## Running it locally

```bash
cd ~/OneDrive/Documents/customer-portal
npm install
npm run dev              # http://localhost:3000
```

`.env.local` holds the settings and is gitignored. If it is missing, copy
`.env.example` and fill in the database URLs and JWT secrets
(`npm run gen:secrets` prints fresh ones).

Useful commands:

```bash
npm run db:test          # is the database reachable, and does the schema exist?
npm run db:migrate       # apply pending migrations
npm run db:seed          # publish the form definition, ensure the admin exists
npm run mail:test <to>   # send one real email and report what happened
npm run logo <file>      # install a logo and switch branding on
npm run build            # production build — run before deploying
```

---

## Deploying

Pushing to `main` deploys automatically. To deploy by hand:

```bash
npx vercel --prod
```

Environment variables live in Vercel (`npx vercel env ls`). Changing one
requires a redeploy to take effect.

---

## How the form works

**The application form is data, not code.** It lives in the database as
versioned JSON.

To change the form:

1. Edit `db/seeds/customer_application_form.json`
2. `npm run db:seed`

That publishes a new version and retires the previous one. **Applications
already in progress keep rendering and validating against the version they
started on**, so a mid-review change never invalidates someone's half-finished
submission. This is why the seed is safe to run against production.

Structure:

- `sections[]` — each with `fields[]`
- `photos[]` — camera captures (`facing: user` = selfie, `environment` = rear)
- `documents[]` — file upload slots
- `signature` — the declaration and its exact wording
- `notarisedDocument` — the printed CIS, uploaded back by staff

Field types: `text`, `textarea`, `number`, `email`, `phone`, `date`, `url`,
`select`, `multiselect`, `radio`, `checkbox`, `section_note`.

Any field may carry:

- `required: true`
- `showIf: { field, equals }` — appear only when another field has a value
- `mapsTo: "customers.<column>"` — copy the answer onto the customer record on
  approval. Only columns on an allow-list in `src/lib/forms.ts` are accepted,
  so a hand-edited schema cannot write to `credit_limit` or `status`.

A field whose key contains `map` and has type `url` is validated as a Google
Maps link, by hostname rather than substring.

---

## Database

Nine migrations in `db/migrations`, applied in filename order and tracked in
`schema_migrations`. They are additive and idempotent.

| | |
|---|---|
| 001 | extensions, companies |
| 002 | users, roles, permissions, sessions |
| 003 | customers, contacts, sites |
| 004 | forms, applications, documents, events |
| 005 | products, pricing, orders |
| 006 | invoices, payments, ageing views |
| 007 | signatures, camera captures |
| 008 | collision-proof reference numbers |
| 009 | admin password reset |

**Never reset a sequence counter to zero.** `application_ref_seq` and
`customer_code_seq` must stay at or above the highest value already issued.
Migration 008 makes the generators skip past taken values rather than failing,
but a reset still risks confusion. To realign after a restore:

```sql
UPDATE application_ref_seq s SET last_value = GREATEST(s.last_value, COALESCE(m.hi,0))
  FROM (SELECT EXTRACT(YEAR FROM created_at)::int y,
               MAX(split_part(reference_no,'-',3)::int) hi
          FROM applications GROUP BY 1) m WHERE s.year = m.y;
```

---

## Files and storage

Uploads go to the private Supabase bucket `onboarding-docs`, under
`applications/<application id>/<uuid>.<ext>`. The applicant's filename is kept
in the database only and never touches the storage path.

Files are served through `/api/documents/:docId`, which:

1. Checks the caller is the applicant who uploaded it, or staff with
   `application.view`. Anyone else gets **404**, not 403, so the endpoint never
   confirms a document id exists.
2. Redirects (**302**) to a signed URL valid for one hour.

Two details that caused real bugs and should not be undone:

- **The redirect must be 302, not 307.** A 307 preserves the original request,
  so the browser replays session cookies at Supabase, which rejects them — and
  the image silently fails to load in an `<img>` tag.
- **`UPLOAD_DRIVER` must be `supabase` in production.** With `local`, uploads
  are refused outright on Vercel rather than written to an ephemeral disk where
  they would vanish while reporting success.

---

## Email

Not switched on. Without `RESEND_API_KEY` the mail driver is `log`: messages
print to the server log instead of being sent, so development never mails real
people.

To enable:

1. Create a Resend account and add the domain `send.artfreshchicken.ph`.
   A subdomain keeps the portal's sending reputation separate from the existing
   Bluehost mail on the root domain, and leaves the current SPF record alone.
2. Add the DNS records Resend gives you at Bluehost.
3. Set `RESEND_API_KEY` and `MAIL_FROM` in Vercel, and redeploy.
4. `npm run mail:test you@example.com` to confirm delivery.

Templates live in `src/lib/mail.ts`: password reset, email verification,
application approved, information requested.

Until this is done, the admin password reset at **Staff → Accounts** is the
only account recovery route.

---

## Security model

- **Two populations, one users table**, split by `user_type`. A database check
  constraint prevents a staff row carrying a `customer_id`.
- **`requireCustomer()` is the tenancy boundary.** It re-reads `customer_id`
  from the database rather than trusting the JWT, so revoking access takes
  effect on the next request. Every customer-facing query scopes to what it
  returns.
- **Prices resolve server-side.** Whatever a client sends for price is ignored.
- **Credit limits are checked before the write**, not in the UI.
- **Refresh tokens and reset tokens are stored hashed**, so a database leak
  cannot mint sessions or reset passwords.
- **Login lockout**: five failures, 15 minutes, and every failure mode returns
  one identical message so the endpoint cannot be used to enumerate accounts.
- **Signatures** store the image, the exact declaration wording shown, the IP,
  the user agent, and a SHA-256 over all of it. Editing any of those columns
  later breaks the hash, making tampering detectable.

---

## Outstanding

**Rotate the credentials.** These were shared during setup and the repository
is public:

1. **Database password** — Supabase → Settings → Database → Reset. Then update
   `POSTGRES_URL` and `DATABASE_URL` in Vercel and `.env.local`.
2. **`service_role` key** — Supabase → Settings → API. It bypasses row-level
   security across the whole project. Update `SUPABASE_SERVICE_ROLE_KEY`.
3. **Vercel deployment token** — <https://vercel.com/account/tokens>. Delete
   it; GitHub pushes deploy on their own.

**Not built yet**, though the database and APIs exist:

- Order placement UI (the API is done and tested)
- Staff order fulfilment screens
- Invoice PDF generation
- ERP synchronisation

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| "The database is not configured" | `POSTGRES_URL` missing from that environment |
| "Could not reach the database" | Wrong host, wrong password, or the project is paused |
| "The database schema is missing" | `npm run db:migrate` has not been run |
| "File uploads are not configured" | `UPLOAD_DRIVER`/`SUPABASE_*` missing |
| Photos not loading | Signed links last an hour; hard-refresh the page |
| A password contains `%`, `@`, `/` or `#` | URL-encode it in the connection string (`%` becomes `%25`) |

Vercel logs: `npx vercel logs <deployment-url>`
