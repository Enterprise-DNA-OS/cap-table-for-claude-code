-- The views every command reads. Vesting, outstanding options and filing deadlines are
-- worked out here from the ledger, so no number is typed twice.

-- Holdings: the sum of the share ledger per holder and class.
create or replace view cap.holdings as
select e.company_id, e.stakeholder_id, e.class_id, sum(e.shares)::bigint shares
from cap.share_events e group by e.company_id, e.stakeholder_id, e.class_id;

-- One row per grant: what has vested, what is exercised, what is still outstanding.
-- Vesting stops on the day a holder leaves or the grant is cancelled. A leaver keeps
-- vested options until the leaver window closes (settings.leaver_window_days).
create or replace view cap.grant_status as
with base as (
  select g.*, s.name holder, s.code holder_code, s.ended_on, s.is_employee, s.tax_residence, p.code plan, p.class_id, p.tax_treatment,
    c.code company, c.jurisdiction,
    s.ended_on is not null and s.ended_on <= current_date as left_company,
    s.ended_on + (select leaver_window_days from cap.settings) as window_ends_on,
    cap.months_between(g.vesting_start, least(current_date, coalesce(s.ended_on, current_date), coalesce(g.cancelled_on, current_date))) months_vested,
    coalesce((select sum(x.quantity) from cap.exercises x where x.grant_id = g.id), 0)::bigint exercised
  from cap.grants g join cap.stakeholders s on s.id = g.stakeholder_id join cap.plans p on p.id = g.plan_id join cap.companies c on c.id = g.company_id
), v as (
  select b.*,
    case when b.months_vested < b.cliff_months then 0
      else least(b.quantity, floor(b.quantity::numeric * ((least(b.months_vested, b.vest_months) / b.vest_every_months) * b.vest_every_months) / b.vest_months))::bigint end vested,
    (b.expires_on is not null and b.expires_on < current_date) or (b.left_company and b.window_ends_on < current_date) expired
  from base b
)
select v.*,
  case when v.status = 'cancelled' or v.expired then 0 when v.left_company then greatest(v.vested - v.exercised, 0) else v.quantity - v.exercised end::bigint outstanding,
  case when v.status = 'cancelled' or v.expired then 0 else greatest(v.vested - v.exercised, 0) end::bigint exercisable,
  case when v.status = 'cancelled' or v.expired or v.left_company then 0 else v.quantity - greatest(v.vested, v.exercised) end::bigint unvested
from v;

-- Plan pools: what is left to grant. Exercised options leave the pool for good;
-- cancelled, forfeited and expired options go back into it.
create or replace view cap.pool as
select c.code company, p.id plan_id, p.company_id, p.code plan, p.name, p.pool_size,
  coalesce(sum(g.quantity), 0)::bigint granted,
  coalesce(sum(g.exercised), 0)::bigint exercised,
  coalesce(sum(g.outstanding), 0)::bigint outstanding,
  coalesce(sum(g.quantity - g.exercised - g.outstanding), 0)::bigint returned,
  (p.pool_size - coalesce(sum(g.outstanding), 0) - coalesce(sum(g.exercised), 0))::bigint available
from cap.plans p join cap.companies c on c.id = p.company_id left join cap.grant_status g on g.plan_id = p.id
group by c.code, p.id, p.company_id, p.code, p.name, p.pool_size;

