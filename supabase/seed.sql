-- Demo data: two fictional companies a law or accounting firm might keep registers for.
--   KWR  Kowhai Robotics Limited, Auckland: founders, angels, a Series A, a staff option plan,
--        a SAFE and a convertible note.
--   HBL  Harbourline Health Pty Ltd, Sydney: founders, angels and a startup-concession option plan.
-- Dates are relative to today, so the attention commands always have something to say:
-- an exercise not yet notified, a matured note, a cliff about to hit, a leaver whose window is
-- closing, a grant with no board approval, a transfer not lodged with ASIC.
-- Idempotent: unique codes make a second run a no-op. Never run this on a live database.

insert into cap.companies (code, name, jurisdiction, company_type, company_number, currency, registered_office) values
  ('KWR', 'Kowhai Robotics Limited', 'NZ', 'limited', '8123456', 'NZD', 'Level 2, 18 Customs Street West, Auckland 1010'),
  ('HBL', 'Harbourline Health Pty Ltd', 'AU', 'proprietary', 'ACN 671 234 567', 'AUD', 'Suite 4, 120 Harris Street, Pyrmont NSW 2009')
on conflict (code) do nothing;

insert into cap.share_classes (company_id, code, name, kind, original_price, pref_multiple, participating, seniority) values
  (cap.company_id('KWR'), 'ORD', 'Ordinary shares', 'ordinary', null, 0, false, 0),
  (cap.company_id('KWR'), 'SA', 'Series A preference shares', 'preference', 1.20, 1, false, 1),
  (cap.company_id('HBL'), 'ORD', 'Ordinary shares', 'ordinary', null, 0, false, 0)
on conflict (company_id, code) do nothing;

insert into cap.stakeholders (company_id, code, name, kind, is_employee, email, address, tax_residence, started_on, ended_on) values
  (cap.company_id('KWR'), 'F1', 'Aroha Ngata', 'founder', true, 'aroha@kowhai.example', '14 Kauri Road, Grey Lynn, Auckland 1021', 'NZ', current_date - 1500, null),
  (cap.company_id('KWR'), 'F2', 'Ben Walsh', 'founder', true, 'ben@kowhai.example', '3 Wairere Avenue, Mt Albert, Auckland 1025', 'NZ', current_date - 1500, null),
  (cap.company_id('KWR'), 'E1', 'Priya Shah', 'employee', true, 'priya@kowhai.example', '22 Ponsonby Road, Auckland 1011', 'NZ', current_date - 800, null),
  (cap.company_id('KWR'), 'E2', 'Liam O''Connor', 'employee', true, 'liam@kowhai.example', '9 Domain Drive, Parnell, Auckland 1052', 'NZ', current_date - 500, current_date - 50),
  (cap.company_id('KWR'), 'E3', 'Mere Tipene', 'employee', true, 'mere@kowhai.example', '41 Great North Road, Avondale, Auckland 1026', 'NZ', current_date - 345, null),
  (cap.company_id('KWR'), 'E4', 'Josh Kim', 'employee', true, 'josh@kowhai.example', '7 Dominion Road, Balmoral, Auckland 1024', 'NZ', current_date - 610, current_date - 80),
  (cap.company_id('KWR'), 'E5', 'Sam Ortiz', 'employee', true, 'sam.ortiz@kowhai.example', '16 Hurstmere Road, Takapuna, Auckland 0622', 'NZ', current_date - 30, null),
  (cap.company_id('KWR'), 'A1', 'Dr Ruth Hale', 'advisor', false, 'ruth@halelab.example', '88 Cashel Street, Christchurch 8011', 'NZ', current_date - 400, null),
  (cap.company_id('KWR'), 'I1', 'Southern Cross Angels Nominee Limited', 'investor', false, 'deals@sxangels.example', 'PO Box 1234, Shortland Street, Auckland 1140', 'NZ', null, null),
  (cap.company_id('KWR'), 'I2', 'Tasman Ventures Fund II LP', 'investor', false, 'ops@tasmanvc.example', 'Level 9, 1 Willis Street, Wellington 6011', 'NZ', null, null),
  (cap.company_id('KWR'), 'I3', 'Hannah Reid', 'investor', false, 'hannah@reid.example', '5 Oriental Parade, Wellington 6011', 'NZ', null, null),
  (cap.company_id('KWR'), 'I4', 'Kauri Growth Partners Limited', 'investor', false, 'notes@kaurigrowth.example', '50 Albert Street, Auckland 1010', 'NZ', null, null),
  (cap.company_id('KWR'), 'T1', 'Rangi Moana Family Trust', 'trust', false, 'trustees@rangimoana.example', null, 'NZ', null, null),
  (cap.company_id('HBL'), 'F1', 'Chloe Nguyen', 'founder', true, 'chloe@harbourline.example', '12 Bay Street, Glebe NSW 2037', 'AU', current_date - 1100, null),
  (cap.company_id('HBL'), 'F2', 'Marcus Doyle', 'founder', true, 'marcus@harbourline.example', '4 Ocean Street, Bondi NSW 2026', 'AU', current_date - 1100, null),
  (cap.company_id('HBL'), 'E1', 'Ella Fraser', 'employee', true, 'ella@harbourline.example', '31 King Street, Newtown NSW 2042', 'AU', current_date - 530, null),
  (cap.company_id('HBL'), 'E2', 'Tom Baxter', 'employee', true, 'tom@harbourline.example', '8 Crown Street, Surry Hills NSW 2010', 'AU', current_date - 260, null),
  (cap.company_id('HBL'), 'I1', 'Wattle Seed Capital Pty Ltd', 'investor', false, 'invest@wattleseed.example', 'Level 3, 60 Martin Place, Sydney NSW 2000', 'AU', null, null),
  (cap.company_id('HBL'), 'I2', 'Grace Liu', 'investor', false, 'grace@liu.example', '19 Military Road, Mosman NSW 2088', 'AU', null, null),
  (cap.company_id('HBL'), 'I3', 'Daniel Okafor', 'investor', false, 'daniel@okafor.example', '2 Beach Road, Manly NSW 2095', 'AU', null, null)
