-- ============================================================================
-- Make the portal safely multi-company
-- ============================================================================
-- The schema was multi-company from 001, but three things still assumed a
-- single tenant, and a second live company would have collided in each:
--
--  1. /api/public/form resolved the form with `ORDER BY version DESC LIMIT 1`
--     when no ?company= was given. With one company that always returned the
--     right form; with two it returns whichever published a higher version
--     number — so a fuel applicant could be handed the chicken form and the
--     application written against the wrong company_id. Silent, and only
--     visible later as a mis-filed customer.
--  2. Branding came from NEXT_PUBLIC_APP_NAME, one value per deployment.
--  3. The printed CIS hardcoded one company's name, address and signatory.
--
-- (2) and (3) are fixed by reading the columns below instead of the env var.
-- (1) is fixed by naming a default explicitly here, so resolution is a
-- deliberate choice rather than a side effect of version numbering.

-- The document heading fields the printed CIS needs. `name` and `legal_name`
-- already exist; these are the rest of the letterhead.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS short_name    varchar(60);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS signatory     varchar(120);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS print_header  varchar(200);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS industry      varchar(40);

COMMENT ON COLUMN companies.short_name IS
  'Brand name for UI chrome and email from-names, e.g. "Art Fresh". Falls back to name.';
COMMENT ON COLUMN companies.signatory IS
  'Approving officer printed under "Noted by:" on the CIS, e.g. "ART FRESH PRESIDENT / CFO".';
COMMENT ON COLUMN companies.print_header IS
  'Document title on the printed form, e.g. "CUSTOMER INFORMATION SHEET".';
COMMENT ON COLUMN companies.industry IS
  'Domain the company trades in — drives which product/UoM defaults apply. poultry | fuel.';

-- Exactly one company answers a request that does not name one. A partial
-- unique index enforces that: a second default is rejected loudly at write
-- time instead of being resolved arbitrarily at read time.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN companies.is_default IS
  'The company served when a request names none (bare /apply). At most one row true.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_one_default
  ON companies ((true)) WHERE is_default;

-- Adopt the existing company as the default so current behaviour is unchanged
-- for Art Fresh: without this, adding Perpet would leave /apply resolving to
-- nothing and break the live sign-up page.
UPDATE companies SET is_default = true
 WHERE code = (SELECT code FROM companies ORDER BY created_at LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM companies WHERE is_default);

-- Backfill the letterhead for the incumbent company from the values that were
-- hardcoded in src/app/apply/[id]/print/page.tsx, so its printed CIS is
-- unchanged once the page starts reading these columns. COALESCE so a value
-- already set by hand wins.
UPDATE companies
   SET legal_name   = COALESCE(legal_name, 'Art Fresh Chicken Corp.'),
       short_name   = COALESCE(short_name, 'Art Fresh'),
       signatory    = COALESCE(signatory, 'ART FRESH PRESIDENT / CFO'),
       print_header = COALESCE(print_header, 'CUSTOMER INFORMATION SHEET'),
       industry     = COALESCE(industry, 'poultry'),
       address      = COALESCE(address,
         'Unit 803 Park Trade Centre, Investment Drive, Madrigal Business Park, Ayala-Alabang, Muntinlupa City')
 WHERE is_default;