-- The cap table: every holder's shares and outstanding options, plus the unallocated pool.
create or replace view cap.cap_table as
with h as (
  select s.company_id, s.id stakeholder_id, s.code, s.name, s.kind,
    coalesce((select sum(x.shares) from cap.holdings x join cap.share_classes k on k.id = x.class_id where x.stakeholder_id = s.id and k.kind = 'ordinary'), 0)::bigint ordinary,
    coalesce((select sum(x.shares) from cap.holdings x join cap.share_classes k on k.id = x.class_id where x.stakeholder_id = s.id and k.kind = 'preference'), 0)::bigint preference,
    coalesce((select sum(g.outstanding) from cap.grant_status g where g.stakeholder_id = s.id), 0)::bigint options
  from cap.stakeholders s
), rows as (
  select company_id, code, name, kind, ordinary, preference, options from h where ordinary + preference + options > 0
  union all
  select company_id, 'POOL', 'Unallocated pool (' || string_agg(plan, ', ') || ')', 'pool', 0, 0, sum(greatest(available, 0))::bigint from cap.pool group by company_id
)
select c.code company, r.code, r.name, r.kind, r.ordinary, r.preference, r.ordinary + r.preference issued, r.options,
  r.ordinary + r.preference + r.options fully_diluted,
  round(100.0 * (r.ordinary + r.preference) / nullif(sum(r.ordinary + r.preference) over (partition by r.company_id), 0), 2) issued_pct,
  round(100.0 * (r.ordinary + r.preference + r.options) / nullif(sum(r.ordinary + r.preference + r.options) over (partition by r.company_id), 0), 2) fd_pct,
  r.company_id
from rows r join cap.companies c on c.id = r.company_id;

-- Each vesting date, with how many options vest on it. Leavers and cancelled grants vest nothing more.
create or replace view cap.vest_events as
select g.company, g.code grant_code, g.holder_code, g.holder, g.id grant_id,
  (g.vesting_start + make_interval(months => m))::date vests_on, m = g.cliff_months and g.cliff_months > 0 cliff,
  (least(g.quantity, floor(g.quantity::numeric * m / g.vest_months)) -
    case when m - g.vest_every_months < g.cliff_months then 0 else least(g.quantity, floor(g.quantity::numeric * (m - g.vest_every_months) / g.vest_months)) end)::bigint quantity
from cap.grant_status g
cross join lateral generate_series(case when g.cliff_months > 0 then g.cliff_months else g.vest_every_months end, g.vest_months, g.vest_every_months) m
where g.status = 'active' and not g.expired and (g.ended_on is null or (g.vesting_start + make_interval(months => m))::date <= g.ended_on)
  and (m - g.cliff_months) % g.vest_every_months = 0;

-- People who have left with options: what they kept, what went back, when their window closes.
create or replace view cap.leavers as
select g.company, g.holder_code, g.holder, g.code grant_code, g.ended_on, g.quantity, g.vested, g.exercised, g.exercisable,
  g.quantity - g.vested returned_unvested, g.window_ends_on, g.window_ends_on - current_date days_left, g.expired, g.exercise_price
from cap.grant_status g where g.ended_on is not null and g.status = 'active';

-- Latest fair market value on or before a date, per class.
create or replace function cap.fmv(cls uuid, d date) returns numeric language sql stable as $$
  select price from cap.valuations where class_id = cls and on_date <= d order by on_date desc limit 1
$$;

