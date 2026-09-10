# Art Fresh Customer Portal — Staff Manual

For the people who review applications and look after customer accounts.

**Portal:** <https://customer-portal-nine-delta.vercel.app>

---

## 1. Signing in

Go to the portal and choose **Sign in**. Staff land on the review queue.

If you are locked out, another superadmin can reset your password (see §6).
Five wrong passwords locks an account for 15 minutes — this is deliberate, and
waiting is the fastest fix.

---

## 2. What a customer does before you see anything

Understanding their side makes the review make sense.

1. They register with an email and password.
2. They fill in the Customer Information Sheet — ten sections, the same
   content as the paper form.
3. They photograph themselves and their business with their phone camera.
4. They upload their business documents.
5. They sign the declaration on screen with a finger or mouse.
6. They submit.

**They cannot submit until every required field, all four required documents,
both required photos, and the signature are present.** So anything reaching
your queue is already complete. If something is missing, the system let it
through by mistake — tell whoever maintains the portal.

---

## 3. The review queue

**Staff → Applications**

Filter tabs across the top:

| Tab | Meaning |
|---|---|
| **Needs action** | Everything waiting on you. Start here. |
| **New** | Submitted, nobody has looked yet |
| **In review** | Someone marked it as being worked on |
| **Awaiting customer** | You asked for more information |
| **Approved** / **Rejected** | Decided |

Search matches reference number, business name or email.

Each row shows the reference (`APP-2026-000012`), business name, who applied,
when they submitted, and how many documents came with it.

---

## 4. Reviewing an application

Click the reference number to open it.

### The left column — what they told you

Every section of the CIS as they filled it in, then:

- **Signature** — the drawn signature, with who signed, when, from which IP
  address, and a fingerprint (evidence hash). Expand *Declaration agreed to*
  to see the exact wording they accepted. This is what makes the signature
  defensible if the customer later disputes the account.
- **Photos** — click any photo to open it full size. Each says whether it was
  taken with the camera or uploaded from a file, and when. If the phone
  reported a location there is a **View location on map** link.
- **Documents** — click to open each one.

**What to actually check:**

- Does the selfie match the photo on the valid ID?
- Does the establishment photo look like a real trading business?
- Do the business name and TIN match the BIR and DTI/SEC certificates?
- Is the business permit current?
- Does the signatory name match the ID?

> A location on a photo is a **hint, not proof**. It comes from the applicant's
> own device and can be faked. Treat it as one signal among several.

### The right column — deciding

**Notes** — required when rejecting or asking for information. The customer
sees these, so write them so they can act on them.

**Terms (days)** and **Credit limit** — your decision, not theirs. What they
asked for is in the Credit and Payment section; what you enter here is what
they actually get. Leave blank for cash-only.

Four actions:

| Action | What happens |
|---|---|
| **Mark as in review** | Tells colleagues you are working on it |
| **Ask for more information** | Sends it back to the customer to edit. Your note tells them what is needed |
| **Approve & create customer** | Creates the customer account, assigns a code (`AFCC-000002`), applies your terms, and unlocks their portal |
| **Reject** | Closes the application. Requires a reason |

**Approval cannot be undone from this screen.** Everything happens together —
customer created, code assigned, login unlocked — or nothing does.

---

## 5. The notarised CIS

In the right column of any application:

1. **Open printable CIS ↗** — the completed sheet laid out like the paper form,
   with the logo, the 2x2 photo, their answers, their signature, and the
   notarial acknowledgment page. Print it.
2. Send it to the customer to sign before a notary public.
3. Upload the returned copy in the same panel.

The panel shows **Notarised copy on file** or **Not yet received**, so you can
see at a glance which accounts still owe paperwork.

This is optional at submission — an applicant is not blocked from applying
while they find a notary — but the account should not be treated as fully
documented until it arrives.

---

## 6. Resetting a customer's password

**Staff → Accounts**

Email notifications are not switched on yet, so this is currently the only way
back in for a customer who has forgotten their password.

1. Search for them by name, email or customer code.
2. **Reset password** → confirm.
3. A temporary password appears, e.g. `Kp7Rt-9mWqx-Ub4Ns`. Read it to them or
   use **Copy**.

**Before you do this, make sure you know who you are talking to.** Anyone who
convinces you they are the customer gets into that account. Ask for the
customer code, TIN, or something else only they would know.

Points worth understanding:

- **You never see their real password.** The system generates a temporary one.
- **It is shown once.** It is not stored and cannot be retrieved. If they lose
  it, issue another.
- **They must change it immediately.** They cannot reach the portal until they
  set their own.
- **It signs them out everywhere.** If the account was compromised, this is
  what removes the intruder.
- **Every reset is logged** with who did it and when.

The status column tells you the state: **Active**, **Temp password** (issued,
not yet changed), **Locked** (too many failed attempts), **Deactivated**.

---

## 7. Roles

| Role | Can do |
|---|---|
| `superadmin` | Everything |
| `portal_admin` | Everything except superadmin-only actions |
| `onboarding` | View, review and approve applications |
| `sales` | View applications and customers, manage pricing and orders |
| `logistics` | Move orders through delivery |
| `finance` | Invoices, payments, statements |
| `viewer` | Read-only |

Only a superadmin can reset a staff password, and no superadmin can reset
another superadmin's.

---

## 8. When something looks wrong

The portal reports configuration problems in plain language rather than a
generic error. If you see one of these, it needs whoever maintains the system —
not a retry:

| Message | Meaning |
|---|---|
| "The database is not configured" | A setting is missing from the deployment |
| "Could not reach the database" | Database is unreachable or paused |
| "File uploads are not configured" | Storage settings missing |
| "The database schema is missing" | Migrations have not been run |

**Photos or documents not opening?** Try a hard refresh (Ctrl+Shift+R). The
links that serve them expire after an hour, and a page left open overnight will
have stale ones.

---

## 9. Current limitations

Worth knowing so you are not surprised:

- **No emails are sent.** Not for approval, not for password reset, not for
  "more information needed". Customers only see these as notices inside the
  portal, which they will not know about unless you tell them. **Contact
  approved and rejected customers yourself** until this is switched on.
- **Order placement, delivery tracking and statements** exist in the system but
  have no screens yet. The application and approval flow is what is live.
- **A rejected application cannot be reopened** from the screen. The customer
  would need to apply again.