on conflict (company_id, code) do nothing;

insert into cap.rounds (company_id, code, name, closed_on, price, pre_money_cents) values
  (cap.company_id('KWR'), 'ANGEL', 'Angel round', current_date - 900, 0.50, 450000000),
  (cap.company_id('KWR'), 'A', 'Series A', current_date - 300, 1.20, 1140000000),
  (cap.company_id('HBL'), 'SEED', 'Seed round', current_date - 400, 0.80, 480000000)
on conflict (company_id, code) do nothing;

insert into cap.share_events (company_id, code, stakeholder_id, class_id, kind, shares, price, on_date, round_id, transfer_ref, certificate_no, board_approved_on) values
  (cap.company_id('KWR'), 'K-001', cap.holder_id('KWR', 'F1'), cap.class_id('KWR', 'ORD'), 'issue', 4000000, 0.0001, current_date - 1500, null, null, 'C1', current_date - 1500),
  (cap.company_id('KWR'), 'K-002', cap.holder_id('KWR', 'F2'), cap.class_id('KWR', 'ORD'), 'issue', 4000000, 0.0001, current_date - 1500, null, null, 'C2', current_date - 1500),
  (cap.company_id('KWR'), 'K-003', cap.holder_id('KWR', 'I1'), cap.class_id('KWR', 'ORD'), 'issue', 600000, 0.50, current_date - 900, (select id from cap.rounds where company_id = cap.company_id('KWR') and code = 'ANGEL'), null, 'C3', current_date - 905),
  (cap.company_id('KWR'), 'K-004', cap.holder_id('KWR', 'F2'), cap.class_id('KWR', 'ORD'), 'transfer_out', -200000, 0.45, current_date - 120, null, 'TR-1', null, current_date - 125),
  (cap.company_id('KWR'), 'K-005', cap.holder_id('KWR', 'T1'), cap.class_id('KWR', 'ORD'), 'transfer_in', 200000, 0.45, current_date - 120, null, 'TR-1', 'C4', current_date - 125),
  (cap.company_id('KWR'), 'K-006', cap.holder_id('KWR', 'I2'), cap.class_id('KWR', 'SA'), 'issue', 1250000, 1.20, current_date - 300, (select id from cap.rounds where company_id = cap.company_id('KWR') and code = 'A'), null, 'P1', current_date - 305),
  (cap.company_id('KWR'), 'K-007', cap.holder_id('KWR', 'I1'), cap.class_id('KWR', 'SA'), 'issue', 250000, 1.20, current_date - 300, (select id from cap.rounds where company_id = cap.company_id('KWR') and code = 'A'), null, 'P2', current_date - 305),
  (cap.company_id('KWR'), 'K-008', cap.holder_id('KWR', 'E1'), cap.class_id('KWR', 'ORD'), 'exercise', 40000, 0.45, current_date - 25, null, null, 'C5', null),
  (cap.company_id('HBL'), 'H-001', cap.holder_id('HBL', 'F1'), cap.class_id('HBL', 'ORD'), 'issue', 3000000, 0.0001, current_date - 1100, null, null, '1', current_date - 1100),
  (cap.company_id('HBL'), 'H-002', cap.holder_id('HBL', 'F2'), cap.class_id('HBL', 'ORD'), 'issue', 3000000, 0.0001, current_date - 1100, null, null, '2', current_date - 1100),
  (cap.company_id('HBL'), 'H-003', cap.holder_id('HBL', 'I1'), cap.class_id('HBL', 'ORD'), 'issue', 500000, 0.80, current_date - 400, (select id from cap.rounds where company_id = cap.company_id('HBL') and code = 'SEED'), null, '3', current_date - 402),
  (cap.company_id('HBL'), 'H-004', cap.holder_id('HBL', 'I2'), cap.class_id('HBL', 'ORD'), 'issue', 125000, 0.80, current_date - 400, (select id from cap.rounds where company_id = cap.company_id('HBL') and code = 'SEED'), null, '4', current_date - 402),
  (cap.company_id('HBL'), 'H-005', cap.holder_id('HBL', 'I2'), cap.class_id('HBL', 'ORD'), 'transfer_out', -25000, 1.00, current_date - 40, null, 'TR-H1', null, null),
  (cap.company_id('HBL'), 'H-006', cap.holder_id('HBL', 'I3'), cap.class_id('HBL', 'ORD'), 'transfer_in', 25000, 1.00, current_date - 40, null, 'TR-H1', '5', null),
  (cap.company_id('HBL'), 'H-007', cap.holder_id('HBL', 'I3'), cap.class_id('HBL', 'ORD'), 'issue', 62500, 0.80, current_date - 23, (select id from cap.rounds where company_id = cap.company_id('HBL') and code = 'SEED'), null, '6', current_date - 25)
