-- Cap table and staff share options: companies, share classes, shareholders, the share ledger,
-- option plans and grants with vesting, exercises, SAFEs and convertible notes, valuations,
-- and the filings each event triggers. One database can hold many companies, so an
-- accountant or lawyer can keep every client's register in one place.
-- Shares are whole numbers. Money is integer cents. Prices per share are numeric dollars
-- (a seed price of 0.0125 is normal), in the company's currency.
create schema if not exists cap;

create or replace function cap.touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- Months between two dates, counted the way vesting schedules count them (whole months).
create or replace function cap.months_between(a date, b date) returns integer language sql immutable as $$
  select case when b < a then 0 else (extract(year from age(b, a)) * 12 + extract(month from age(b, a)))::int end
$$;

-- Add n working days (Monday to Friday). Public holidays are not counted out.
create or replace function cap.add_working_days(d date, n integer) returns date language sql immutable as $$
  select max(x)::date from (
    select x from generate_series(d + 1, d + n * 2 + 10, interval '1 day') x
    where extract(isodow from x) < 6 order by x limit n) w
$$;

create table cap.settings (
  id boolean primary key default true check (id),
  attention_days integer not null default 30 check (attention_days > 0),
  leaver_window_days integer not null default 90 check (leaver_window_days >= 0)
);
insert into cap.settings default values on conflict do nothing;

create table cap.companies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  jurisdiction text not null check (jurisdiction in ('NZ','AU')),
  company_type text not null default 'proprietary' check (company_type in ('proprietary','public','limited')),
  company_number text,
  currency text not null default 'NZD' check (currency ~ '^[A-Z]{3}$'),
  registered_office text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table cap.stakeholders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references cap.companies(id),
  code text not null,
  name text not null,
  kind text not null check (kind in ('founder','employee','investor','advisor','contractor','trust')),
  is_employee boolean not null default false,
  email text,
  address text,
  tax_residence text check (tax_residence in ('NZ','AU','other')),
  started_on date,
  ended_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  check (ended_on is null or started_on is null or ended_on >= started_on)
);

create table cap.share_classes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references cap.companies(id),
  code text not null,
  name text not null,
  kind text not null default 'ordinary' check (kind in ('ordinary','preference')),
  votes_per_share numeric(8,4) not null default 1,
  original_price numeric(18,6),
  pref_multiple numeric(6,2) not null default 0 check (pref_multiple >= 0),
  participating boolean not null default false,
  seniority integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  check (kind = 'preference' or pref_multiple = 0)
);

create table cap.rounds (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references cap.companies(id),
  code text not null,
  name text not null,
  closed_on date,
  price numeric(18,6),
  pre_money_cents bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

-- The share ledger. Every change to who holds what is a row; holdings are the sum.
-- A transfer is two rows (out and in) sharing a transfer_ref.
create table cap.share_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references cap.companies(id),
  code text not null,
  stakeholder_id uuid not null references cap.stakeholders(id),
  class_id uuid not null references cap.share_classes(id),
  kind text not null check (kind in ('issue','exercise','conversion','transfer_in','transfer_out','cancel','buyback')),
  shares bigint not null check (shares <> 0),
  price numeric(18,6),
  on_date date not null,
  round_id uuid references cap.rounds(id),
  transfer_ref text,
  certificate_no text,
  board_approved_on date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  check ((kind in ('issue','exercise','conversion','transfer_in') and shares > 0) or (kind in ('transfer_out','cancel','buyback') and shares < 0)),
  check ((kind in ('transfer_in','transfer_out')) = (transfer_ref is not null))
);