-- Every filing the ledger says is owed, and whether it was made.
create or replace view cap.obligations as
with owed as (
  -- New Zealand: notice of a share issue to the Registrar within 10 working days (Companies Act 1993 s43).
  select e.company_id, 'nz-share-issue' kind, e.code subject_ref, e.on_date event_on, cap.add_working_days(e.on_date, 10) due_on,
    s.name || ': ' || e.shares || ' ' || k.code || ' shares (' || e.kind || ')' detail
  from cap.share_events e join cap.companies c on c.id = e.company_id join cap.stakeholders s on s.id = e.stakeholder_id join cap.share_classes k on k.id = e.class_id
  where c.jurisdiction = 'NZ' and e.kind in ('issue','exercise','conversion')
  union all
  -- Australia: issues and cancellations within 28 days (Corporations Act s254X, s254Y); proprietary
  -- companies also notify members register changes such as transfers within 28 days (s178A).
  select e.company_id, 'au-form-484', e.code, e.on_date, e.on_date + 28,
    s.name || ': ' || e.shares || ' ' || k.code || ' shares (' || replace(e.kind, '_', ' ') || ')'
  from cap.share_events e join cap.companies c on c.id = e.company_id join cap.stakeholders s on s.id = e.stakeholder_id join cap.share_classes k on k.id = e.class_id
  where c.jurisdiction = 'AU' and (e.kind in ('issue','exercise','conversion','cancel','buyback') or (e.kind = 'transfer_in' and c.company_type = 'proprietary'))
  union all
  -- Australia: ESS statements to employees by 14 July and the ESS annual report to the ATO by 14 August,
  -- for each financial year (to 30 June) in which ESS interests were granted to Australian employees.
  select company_id, kind, 'FY' || fy, fy_end, case when kind = 'au-ess-statement' then make_date(fy, 7, 14) else make_date(fy, 8, 14) end,
    n || ' grant(s) to Australian employees in the year to 30 June ' || fy
  from (select g.company_id, (extract(year from g.granted_on) + case when extract(month from g.granted_on) >= 7 then 1 else 0 end)::int fy, count(*) n
        from cap.grant_status g where g.jurisdiction = 'AU' and g.is_employee and g.tax_residence = 'AU' group by 1, 2) y
  cross join (values ('au-ess-statement'), ('au-ess-report')) k(kind)
  cross join lateral (select make_date(y.fy, 6, 30) fy_end) f
  union all
  -- New Zealand: an ESS benefit is employment income. Report it on or before 2 working days after the
  -- deferral date, 20 days after the share scheme taxing date (Tax Administration Act 1994 s23K).
  select e.company_id, 'nz-ess-income', e.code, e.on_date, cap.add_working_days(e.on_date + 20, 2),
    s.name || ': ' || x.quantity || ' options exercised at ' || trim_scale(g.exercise_price) || coalesce(', value ' || trim_scale(cap.fmv(p.class_id, e.on_date)) || ' a share, benefit about ' ||
      round((cap.fmv(p.class_id, e.on_date) - g.exercise_price) * x.quantity, 2), ', no valuation on file')
  from cap.exercises x join cap.share_events e on e.id = x.share_event_id join cap.grants g on g.id = x.grant_id join cap.plans p on p.id = g.plan_id
  join cap.stakeholders s on s.id = g.stakeholder_id join cap.companies c on c.id = g.company_id
  where c.jurisdiction = 'NZ' and s.tax_residence = 'NZ' and p.tax_treatment <> 'nz-exempt'
)
select c.code company, o.company_id, o.kind, o.subject_ref, o.event_on, o.due_on, f.filed_on, f.reference, o.detail,
  case when f.filed_on is not null then case when f.filed_on > o.due_on then 'filed late' else 'filed' end
    when o.due_on < current_date then 'OVERDUE'
    when o.due_on <= current_date + (select attention_days from cap.settings) then 'due soon' else 'upcoming' end state,
  case when f.filed_on is null then o.due_on - current_date end days_left
from owed o join cap.companies c on c.id = o.company_id
left join cap.filings f on f.company_id = o.company_id and f.kind = o.kind and f.subject_ref = o.subject_ref;

-- The rule checks. Statutory rules cite their source in docs/compliance.md; the rest are
-- the operator's policies, changed in a migration.
create or replace view cap.compliance_findings as
select company, case kind when 'nz-share-issue' then 'nz-share-issue-notice' when 'au-form-484' then 'au-share-change-notice' else kind end rule,
  subject_ref subject, detail || ', due ' || due_on || case when state = 'OVERDUE' then ' (' || -days_left || ' days overdue)' else ' (' || days_left || ' days left)' end detail,
  case when state = 'OVERDUE' then 'breached' else 'due soon' end severity
from cap.obligations where state = 'OVERDUE' or (state = 'due soon' and days_left <= 7)
union all
select c.code, 'au-50-non-employee', c.name, n || ' non-employee shareholders against a limit of 50', case when n > 50 then 'breached' else 'near limit' end
from cap.companies c cross join lateral (select count(distinct h.stakeholder_id)::int n from cap.holdings h join cap.stakeholders s on s.id = h.stakeholder_id
  where h.company_id = c.id and h.shares > 0 and not s.is_employee) x
