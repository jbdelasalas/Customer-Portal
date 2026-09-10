# Going live

Three services, in this order. Each starts with a login only you can do —
run those in your own terminal, then tell Claude and it takes the next step.

Open a terminal here first:

```bash
cd ~/OneDrive/Documents/customer-portal
```

---

## 1. Supabase — the database

The database comes first, because Vercel needs its connection string.

### Create the project

1. Go to <https://supabase.com/dashboard> and sign in.
2. **New project**. Name it `customer-portal`.
3. Region: **Southeast Asia (Singapore)** — same region the app deploys to,
   which keeps query round-trips short.
4. Set a strong database password and **save it somewhere safe** — Supabase
   shows it once, and you need it in the next step.
5. Wait for provisioning (~2 minutes).

### Get the connection strings

In the project: **Connect** (top bar) → **Connection string** → **URI**.

You need two, both with `[YOUR-PASSWORD]` replaced by the password from above:

- **Transaction pooler**, port `6543` → this is `POSTGRES_URL`
- **Direct connection**, port `5432` → this is `DATABASE_URL`

> The app uses the pooler at runtime because serverless functions open many
> short connections; migrations use the direct connection because DDL and the
> pooler disagree. Both are needed.

### Run the migrations

```bash
cp .env.example .env.local
```

Open `.env.local`, paste both URLs, then generate and paste the JWT secrets:

```bash
npm run gen:secrets
```

Then create the schema and your admin account:

```bash
npm run db:migrate
SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='a-strong-password' npm run db:seed
```

Check it locally before going further:

```bash
npm run dev     # http://localhost:3000
```

Sign in with the admin credentials above. If the review queue loads, the
database half is done.

---

## 2. GitHub — the repository

`gh` is not installed (its installer needs an admin prompt), so create the
repo in the browser. Plain `git push` does the rest.

1. Go to <https://github.com/new>
2. Name: `customer-portal`
3. **Private** — this system handles TINs, permits, credit limits and IDs.
4. Do **not** tick "Add a README", `.gitignore`, or a licence. The repo
   already has commits; those options would conflict.
5. Create, then:

```bash
git remote add origin https://github.com/<your-username>/customer-portal.git
git push -u origin main
```

`.env.local` is gitignored and will not be pushed. Verify with
`git status --ignored | grep env` if you want to be certain.

---

## 3. Vercel — the deployment

```bash
npx vercel login
```

Then link and deploy a preview:

```bash
npx vercel link
npx vercel
```

### Set the environment variables

The preview will fail until these exist — that is expected, and the error
message will name the missing setting.

```bash
npx vercel env add POSTGRES_URL production
npx vercel env add DATABASE_URL production
npx vercel env add JWT_ACCESS_SECRET production
npx vercel env add JWT_REFRESH_SECRET production
npx vercel env add NEXT_PUBLIC_APP_NAME production
```

Each prompts for the value. Use the **same** values as `.env.local` — the same
JWT secrets, or everyone gets signed out between environments.

Repeat with `preview` in place of `production` if you want preview deploys to
work too.

### Ship it

```bash
npx vercel --prod
```

That prints your live URL.

---

## After it is live

**Check these before sharing the link with anyone:**

- [ ] Sign in as your admin account on the live URL
- [ ] Register a test customer, fill the form, upload a document, submit
- [ ] Approve it from the staff queue and confirm a customer code is assigned
- [ ] Delete the test application and customer once satisfied

**Known gaps** — none block testing, but they matter before real customers:

- **Email is not wired up.** Verification and password-reset tokens are
  created in the database but nothing sends them. A customer who forgets their
  password currently cannot recover it without you.
- **Uploads default to local disk**, which does not survive on Vercel's
  ephemeral filesystem. Set `UPLOAD_DRIVER=supabase` plus `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY` and a `onboarding-docs` bucket before anyone
  uploads anything you need to keep.
- **The application form is a placeholder** until the real format replaces
  `db/seeds/customer_application_form.json`.

---

## If something breaks

The API returns 503 with the setting to fix rather than a bare 500, so read
the error first — it usually names the problem:

| Message | Fix |
|---|---|
| "The database is not configured" | `POSTGRES_URL` missing from that environment |
| "Could not reach the database" | Wrong host, or the password was not substituted |
| "The database schema is missing" | `npm run db:migrate` has not been run |
| "Authentication is not configured" | `JWT_ACCESS_SECRET` missing |

Vercel logs: `npx vercel logs <deployment-url>`

---

# Live deployment

Deployed 2026-09-10.

| | |
|---|---|
| **Production** | <https://customer-portal-nine-delta.vercel.app> |
| Vercel project | `customer-portal` (jbdelasalas-projects) |
| Repository | <https://github.com/jbdelasalas/Customer-Portal> (public) |
| Database | Supabase `seteoooczdumqaibrzdl`, ap-southeast-1 |

Pushes to `main` deploy automatically. To deploy by hand:
`npx vercel --prod`

## Verified in production

Registration, application creation, form save with validation, admin login,
the staff review queue, and customer→staff isolation returning 403.

## Still to do

**1. File uploads — DONE (2026-09-10).** Supabase Storage is configured:
private `onboarding-docs` bucket, 20 MB cap, images and PDFs only. Files are
served through `/api/documents/:docId`, which checks permission and then hands
back a 5-minute signed URL. Verified in production.

**2. Email is not wired up.** Verification and password-reset tokens are
created but never sent, so a customer who forgets their password cannot
recover it unaided. Needed before real customers sign up.

**3. Rotate the database password.** It was shared during setup and the
repository is public, so the credential is the only thing protecting the data.
After rotating in Supabase, update both `POSTGRES_URL` and `DATABASE_URL` in
Vercel and in `.env.local`.

**4. Rotate the service_role key** at Supabase → Settings → API. It was shared
during setup, and it bypasses row-level security on the whole project.

**5. Delete the deployment token** at <https://vercel.com/account/tokens>.
It is no longer needed — GitHub pushes deploy on their own.