on conflict (company_id, code) do nothing;

insert into cap.plans (company_id, code, name, class_id, pool_size, adopted_on, tax_treatment) values
  (cap.company_id('KWR'), 'ESOP', 'Kowhai Robotics Share Option Plan', cap.class_id('KWR', 'ORD'), 1000000, current_date - 820, 'standard'),
  (cap.company_id('HBL'), 'ESOP', 'Harbourline Employee Option Plan', cap.class_id('HBL', 'ORD'), 400000, current_date - 540, 'au-startup')
on conflict (company_id, code) do nothing;

insert into cap.grants (company_id, code, plan_id, stakeholder_id, granted_on, quantity, exercise_price, vesting_start, vest_months, cliff_months, vest_every_months, expires_on, board_approved_on) values
  (cap.company_id('KWR'), 'G-01', (select id from cap.plans where company_id = cap.company_id('KWR') and code = 'ESOP'), cap.holder_id('KWR', 'E1'), current_date - 790, 120000, 0.45, current_date - 800, 48, 12, 1, current_date + 2850, current_date - 795),
  (cap.company_id('KWR'), 'G-02', (select id from cap.plans where company_id = cap.company_id('KWR') and code = 'ESOP'), cap.holder_id('KWR', 'E2'), current_date - 495, 100000, 0.45, current_date - 500, 48, 12, 1, current_date + 3150, current_date - 497),
  (cap.company_id('KWR'), 'G-03', (select id from cap.plans where company_id = cap.company_id('KWR') and code = 'ESOP'), cap.holder_id('KWR', 'E4'), current_date - 605, 80000, 0.45, current_date - 610, 48, 12, 1, current_date + 3050, current_date - 597),
  (cap.company_id('KWR'), 'G-04', (select id from cap.plans where company_id = cap.company_id('KWR') and code = 'ESOP'), cap.holder_id('KWR', 'E3'), current_date - 340, 60000, 0.95, current_date - 345, 48, 12, 1, current_date + 3300, current_date - 342),
  (cap.company_id('KWR'), 'G-05', (select id from cap.plans where company_id = cap.company_id('KWR') and code = 'ESOP'), cap.holder_id('KWR', 'A1'), current_date - 395, 20000, 0.45, current_date - 400, 24, 0, 3, current_date + 3250, current_date - 397),
  (cap.company_id('KWR'), 'G-06', (select id from cap.plans where company_id = cap.company_id('KWR') and code = 'ESOP'), cap.holder_id('KWR', 'E5'), current_date - 28, 50000, 1.10, current_date - 30, 48, 12, 1, current_date + 3620, null),
  (cap.company_id('HBL'), 'G-01', (select id from cap.plans where company_id = cap.company_id('HBL') and code = 'ESOP'), cap.holder_id('HBL', 'E1'), current_date - 500, 150000, 0.80, current_date - 530, 48, 12, 1, current_date + 3150, current_date - 502),
  (cap.company_id('HBL'), 'G-02', (select id from cap.plans where company_id = cap.company_id('HBL') and code = 'ESOP'), cap.holder_id('HBL', 'E2'), current_date - 255, 80000, 0.80, current_date - 260, 48, 12, 1, null, current_date - 257)