where c.jurisdiction = 'AU' and c.company_type = 'proprietary' and n > 45
union all
select c.code, 'register-address', s.code || ' ' || s.name, 'on the ' || case when exists (select 1 from cap.holdings h where h.stakeholder_id = s.id and h.shares > 0) then 'share' else 'option' end || ' register with no address', 'breached'
from cap.stakeholders s join cap.companies c on c.id = s.company_id
where coalesce(trim(s.address), '') = '' and (exists (select 1 from cap.holdings h where h.stakeholder_id = s.id and h.shares > 0)
  or (c.jurisdiction = 'AU' and exists (select 1 from cap.grant_status g where g.stakeholder_id = s.id and g.outstanding > 0)))
union all
select g.company, 'option-register-details', g.code || ' ' || g.holder, 'outstanding options with no expiry date: the register must show when they can be exercised', 'breached'
from cap.grant_status g where g.jurisdiction = 'AU' and g.outstanding > 0 and g.expires_on is null
union all
select c.code, 'board-approval', e.code || ' ' || s.name, replace(e.kind, '_', ' ') || ' of ' || abs(e.shares) || ' shares on ' || e.on_date || ' has no board approval recorded', 'policy'
from cap.share_events e join cap.companies c on c.id = e.company_id join cap.stakeholders s on s.id = e.stakeholder_id
where e.kind in ('issue','conversion','cancel','buyback') and e.board_approved_on is null
union all
select g.company, 'board-approval', g.code || ' ' || g.holder, 'grant of ' || g.quantity || ' options on ' || g.granted_on || ' has no board approval recorded', 'policy'
from cap.grant_status g where g.board_approved_on is null and g.status = 'active'
union all
select company, 'pool-overgranted', plan, 'granted past the pool by ' || -available || ' options', 'policy' from cap.pool where available < 0
union all
select c.code, 'convertible-matured', v.code || ' ' || s.name, v.kind || ' matured on ' || v.maturity_on || ' and is still outstanding', 'policy'
from cap.convertibles v join cap.companies c on c.id = v.company_id join cap.stakeholders s on s.id = v.stakeholder_id
where v.status = 'outstanding' and v.maturity_on < current_date
union all
select c.code, 'ledger-negative', s.code || ' ' || s.name, 'holds ' || h.shares || ' ' || k.code || ' shares: the ledger has taken out more than went in', 'breached'
from cap.holdings h join cap.companies c on c.id = h.company_id join cap.stakeholders s on s.id = h.stakeholder_id join cap.share_classes k on k.id = h.class_id
where h.shares < 0
union all
select c.code, 'transfer-unbalanced', e.transfer_ref, 'the two sides of the transfer do not match (' || sum(e.shares) || ')', 'breached'
from cap.share_events e join cap.companies c on c.id = e.company_id where e.transfer_ref is not null
group by c.code, e.transfer_ref having sum(e.shares) <> 0;

-- SAFEs and notes with interest to date (simple interest, notes only).
create or replace view cap.convertible_status as
select c.code company, v.id, v.company_id, v.code, s.name holder, v.kind, v.principal_cents, v.valuation_cap_cents, v.discount_pct, v.interest_pct,
  v.issued_on, v.maturity_on, v.status, c.currency,
  (v.principal_cents + case when v.kind = 'note' then round(v.principal_cents * v.interest_pct / 100 * (current_date - v.issued_on) / 365.0) else 0 end)::bigint owed_cents,
  case when v.status = 'outstanding' and v.maturity_on is not null then v.maturity_on - current_date end days_to_maturity
from cap.convertibles v join cap.companies c on c.id = v.company_id join cap.stakeholders s on s.id = v.stakeholder_id;
