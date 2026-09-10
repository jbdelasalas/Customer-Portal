-- 008_sequence_collisions.sql — make reference/code generation collision-proof.
--
-- next_application_ref() trusted its counter absolutely. If the counter ever
-- fell behind the rows that exist — a restored backup, a row inserted by hand,
-- or a maintenance script resetting it — the next applicant would hit a unique
-- violation and see "Internal server error" with no way forward. That is a bad
-- failure to leave in a customer-facing path, so both generators now skip past
-- any value already taken.

CREATE OR REPLACE FUNCTION next_application_ref()
RETURNS varchar AS $$
DECLARE
  v_year  integer := EXTRACT(YEAR FROM now())::integer;
  v_next  integer;
  v_ref   varchar(30);
  v_tries integer := 0;
BEGIN
  LOOP
    INSERT INTO application_ref_seq (year, last_value)
    VALUES (v_year, 1)
    ON CONFLICT (year) DO UPDATE
      SET last_value = application_ref_seq.last_value + 1
    RETURNING last_value INTO v_next;

    v_ref := 'APP-' || v_year::text || '-' || lpad(v_next::text, 6, '0');

    EXIT WHEN NOT EXISTS (SELECT 1 FROM applications WHERE reference_no = v_ref);

    -- Taken: loop and take the next one. Bounded so a pathological state
    -- raises a clear error instead of spinning forever.
    v_tries := v_tries + 1;
    IF v_tries > 1000 THEN
      RAISE EXCEPTION 'Could not allocate an application reference after % attempts', v_tries;
    END IF;
  END LOOP;

  RETURN v_ref;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION next_customer_code(p_company_id uuid)
RETURNS varchar AS $$
DECLARE
  v_next    integer;
  v_prefix  varchar(20);
  v_code    varchar(30);
  v_tries   integer := 0;
BEGIN
  SELECT code INTO v_prefix FROM companies WHERE id = p_company_id;
  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'No company with id %', p_company_id;
  END IF;

  LOOP
    INSERT INTO customer_code_seq (company_id, last_value)
    VALUES (p_company_id, 1)
    ON CONFLICT (company_id) DO UPDATE
      SET last_value = customer_code_seq.last_value + 1
    RETURNING last_value INTO v_next;

    v_code := v_prefix || '-' || lpad(v_next::text, 6, '0');

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM customers WHERE company_id = p_company_id AND code = v_code
    );

    v_tries := v_tries + 1;
    IF v_tries > 1000 THEN
      RAISE EXCEPTION 'Could not allocate a customer code after % attempts', v_tries;
    END IF;
  END LOOP;

  RETURN v_code;
END;
$$ LANGUAGE plpgsql;

-- Bring both counters up to what has actually been issued, in case this
-- migration runs on a database where they already drifted.
UPDATE application_ref_seq s
   SET last_value = GREATEST(s.last_value, COALESCE(m.hi, 0))
  FROM (SELECT EXTRACT(YEAR FROM created_at)::int AS y,
               MAX(NULLIF(split_part(reference_no, '-', 3), '')::int) AS hi
          FROM applications GROUP BY 1) m
 WHERE s.year = m.y;

UPDATE customer_code_seq s
   SET last_value = GREATEST(s.last_value, COALESCE(m.hi, 0))
  FROM (SELECT company_id,
               MAX(NULLIF(split_part(code, '-', 2), '')::int) AS hi
          FROM customers GROUP BY 1) m
 WHERE s.company_id = m.company_id;