on conflict (company_id, code) do nothing;

insert into cap.exercises (grant_id, share_event_id, quantity, on_date)
select g.id, e.id, 40000, current_date - 25 from cap.grants g, cap.share_events e
where g.company_id = cap.company_id('KWR') and g.code = 'G-01' and e.company_id = cap.company_id('KWR') and e.code = 'K-008'
on conflict (share_event_id) do nothing;

insert into cap.convertibles (company_id, code, stakeholder_id, kind, principal_cents, valuation_cap_cents, discount_pct, interest_pct, issued_on, maturity_on, board_approved_on) values
  (cap.company_id('KWR'), 'SAFE-1', cap.holder_id('KWR', 'I3'), 'safe', 15000000, 1500000000, 20, 0, current_date - 90, null, current_date - 92),
  (cap.company_id('KWR'), 'NOTE-1', cap.holder_id('KWR', 'I4'), 'note', 10000000, 1400000000, 15, 8, current_date - 375, current_date - 10, current_date - 377)
on conflict (company_id, code) do nothing;

insert into cap.valuations (company_id, class_id, on_date, price, method) values
  (cap.company_id('KWR'), cap.class_id('KWR', 'ORD'), current_date - 820, 0.45, 'Independent valuation, ordinary shares'),
  (cap.company_id('KWR'), cap.class_id('KWR', 'ORD'), current_date - 200, 0.95, 'Independent valuation after the Series A'),
  (cap.company_id('KWR'), cap.class_id('KWR', 'SA'), current_date - 300, 1.20, 'Series A price'),
  (cap.company_id('HBL'), cap.class_id('HBL', 'ORD'), current_date - 400, 0.80, 'Seed round price')
on conflict (class_id, on_date) do nothing;

-- Filings already made. Missing on purpose: KWR's notice and ESS income for Priya's exercise,
-- HBL's Form 484 for the transfer, and HBL's ESS annual report for the year of Ella's grant.
insert into cap.filings (company_id, kind, subject_ref, filed_on, reference, filed_by) values
  (cap.company_id('KWR'), 'nz-share-issue', 'K-001', current_date - 1498, 'Incorporation', 'Aroha Ngata'),
  (cap.company_id('KWR'), 'nz-share-issue', 'K-002', current_date - 1498, 'Incorporation', 'Aroha Ngata'),
  (cap.company_id('KWR'), 'nz-share-issue', 'K-003', current_date - 893, 'Share issue notice', 'Aroha Ngata'),
  (cap.company_id('KWR'), 'nz-share-issue', 'K-006', current_date - 295, 'Share issue notice', 'Kate Lim, Lim Legal'),
  (cap.company_id('KWR'), 'nz-share-issue', 'K-007', current_date - 295, 'Share issue notice', 'Kate Lim, Lim Legal'),
  (cap.company_id('HBL'), 'au-form-484', 'H-001', current_date - 1100, 'Registration', 'Chloe Nguyen'),
  (cap.company_id('HBL'), 'au-form-484', 'H-002', current_date - 1100, 'Registration', 'Chloe Nguyen'),
  (cap.company_id('HBL'), 'au-form-484', 'H-003', current_date - 385, '484 lodged', 'Chloe Nguyen'),
  (cap.company_id('HBL'), 'au-form-484', 'H-004', current_date - 385, '484 lodged', 'Chloe Nguyen'),
  (cap.company_id('HBL'), 'au-ess-statement', 'FY' || (extract(year from current_date - 500) + case when extract(month from current_date - 500) >= 7 then 1 else 0 end)::int,
    make_date((extract(year from current_date - 500) + case when extract(month from current_date - 500) >= 7 then 1 else 0 end)::int, 7, 10), 'Statement emailed', 'Marcus Doyle')
on conflict (company_id, kind, subject_ref) do nothing;

insert into cap.notes (subject_type, subject_id, author, body)
select 'stakeholder', cap.holder_id('KWR', 'E4'), 'Aroha Ngata', 'Josh said he wants to exercise before his window closes. Waiting on funds.'
where not exists (select 1 from cap.notes where subject_id = cap.holder_id('KWR', 'E4'));
insert into cap.notes (subject_type, subject_id, author, body)
select 'convertible', (select id from cap.convertibles where code = 'NOTE-1'), 'Ben Walsh', 'Kauri happy to extend the note to the next round. Needs a board resolution and a deed of variation.'
where not exists (select 1 from cap.notes where subject_id = (select id from cap.convertibles where code = 'NOTE-1'));