create table cap.plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references cap.companies(id),
  code text not null,
  name text not null,
  class_id uuid not null references cap.share_classes(id),
  pool_size bigint not null check (pool_size >= 0),
  adopted_on date not null,
  tax_treatment text not null default 'standard' check (tax_treatment in ('standard','au-startup','au-deferred','au-upfront','nz-exempt')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

create table cap.grants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references cap.companies(id),
  code text not null,
  plan_id uuid not null references cap.plans(id),
  stakeholder_id uuid not null references cap.stakeholders(id),
  granted_on date not null,
  quantity bigint not null check (quantity > 0),
  exercise_price numeric(18,6) not null default 0 check (exercise_price >= 0),
  vesting_start date not null,
  vest_months integer not null default 48 check (vest_months > 0),
  cliff_months integer not null default 12 check (cliff_months >= 0),
  vest_every_months integer not null default 1 check (vest_every_months > 0),
  expires_on date,
  board_approved_on date,
  status text not null default 'active' check (status in ('active','cancelled')),
  cancelled_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  check (cliff_months <= vest_months)
);

create table cap.exercises (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references cap.grants(id),
  share_event_id uuid not null references cap.share_events(id),
  quantity bigint not null check (quantity > 0),
  on_date date not null,
  created_at timestamptz not null default now(),
  unique (share_event_id)
);

create table cap.convertibles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references cap.companies(id),
  code text not null,
  stakeholder_id uuid not null references cap.stakeholders(id),
  kind text not null check (kind in ('safe','note')),
  principal_cents bigint not null check (principal_cents > 0),
  valuation_cap_cents bigint,
  discount_pct numeric(5,2) not null default 0 check (discount_pct >= 0 and discount_pct < 100),
  interest_pct numeric(5,2) not null default 0 check (interest_pct >= 0),
  issued_on date not null,
  maturity_on date,
  status text not null default 'outstanding' check (status in ('outstanding','converted','repaid')),
  converted_round_id uuid references cap.rounds(id),
  board_approved_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

-- Fair market value per share on a date, from an independent valuation or a priced round.
create table cap.valuations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references cap.companies(id),
  class_id uuid not null references cap.share_classes(id),
  on_date date not null,
  price numeric(18,6) not null check (price >= 0),
  method text not null,
  created_at timestamptz not null default now(),
  unique (class_id, on_date)
);

-- What was actually lodged. Obligations come from the ledger; this records they were met.
create table cap.filings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references cap.companies(id),
  kind text not null check (kind in ('nz-share-issue','au-form-484','au-ess-statement','au-ess-report','nz-ess-income','annual-return')),
  subject_ref text not null,
  filed_on date not null,
  reference text,
  filed_by text,
  created_at timestamptz not null default now(),
  unique (company_id, kind, subject_ref)
);

create table cap.notes (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null,
  subject_id uuid not null,
  author text not null,
  body text not null,
  created_at timestamptz not null default now()
);
create or replace function cap.append_only() returns trigger language plpgsql as $$
begin raise exception 'notes are append-only'; end $$;
create trigger notes_append_only before update or delete on cap.notes for each row execute function cap.append_only();

create table cap.import_rows (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  file_name text not null,
  row_number integer not null,
  row_hash text not null,
  target_id uuid,
  imported_at timestamptz not null default now(),
  unique (source, row_hash)
);

do $$
declare t text;
begin
  foreach t in array array['companies','stakeholders','share_classes','rounds','share_events','plans','grants','convertibles'] loop
    execute format('create trigger %I_touch before update on cap.%I for each row execute function cap.touch()', t, t);
  end loop;
end $$;

-- Look-ups by code, for the seed, imports and hand-written queries.
create or replace function cap.company_id(co text) returns uuid language sql stable as $$
  select id from cap.companies where lower(code) = lower(co) $$;
create or replace function cap.holder_id(co text, holder text) returns uuid language sql stable as $$
  select id from cap.stakeholders where company_id = cap.company_id(co) and lower(code) = lower(holder) $$;
create or replace function cap.class_id(co text, cls text) returns uuid language sql stable as $$
  select id from cap.share_classes where company_id = cap.company_id(co) and lower(code) = lower(cls) $$;

create index on cap.share_events (company_id, stakeholder_id);
create index on cap.grants (company_id, stakeholder_id);
create index on cap.exercises (grant_id);
