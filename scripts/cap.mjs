#!/usr/bin/env node
// The one CLI. Every slash command drives this file.
//   npm run cap -- help
//   npm run cap -- cap-table --company=KWR [--json]
// Reads print aligned tables; --json prints rows for machines. Writes run in one transaction.
// --company takes a company code or name. With one company in the database it can be left off.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick } from './lib/csv.mjs';
import { table } from './lib/format.mjs';

export const TABLES = ['settings', 'companies', 'stakeholders', 'share_classes', 'rounds', 'share_events', 'plans', 'grants', 'exercises',
  'convertibles', 'valuations', 'filings', 'notes', 'import_rows'];

const num = (col) => `trim_scale(${col})`;
const cash = (col) => `to_char(${col} / 100.0, 'FM999G999G999G990')`;
// Reads filtered by company: $1 is the company id, or null for every company.
export const READS = {
  companies: `select c.code, c.name, c.jurisdiction, c.company_type type, c.company_number number, c.currency,
    (select count(*) from cap.cap_table t where t.company_id = c.id and t.kind <> 'pool')::int holders,
    (select coalesce(sum(issued), 0) from cap.cap_table t where t.company_id = c.id)::bigint issued,
    (select coalesce(sum(fully_diluted), 0) from cap.cap_table t where t.company_id = c.id)::bigint fully_diluted,
    (select count(*) from cap.obligations o where o.company_id = c.id and o.state = 'OVERDUE')::int overdue_filings
    from cap.companies c where ($1::uuid is null or c.id = $1) order by c.code`,
  'cap-table': `select company, code, name, kind, ordinary, preference, options, fully_diluted, issued_pct, fd_pct
    from cap.cap_table where ($1::uuid is null or company_id = $1) order by company, kind = 'pool', fully_diluted desc, code`,
  classes: `select c.code company, k.code, k.name, k.kind, ${num('k.votes_per_share')} votes, ${num('k.original_price')} original_price,
    ${num('k.pref_multiple')} pref_multiple, k.participating, k.seniority,
    coalesce((select sum(h.shares) from cap.holdings h where h.class_id = k.id), 0)::bigint issued
    from cap.share_classes k join cap.companies c on c.id = k.company_id where ($1::uuid is null or c.id = $1) order by c.code, k.seniority desc, k.code`,
  ledger: `select c.code company, e.code, e.on_date, replace(e.kind, '_', ' ') kind, s.name holder, k.code class, e.shares, ${num('e.price')} price,
    coalesce(r.code, '') round, coalesce(e.certificate_no, '') cert, coalesce(e.board_approved_on::text, '') board_approved
    from cap.share_events e join cap.companies c on c.id = e.company_id join cap.stakeholders s on s.id = e.stakeholder_id
    join cap.share_classes k on k.id = e.class_id left join cap.rounds r on r.id = e.round_id
    where ($1::uuid is null or c.id = $1) order by c.code, e.on_date, e.code`,
  grants: `select company, code, holder, plan, granted_on, quantity, ${num('exercise_price')} price, vested, exercised, exercisable, unvested, outstanding,
    case when status = 'cancelled' then 'cancelled' when expired then 'expired' when left_company then 'leaver' when months_vested < cliff_months then 'before cliff' else 'vesting' end state
    from cap.grant_status where ($1::uuid is null or company_id = $1) order by company, code`,
  pool: `select company, plan, name, pool_size, granted, exercised, outstanding, returned, available,
    round(100.0 * available / nullif(pool_size, 0), 1) available_pct from cap.pool where ($1::uuid is null or company_id = $1) order by company, plan`,
  leavers: `select l.company, l.holder, l.grant_code, l.ended_on, l.vested, l.exercised, l.exercisable, l.returned_unvested, l.window_ends_on,
    case when l.expired then 'expired' else l.days_left || ' days' end window_left, ${num('l.exercise_price')} price
    from cap.leavers l join cap.companies c on c.code = l.company where ($1::uuid is null or c.id = $1) order by l.expired, l.days_left`,
  convertibles: `select company, code, holder, kind, currency, ${cash('principal_cents')} principal, ${cash('valuation_cap_cents')} cap, ${num('discount_pct')} discount_pct,
    ${num('interest_pct')} interest_pct, ${cash('owed_cents')} owed_now, issued_on, coalesce(maturity_on::text, '') maturity_on, status,
    case when days_to_maturity < 0 then 'MATURED' when days_to_maturity <= 60 then days_to_maturity || ' days' else '' end flag
    from cap.convertible_status where ($1::uuid is null or company_id = $1) order by company, status, issued_on`,
  filings: `select company, kind, subject_ref subject, event_on, due_on, state, coalesce(days_left::text, '') days_left, coalesce(filed_on::text, '') filed_on, detail
    from cap.obligations where ($1::uuid is null or company_id = $1) and (state not in ('filed', 'filed late') or filed_on >= current_date - 90)
    order by state = 'OVERDUE' desc, state = 'due soon' desc, due_on, company`,
  compliance: `select f.company, f.severity, f.rule, f.subject, f.detail from cap.compliance_findings f join cap.companies c on c.code = f.company
    where ($1::uuid is null or c.id = $1) order by case f.severity when 'breached' then 0 when 'due soon' then 1 when 'near limit' then 2 else 3 end, f.company, f.rule, f.subject`,
};

const OPTION_READS = {
  // Who vests in the next N days, cliffs first.
  vesting: { opts: ['days'], run: (db, co, o) => {
    const days = Number(o.days || 90);
    if (!Number.isInteger(days) || days < 1) throw Error('--days must be a whole number of days');
    return db.query(`select v.company, v.vests_on, v.holder, v.grant_code, v.quantity, case when v.cliff then 'CLIFF' else '' end cliff
      from cap.vest_events v join cap.companies c on c.code = v.company
      where ($1::uuid is null or c.id = $1) and v.vests_on between current_date and current_date + $2::int order by v.vests_on, v.company, v.holder`, [co, days]);
  } },
  'round-model': { opts: ['raise', 'pre-money', 'pool', 'investor', 'no-convert'], run: roundModel, needsCompany: true },
  waterfall: { opts: ['exit'], run: waterfall, needsCompany: true },
};

const ADD_FIELDS = {
  companies: ['code', 'name', 'jurisdiction', 'company_type', 'company_number', 'currency', 'registered_office'],
  stakeholders: ['company_id', 'code', 'name', 'kind', 'is_employee', 'email', 'address', 'tax_residence', 'started_on', 'ended_on'],
  share_classes: ['company_id', 'code', 'name', 'kind', 'votes_per_share', 'original_price', 'pref_multiple', 'participating', 'seniority'],
  rounds: ['company_id', 'code', 'name', 'closed_on', 'price', 'pre_money_cents'],
  plans: ['company_id', 'code', 'name', 'class_id', 'pool_size', 'adopted_on', 'tax_treatment'],
  convertibles: ['company_id', 'code', 'stakeholder_id', 'kind', 'principal_cents', 'valuation_cap_cents', 'discount_pct', 'interest_pct', 'issued_on', 'maturity_on', 'board_approved_on'],
};
const LOOKUP = {
  companies: { label: 'companies', sql: 'select id, code, name, id company_id from cap.companies' },
  stakeholders: { label: 'stakeholders', sql: 'select id, code, name, company_id from cap.stakeholders' },
  share_classes: { label: 'share classes', sql: 'select id, code, name, company_id from cap.share_classes' },
  plans: { label: 'plans', sql: 'select id, code, name, company_id from cap.plans' },
  rounds: { label: 'rounds', sql: 'select id, code, name, company_id from cap.rounds' },
  grants: { label: 'grants', sql: 'select g.id, g.code, s.name, g.company_id from cap.grants g join cap.stakeholders s on s.id = g.stakeholder_id' },
  convertibles: { label: 'convertibles', sql: 'select v.id, v.code, s.name, v.company_id from cap.convertibles v join cap.stakeholders s on s.id = v.stakeholder_id' },
  events: { label: 'share events', sql: "select e.id, e.code, s.name || ' ' || e.kind name, e.company_id from cap.share_events e join cap.stakeholders s on s.id = e.stakeholder_id" },
};
const REFS = { stakeholder_id: 'stakeholders', class_id: 'share_classes' };
const FILING_KINDS = ['nz-share-issue', 'au-form-484', 'au-ess-statement', 'au-ess-report', 'nz-ess-income', 'annual-return'];

const HELP = {
  reads: [...Object.keys(READS), ...Object.keys(OPTION_READS), 'attention'].sort(),
  details: ['company <ref>', 'stakeholder <ref>', 'grant <ref>'],
  options: ['--company=<code or name> on any read or write; optional when the database holds one company'],
  writes: ['add <type> --data=<file.json>', 'log <stakeholder|grant|company|convertible> <ref> --author= --text=',
    'issue-shares <holder> --class= --shares= --price= [--on=] [--round=] [--approved-on=] [--certificate=]',
    'transfer <from> <to> --class= --shares= [--price=] [--on=] [--approved-on=] [--certificate=]',
    'grant-options <holder> --plan= --quantity= --price= [--granted-on=] [--start=] [--months=48] [--cliff=12] [--every=1] [--expires=] [--approved-on=]',
    'exercise <grant> --quantity= [--on=] [--certificate=]', 'cancel-grant <grant> [--on=]', 'leave <holder> --on=',
    'approve <event or grant> --on=', 'convert <convertible> --round= --shares= --class= [--on=]',
    'record-filing --kind=<kind> --subject=<ref> --on= [--reference=] [--by=]', 'record-valuation --class= --price= --method= [--on=]',
    'import carta --file=<csv> [--dry-run]', 'import stakeholders --file=<csv> [--dry-run]',
    'export --out=<file.json>', 'draft-weekly', 'draft-leaver-letter <holder>', 'draft-filings'],
};

// ------------------------------------------------------------------ helpers
export function date(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw Error(`Invalid date "${v}". Use YYYY-MM-DD.`);
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw Error(`Invalid date "${v}".`);
  return v;
}
// "150000", "$150,000", "NZD 150000.50" -> cents
export function cents(v, label = 'amount') {
  const s = String(v ?? '').trim().replace(/^[A-Z]{3}\s*/i, '').replace(/^[$€£]/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw Error(`${label} "${v}" is not an amount. Use 150000 or 150000.50.`);
  return Math.round(Number(s) * 100);
}
// "1,250,000" -> 1250000. Shares are whole numbers.
export function shares(v, label = '--shares') {
  const s = String(v ?? '').trim().replace(/,/g, '');
  if (!/^\d+$/.test(s) || Number(s) <= 0) throw Error(`${label} "${v}" must be a whole number of shares above zero`);
  return Number(s);
}
// "0.45", "$1.20" -> "0.45". Share prices keep up to six decimals.
export function sharePrice(v, label = '--price') {
  const s = String(v ?? '').trim().replace(/^[A-Z]{3}\s*/i, '').replace(/^[$€£]/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,6})?$/.test(s)) throw Error(`${label} "${v}" is not a price per share. Use 0.45 or 1.20.`);
  return s;
}
function parseArgs(args) {
  const pos = []; const opts = {};
  for (const a of args) {
    if (a.startsWith('--')) { const eq = a.indexOf('='); opts[eq < 0 ? a.slice(2) : a.slice(2, eq)] = eq < 0 ? true : a.slice(eq + 1); }
    else pos.push(a);
  }
  return { pos, opts };
}
function allow(opts, names) {
  for (const k of Object.keys(opts)) if (!['json', 'company', ...names].includes(k)) throw Error(`Unknown option --${k}`);
}
function need(opts, k) { if (opts[k] === undefined || opts[k] === true || String(opts[k]).trim() === '') throw Error(`--${k} is required`); return String(opts[k]).trim(); }
function noExtra(pos, n) { if (pos.length > n) throw Error(`Unexpected argument "${pos[n]}"`); }
function oneOf(v, list, label) { if (!list.includes(v)) throw Error(`${label} must be one of: ${list.join(', ')}`); return v; }
async function tx(db, fn, { dryRun = false } = {}) {
  await db.exec('BEGIN');
  try { const out = await fn(); await db.exec(dryRun ? 'ROLLBACK' : 'COMMIT'); return out; }
  catch (e) { await db.exec('ROLLBACK'); throw e; }
}

// --company, or the only company there is. Required = an error when it cannot be worked out.
export async function company(db, opts, required = false) {
  if (opts.company && opts.company !== true) return resolve(db, 'companies', String(opts.company));
  if (!required) return null;
  const all = await db.query('select id, code, name, id company_id from cap.companies order by code');
  if (all.length === 1) return all[0];
  throw Error(`Name the company with --company=: ${all.map((c) => `${c.code} (${c.name})`).join(', ') || 'none yet, add one first'}`);
}

// Code, name (case insensitive), or UUID prefix, inside one company when it is known.
// Ambiguity lists the candidates with their company.
export async function resolve(db, kind, ref, co = null) {
  const l = LOOKUP[kind];
  if (!ref) throw Error(`Name a ${l.label.replace(/s$/, '')}`);
  const rows = await db.query(`select t.*, c.code company from (${l.sql}) t join cap.companies c on c.id = t.company_id
    where ($2::uuid is null or t.company_id = $2) and (lower(t.code) = lower($1) or lower(t.name) = lower($1) or t.id::text like lower($1) || '%'
    or lower(t.name) like '%' || lower($1) || '%')`, [ref, co ? co.id : null]);
  const exact = rows.filter((r) => r.code.toLowerCase() === ref.toLowerCase() || r.name.toLowerCase() === ref.toLowerCase());
  const hits = exact.length ? exact : rows;
  if (!hits.length) throw Error(`No ${l.label} match "${ref}"${co ? ` in ${co.code}` : ''}`);
  if (hits.length > 1) throw Error(`Ambiguous ${l.label} "${ref}": ${hits.map((r) => `${r.company} ${r.code} (${r.name})`).join(', ')}. Add --company=`);
  return hits[0];
}
const companyOf = async (db, id) => (await db.query('select id, code, name, jurisdiction, currency from cap.companies where id = $1', [id]))[0];

// ------------------------------------------------------------------ commands
export async function run(db, argv) {
  const [cmd, ...rest] = argv;
  const { pos, opts } = parseArgs(rest);
  if (!cmd || cmd === 'help') return HELP;
  if (READS[cmd]) { allow(opts, []); noExtra(pos, 0); const co = await company(db, opts); return db.query(READS[cmd], [co ? co.id : null]); }
  if (OPTION_READS[cmd]) {
    const r = OPTION_READS[cmd]; allow(opts, r.opts); noExtra(pos, 0);
    const co = await company(db, opts, !!r.needsCompany);
    return r.run(db, co ? co.id : null, opts);
  }
  switch (cmd) {
    case 'attention': { allow(opts, []); noExtra(pos, 0); const co = await company(db, opts); return attention(db, co ? co.id : null); }
    case 'company': {
      allow(opts, []); noExtra(pos, 1);
      const c = await resolve(db, 'companies', pos[0]);
      return {
        company: (await db.query('select code, name, jurisdiction, company_type, company_number, currency, registered_office from cap.companies where id = $1', [c.id]))[0],
        cap_table: await db.query(READS['cap-table'], [c.id]),
        pool: await db.query(READS.pool, [c.id]),
        filings_open: (await db.query(READS.filings, [c.id])).filter((r) => !r.state.startsWith('filed')),
        rule_findings: await db.query(READS.compliance, [c.id]),
      };
    }
    case 'stakeholder': {
      allow(opts, []); noExtra(pos, 1);
      const s = await resolve(db, 'stakeholders', pos[0], await company(db, opts));
      return {
        stakeholder: (await db.query(`select c.code company, s.code, s.name, s.kind, s.is_employee employee, s.email, s.address, s.tax_residence, s.started_on, s.ended_on
          from cap.stakeholders s join cap.companies c on c.id = s.company_id where s.id = $1`, [s.id]))[0],
        holdings: await db.query('select k.code class, k.name, h.shares from cap.holdings h join cap.share_classes k on k.id = h.class_id where h.stakeholder_id = $1 and h.shares <> 0 order by k.code', [s.id]),
        grants: await db.query(`select code, granted_on, quantity, ${num('exercise_price')} price, vested, exercised, exercisable, unvested, outstanding, expires_on
          from cap.grant_status where stakeholder_id = $1 order by granted_on`, [s.id]),
        next_vesting: await db.query("select vests_on, grant_code, quantity, cliff from cap.vest_events where holder_code = $1 and company = $2 and vests_on >= current_date order by vests_on limit 3", [s.code, s.company]),
        ledger: await db.query(`select e.code, e.on_date, replace(e.kind, '_', ' ') kind, k.code class, e.shares, ${num('e.price')} price, coalesce(e.certificate_no, '') cert
          from cap.share_events e join cap.share_classes k on k.id = e.class_id where e.stakeholder_id = $1 order by e.on_date`, [s.id]),
        convertibles: await db.query(`select code, kind, ${cash('principal_cents')} principal, ${cash('owed_cents')} owed_now, status, maturity_on from cap.convertible_status
          where id in (select id from cap.convertibles where stakeholder_id = $1)`, [s.id]),
        notes: await db.query("select created_at, author, body from cap.notes where subject_type = 'stakeholder' and subject_id = $1 order by created_at", [s.id]),
      };
    }
    case 'grant': {
      allow(opts, []); noExtra(pos, 1);
      const g = await resolve(db, 'grants', pos[0], await company(db, opts));
      return {
        grant: (await db.query(`select company, code, holder, plan, granted_on, quantity, ${num('exercise_price')} price, vesting_start, vest_months, cliff_months,
          vest_every_months, expires_on, board_approved_on, status, vested, exercised, exercisable, unvested, outstanding,
          case when left_company then window_ends_on end leaver_window_ends from cap.grant_status where id = $1`, [g.id]))[0],
        schedule: await db.query('select vests_on, quantity, cliff, vests_on <= current_date vested from cap.vest_events where grant_id = $1 order by vests_on', [g.id]),
        exercises: await db.query('select x.on_date, x.quantity, e.code share_event, e.certificate_no cert from cap.exercises x join cap.share_events e on e.id = x.share_event_id where x.grant_id = $1 order by x.on_date', [g.id]),
      };
    }
    case 'add': return add(db, pos, opts);
    case 'log': {
      allow(opts, ['author', 'text']); noExtra(pos, 2);
      const kinds = { stakeholder: 'stakeholders', grant: 'grants', company: 'companies', convertible: 'convertibles' };
      if (!kinds[pos[0]]) throw Error('log needs stakeholder, grant, company or convertible first');
      const co = pos[0] === 'company' ? null : await company(db, opts);
      const target = await resolve(db, kinds[pos[0]], pos[1], co);
      const [row] = await db.query('insert into cap.notes (subject_type, subject_id, author, body) values ($1, $2, $3, $4) returning created_at, author, body',
        [pos[0], target.id, need(opts, 'author'), need(opts, 'text')]);
      return { logged: `${target.company} ${target.code}`, ...row };
    }
    case 'issue-shares': return issueShares(db, pos, opts);
    case 'transfer': return transfer(db, pos, opts);
    case 'grant-options': return grantOptions(db, pos, opts);
    case 'exercise': return exercise(db, pos, opts);
    case 'cancel-grant': {
      allow(opts, ['on']); noExtra(pos, 1);
      const g = await resolve(db, 'grants', pos[0], await company(db, opts));
      const [row] = await db.query(`update cap.grants set status = 'cancelled', cancelled_on = coalesce($2::date, current_date) where id = $1 and status = 'active'
        returning code, cancelled_on`, [g.id, opts.on ? date(opts.on) : null]);
      if (!row) throw Error(`${g.code} is already cancelled`);
      return { ...row, back_to_pool: (await db.query('select quantity - exercised n from cap.grant_status where id = $1', [g.id]))[0].n };
    }
    case 'leave': {
      allow(opts, ['on']); noExtra(pos, 1);
      const s = await resolve(db, 'stakeholders', pos[0], await company(db, opts));
      const on = date(need(opts, 'on'));
      const [row] = await db.query('update cap.stakeholders set ended_on = $2 where id = $1 and ended_on is null returning code, name, ended_on', [s.id, on]);
      if (!row) throw Error(`${s.name} already has a leaving date`);
      return { ...row, grants: await db.query(`select code, quantity, vested, exercised, quantity - vested back_to_pool, exercisable, window_ends_on
        from cap.grant_status where stakeholder_id = $1 and status = 'active'`, [s.id]) };
    }
    case 'approve': {
      allow(opts, ['on']); noExtra(pos, 1);
      const co = await company(db, opts); const on = date(need(opts, 'on'));
      const rows = await db.query(`select 'grant' t, id, code, company_id from cap.grants where lower(code) = lower($1) and ($2::uuid is null or company_id = $2)
        union all select 'event', id, code, company_id from cap.share_events where lower(code) = lower($1) and ($2::uuid is null or company_id = $2)
        union all select 'convertible', id, code, company_id from cap.convertibles where lower(code) = lower($1) and ($2::uuid is null or company_id = $2)`, [pos[0] || '', co ? co.id : null]);
      if (!rows.length) throw Error(`No grant, share event or convertible "${pos[0]}"`);
      if (rows.length > 1) throw Error(`Ambiguous "${pos[0]}". Add --company=`);
      const t = { grant: 'grants', event: 'share_events', convertible: 'convertibles' }[rows[0].t];
      await db.query(`update cap.${t} set board_approved_on = $2 where id = $1`, [rows[0].id, on]);
      return { approved: rows[0].code, kind: rows[0].t, board_approved_on: on };
    }
    case 'convert': return convert(db, pos, opts);
    case 'record-filing': {
      allow(opts, ['kind', 'subject', 'on', 'reference', 'by']); noExtra(pos, 0);
      const co = await company(db, opts, true);
      const kind = oneOf(need(opts, 'kind'), FILING_KINDS, '--kind');
      const subject = need(opts, 'subject');
      const owed = await db.query('select due_on from cap.obligations where company_id = $1 and kind = $2 and subject_ref = $3', [co.id, kind, subject]);
      if (!owed.length && kind !== 'annual-return') throw Error(`Nothing owed for ${kind} ${subject} in ${co.code}. Run: npm run cap -- filings --company=${co.code}`);
      const [row] = await db.query(`insert into cap.filings (company_id, kind, subject_ref, filed_on, reference, filed_by) values ($1, $2, $3, $4, $5, $6)
        on conflict (company_id, kind, subject_ref) do nothing returning kind, subject_ref, filed_on`, [co.id, kind, subject, date(need(opts, 'on')), opts.reference || null, opts.by || null]);
      if (!row) throw Error(`${kind} ${subject} is already recorded as filed`);
      return { ...row, due_on: owed[0]?.due_on || '', late: owed.length ? row.filed_on > owed[0].due_on : false };
    }
    case 'record-valuation': {
      allow(opts, ['class', 'price', 'method', 'on']); noExtra(pos, 0);
      const co = await company(db, opts, true);
      const k = await resolve(db, 'share_classes', need(opts, 'class'), co);
      const [row] = await db.query(`insert into cap.valuations (company_id, class_id, on_date, price, method) values ($1, $2, coalesce($3::date, current_date), $4, $5)
        returning on_date, trim_scale(price) price, method`, [co.id, k.id, opts.on ? date(opts.on) : null, sharePrice(need(opts, 'price')), need(opts, 'method')]);
      return { company: co.code, class: k.code, ...row };
    }
    case 'import': return importCsv(db, pos, opts);
    case 'export': {
      allow(opts, ['out']); noExtra(pos, 0);
      const out = path.resolve(need(opts, 'out'));
      const data = {};
      for (const t of TABLES) data[t] = await db.query(`select * from cap.${t}`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, JSON.stringify({ exported_at: new Date().toISOString(), tables: data }, null, 2), { mode: 0o600 });
      return { file: out, counts: Object.fromEntries(TABLES.map((t) => [t, data[t].length])) };
    }
    case 'draft-weekly': { allow(opts, []); noExtra(pos, 0); const co = await company(db, opts); return draftWeekly(db, co); }
    case 'draft-leaver-letter': { allow(opts, []); noExtra(pos, 1); return draftLeaverLetter(db, await resolve(db, 'stakeholders', pos[0], await company(db, opts))); }
    case 'draft-filings': { allow(opts, []); noExtra(pos, 0); const co = await company(db, opts); return draftFilings(db, co); }
    default: throw Error(`Unknown command "${cmd}". Run: npm run cap -- help`);
  }
}

async function attention(db, co) {
  const items = [];
  for (const r of await db.query(READS.filings, [co])) {
    if (r.state === 'OVERDUE') items.push({ company: r.company, area: 'filings', item: `${r.kind} ${r.subject}`, detail: `due ${r.due_on}, ${-Number(r.days_left)} days overdue: ${r.detail}` });
    if (r.state === 'due soon') items.push({ company: r.company, area: 'filings', item: `${r.kind} ${r.subject}`, detail: `due ${r.due_on}, ${r.days_left} days left: ${r.detail}` });
  }
  for (const r of await db.query(READS.compliance, [co])) if (!/^(nz|au)-(share|ess)/.test(r.rule))
    items.push({ company: r.company, area: 'rules', item: `${r.rule} ${r.subject}`, detail: r.detail });
  for (const r of await db.query(READS.leavers, [co])) if (r.window_left !== 'expired' && parseInt(r.window_left, 10) <= 30 && Number(r.exercisable) > 0)
    items.push({ company: r.company, area: 'leavers', item: `${r.holder} ${r.grant_code}`, detail: `${r.exercisable} vested options lapse on ${r.window_ends_on} unless exercised (${r.window_left} left)` });
  for (const r of await OPTION_READS.vesting.run(db, co, { days: 30 })) if (r.cliff)
    items.push({ company: r.company, area: 'vesting', item: `${r.holder} ${r.grant_code}`, detail: `cliff on ${r.vests_on}: ${r.quantity} options vest at once` });
  for (const r of await db.query(READS.pool, [co])) if (Number(r.available_pct) < 10)
    items.push({ company: r.company, area: 'pool', item: r.plan, detail: `${r.available} options left, ${r.available_pct}% of the pool` });
  for (const r of await db.query(READS.convertibles, [co])) if (r.status === 'outstanding' && r.flag && r.flag !== 'MATURED')
    items.push({ company: r.company, area: 'convertibles', item: `${r.code} ${r.holder}`, detail: `${r.kind} matures in ${r.flag}` });
  return items;
}

async function add(db, pos, opts) {
  allow(opts, ['data']); noExtra(pos, 1);
  const type = pos[0];
  if (!ADD_FIELDS[type]) throw Error(`add needs one of: ${Object.keys(ADD_FIELDS).join(', ')}`);
  const data = JSON.parse(fs.readFileSync(need(opts, 'data'), 'utf8'));
  const unknown = Object.keys(data).filter((k) => !ADD_FIELDS[type].includes(k));
  if (unknown.length) throw Error(`Unknown field(s) for ${type}: ${unknown.join(', ')}`);
  if (type !== 'companies') {
    const co = data.company_id ? await resolve(db, 'companies', String(data.company_id)) : await company(db, opts, true);
    data.company_id = co.id;
    for (const [k, kind] of Object.entries(REFS)) if (data[k]) data[k] = (await resolve(db, kind, String(data[k]), co)).id;
  }
  const cols = Object.keys(data);
  if (!cols.length) throw Error('No fields supplied');
  const [row] = await db.query(`insert into cap.${type} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, cols.map((c) => data[c]));
  return row;
}

async function nextCode(db, table, coId, prefix) {
  const [{ n }] = await db.query(`select coalesce(max(substring(code from '\\d+$')::int), 0) + 1 n from cap.${table} where company_id = $1 and code ~ ('^' || $2 || '\\d+$')`, [coId, prefix]);
  return `${prefix}${String(n).padStart(3, '0')}`;
}
async function eventPrefix(db, coId) {
  const [r] = await db.query("select coalesce((select substring(code from '^(.*-)\\d+$') from cap.share_events where company_id = $1 order by created_at desc limit 1), 'E-') p", [coId]);
  return r.p;
}

async function issueShares(db, pos, opts) {
  allow(opts, ['class', 'shares', 'price', 'on', 'round', 'approved-on', 'certificate']); noExtra(pos, 1);
  const co = await company(db, opts);
  const s = await resolve(db, 'stakeholders', pos[0], co);
  const c = await companyOf(db, s.company_id);
  const k = await resolve(db, 'share_classes', need(opts, 'class'), c);
  const round = opts.round ? await resolve(db, 'rounds', String(opts.round), c) : null;
  return tx(db, async () => {
    const code = await nextCode(db, 'share_events', c.id, await eventPrefix(db, c.id));
    const [row] = await db.query(`insert into cap.share_events (company_id, code, stakeholder_id, class_id, kind, shares, price, on_date, round_id, certificate_no, board_approved_on)
      values ($1, $2, $3, $4, 'issue', $5, $6, coalesce($7::date, current_date), $8, $9, $10) returning code, on_date, shares, trim_scale(price) price`,
      [c.id, code, s.id, k.id, shares(need(opts, 'shares')), sharePrice(need(opts, 'price')), opts.on ? date(opts.on) : null, round ? round.id : null,
        opts.certificate || null, opts['approved-on'] ? date(opts['approved-on']) : null]);
    const [ob] = await db.query('select kind, due_on from cap.obligations where company_id = $1 and subject_ref = $2', [c.id, code]);
    return { company: c.code, holder: s.name, class: k.code, ...row, filing: ob ? `${ob.kind} due ${ob.due_on}` : '' };
  });
}

async function transfer(db, pos, opts) {
  allow(opts, ['class', 'shares', 'price', 'on', 'approved-on', 'certificate']); noExtra(pos, 2);
  const co = await company(db, opts);
  const from = await resolve(db, 'stakeholders', pos[0], co);
  const c = await companyOf(db, from.company_id);
  const to = await resolve(db, 'stakeholders', pos[1], c);
  if (from.id === to.id) throw Error('A transfer needs two different holders');
  const k = await resolve(db, 'share_classes', need(opts, 'class'), c);
  const n = shares(need(opts, 'shares'));
  return tx(db, async () => {
    const [{ held }] = await db.query('select coalesce(sum(shares), 0)::bigint held from cap.share_events where stakeholder_id = $1 and class_id = $2', [from.id, k.id]);
    if (Number(held) < n) throw Error(`${from.name} holds ${held} ${k.code} shares, not ${n}`);
    const prefix = await eventPrefix(db, c.id);
    const outCode = await nextCode(db, 'share_events', c.id, prefix);
    const inCode = `${prefix}${String(Number(outCode.slice(prefix.length)) + 1).padStart(3, '0')}`;
    const ref = `TR-${outCode}`;
    const args = [c.id, k.id, opts.price ? sharePrice(opts.price) : null, opts.on ? date(opts.on) : null, ref, opts['approved-on'] ? date(opts['approved-on']) : null];
    await db.query(`insert into cap.share_events (company_id, code, stakeholder_id, class_id, kind, shares, price, on_date, transfer_ref, board_approved_on)
      values ($1, $7, $8, $2, 'transfer_out', $9, $3, coalesce($4::date, current_date), $5, $6)`, [...args, outCode, from.id, -n]);
    await db.query(`insert into cap.share_events (company_id, code, stakeholder_id, class_id, kind, shares, price, on_date, transfer_ref, board_approved_on, certificate_no)
      values ($1, $7, $8, $2, 'transfer_in', $9, $3, coalesce($4::date, current_date), $5, $6, $10)`, [...args, inCode, to.id, n, opts.certificate || null]);
    const [ob] = await db.query('select kind, due_on from cap.obligations where company_id = $1 and subject_ref = $2', [c.id, inCode]);
    return { company: c.code, transfer: ref, from: from.name, to: to.name, class: k.code, shares: n, filing: ob ? `${ob.kind} ${inCode} due ${ob.due_on}` : 'none owed' };
  });
}

async function grantOptions(db, pos, opts) {
  allow(opts, ['plan', 'quantity', 'price', 'granted-on', 'start', 'months', 'cliff', 'every', 'expires', 'approved-on']); noExtra(pos, 1);
  const co = await company(db, opts);
  const s = await resolve(db, 'stakeholders', pos[0], co);
  const c = await companyOf(db, s.company_id);
  const p = await resolve(db, 'plans', need(opts, 'plan'), c);
  const qty = shares(need(opts, 'quantity'), '--quantity');
  const int = (k, d) => { const v = opts[k] === undefined ? d : Number(opts[k]); if (!Number.isInteger(v) || v < 0) throw Error(`--${k} must be a whole number of months`); return v; };
  return tx(db, async () => {
    const [pool] = await db.query('select available from cap.pool where plan_id = $1', [p.id]);
    if (Number(pool.available) < qty) throw Error(`${p.code} has ${pool.available} options left, not ${qty}. Top up the pool first.`);
    const code = await nextCode(db, 'grants', c.id, 'G-');
    const granted = opts['granted-on'] ? date(opts['granted-on']) : null;
    const [row] = await db.query(`insert into cap.grants (company_id, code, plan_id, stakeholder_id, granted_on, quantity, exercise_price, vesting_start, vest_months, cliff_months, vest_every_months, expires_on, board_approved_on)
      values ($1, $2, $3, $4, coalesce($5::date, current_date), $6, $7, coalesce($8::date, $5::date, current_date), $9, $10, $11, $12, $13)
      returning code, granted_on, quantity, trim_scale(exercise_price) price, vesting_start, vest_months, cliff_months, expires_on`,
      [c.id, code, p.id, s.id, granted, qty, sharePrice(need(opts, 'price')), opts.start ? date(opts.start) : null, int('months', 48), int('cliff', 12), Math.max(1, int('every', 1)),
        opts.expires ? date(opts.expires) : null, opts['approved-on'] ? date(opts['approved-on']) : null]);
    const [fmv] = await db.query('select trim_scale(cap.fmv($1, $2::date)) fmv', [p.class_id || (await db.query('select class_id from cap.plans where id = $1', [p.id]))[0].class_id, row.granted_on]);
    return { company: c.code, holder: s.name, ...row, fair_value_on_file: fmv.fmv ?? 'none: record a valuation', pool_left: Number(pool.available) - qty };
  });
}

async function exercise(db, pos, opts) {
  allow(opts, ['quantity', 'on', 'certificate']); noExtra(pos, 1);
  const g = await resolve(db, 'grants', pos[0], await company(db, opts));
  const qty = shares(need(opts, 'quantity'), '--quantity');
  return tx(db, async () => {
    const [st] = await db.query('select gs.*, p.class_id from cap.grant_status gs join cap.plans p on p.id = gs.plan_id where gs.id = $1', [g.id]);
    if (st.status !== 'active' || st.expired) throw Error(`${g.code} is ${st.status === 'active' ? 'expired' : st.status}`);
    if (Number(st.exercisable) < qty) throw Error(`${g.code} has ${st.exercisable} vested options to exercise, not ${qty}`);
    const prefix = await eventPrefix(db, st.company_id);
    const code = await nextCode(db, 'share_events', st.company_id, prefix);
    const [ev] = await db.query(`insert into cap.share_events (company_id, code, stakeholder_id, class_id, kind, shares, price, on_date, certificate_no)
      values ($1, $2, $3, $4, 'exercise', $5, $6, coalesce($7::date, current_date), $8) returning id, code, on_date`,
      [st.company_id, code, st.stakeholder_id, st.class_id, qty, st.exercise_price, opts.on ? date(opts.on) : null, opts.certificate || null]);
    await db.query('insert into cap.exercises (grant_id, share_event_id, quantity, on_date) values ($1, $2, $3, $4)', [g.id, ev.id, qty, ev.on_date]);
    const owed = await db.query('select kind, due_on from cap.obligations where company_id = $1 and subject_ref = $2 order by due_on', [st.company_id, code]);
    return { grant: g.code, holder: st.holder, exercised: qty, share_event: code, on_date: ev.on_date,
      pay_to_company: (qty * Number(st.exercise_price)).toFixed(2), filings_owed: owed.map((o) => `${o.kind} due ${o.due_on}`).join('; ') || 'none' };
  });
}

async function convert(db, pos, opts) {
  allow(opts, ['round', 'shares', 'class', 'on']); noExtra(pos, 1);
  const v = await resolve(db, 'convertibles', pos[0], await company(db, opts));
  const c = await companyOf(db, v.company_id);
  const r = await resolve(db, 'rounds', need(opts, 'round'), c);
  const k = await resolve(db, 'share_classes', need(opts, 'class'), c);
  return tx(db, async () => {
    const [cv] = await db.query("select * from cap.convertibles where id = $1 and status = 'outstanding'", [v.id]);
    if (!cv) throw Error(`${v.code} is not outstanding`);
    const code = await nextCode(db, 'share_events', c.id, await eventPrefix(db, c.id));
    const n = shares(need(opts, 'shares'));
    const [owed] = await db.query('select owed_cents from cap.convertible_status where id = $1', [v.id]);
    await db.query(`insert into cap.share_events (company_id, code, stakeholder_id, class_id, kind, shares, price, on_date, round_id, board_approved_on)
      values ($1, $2, $3, $4, 'conversion', $5, round($6::numeric / 100 / $10::numeric, 6), coalesce($7::date, current_date), $8, $9)`,
      [c.id, code, cv.stakeholder_id, k.id, n, owed.owed_cents, opts.on ? date(opts.on) : null, r.id, cv.board_approved_on, n]);
    await db.query("update cap.convertibles set status = 'converted', converted_round_id = $2 where id = $1", [v.id, r.id]);
    return { convertible: v.code, round: r.code, share_event: code, shares: n, class: k.code };
  });
}

// ------------------------------------------------------------------ modelling
// A priced round on today's fully diluted cap table. SAFEs and notes convert at the lower of
// the cap price and the discounted round price; any pool top-up and the conversions both come
// out of the pre-money, the usual term sheet. Solved by iteration, to the share.
async function roundModel(db, coId, o) {
  const raise = cents(need(o, 'raise'), '--raise') / 100;
  const pre = cents(need(o, 'pre-money'), '--pre-money') / 100;
  const poolTarget = o.pool === undefined ? null : Number(String(o.pool).replace('%', '')) / 100;
  if (poolTarget !== null && !(poolTarget >= 0 && poolTarget < 0.5)) throw Error('--pool is the post-money pool share, from 0 to 49 (per cent)');
  const rows = await db.query(READS['cap-table'], [coId]);
  const fdPre = rows.reduce((t, r) => t + Number(r.fully_diluted), 0);
  if (!fdPre) throw Error('Nothing on the cap table yet');
  const poolNow = Number(rows.find((r) => r.kind === 'pool')?.fully_diluted || 0);
  const convs = o['no-convert'] ? [] : await db.query("select code, holder, owed_cents, valuation_cap_cents, discount_pct from cap.convertible_status where company_id = $1 and status = 'outstanding'", [coId]);
  let topup = 0; let conv = convs.map(() => 0); let price = pre / fdPre; let fresh = 0;
  for (let i = 0; i < 200; i++) {
    const base = fdPre + topup + conv.reduce((a, b) => a + b, 0);
    price = pre / base;
    conv = convs.map((c) => {
      const capPrice = c.valuation_cap_cents ? Number(c.valuation_cap_cents) / 100 / base : Infinity;
      return Math.floor(Number(c.owed_cents) / 100 / Math.min(capPrice, price * (1 - Number(c.discount_pct) / 100)));
    });
    fresh = Math.floor(raise / price);
    const post = fdPre + topup + conv.reduce((a, b) => a + b, 0) + fresh;
    const want = poolTarget === null ? 0 : Math.max(0, Math.ceil(poolTarget * post - poolNow));
    if (want === topup && i > 2) break;
    topup = want;
  }
  const post = fdPre + topup + conv.reduce((a, b) => a + b, 0) + fresh;
  const pct = (n, d) => (100 * n / d).toFixed(2);
  const out = rows.map((r) => {
    const after = Number(r.fully_diluted) + (r.kind === 'pool' ? topup : 0);
    return { holder: r.name, before: Number(r.fully_diluted), before_pct: pct(Number(r.fully_diluted), fdPre), after, after_pct: pct(after, post) };
  });
  convs.forEach((c, i) => out.push({ holder: `${c.holder} (${c.code} converts)`, before: 0, before_pct: '0.00', after: conv[i], after_pct: pct(conv[i], post) }));
  out.push({ holder: o.investor ? String(o.investor) : 'New investors', before: 0, before_pct: '0.00', after: fresh, after_pct: pct(fresh, post) });
  out.push({ holder: 'Total', before: fdPre, before_pct: '100.00', after: post, after_pct: '100.00' });
  return { price_per_share: price.toFixed(4), pre_money: pre, raise, post_money: Math.round(price * post), pool_top_up: topup,
    new_shares: fresh, conversions: conv.reduce((a, b) => a + b, 0), rows: out };
}

// What each holder takes home if the company is sold for --exit. Preference classes take their
// preference by seniority or convert to ordinary when that pays more; outstanding options are
// counted when in the money, net of their exercise price. Outstanding SAFEs and notes are not
// converted here: convert them first, or model the round.
async function waterfall(db, coId, o) {
  const exit = cents(need(o, 'exit'), '--exit') / 100;
  const classes = await db.query(`select k.id, k.code, k.kind, coalesce(k.original_price, 0)::float8 original_price, k.pref_multiple::float8 pref_multiple, k.participating, k.seniority,
    coalesce((select sum(shares) from cap.holdings h where h.class_id = k.id), 0)::float8 shares from cap.share_classes k where k.company_id = $1`, [coId]);
  const holders = await db.query(`select s.id, s.name, h.class_id, h.shares::float8 shares from cap.holdings h join cap.stakeholders s on s.id = h.stakeholder_id
    where h.company_id = $1 and h.shares > 0`, [coId]);
  const options = await db.query(`select stakeholder_id, holder, outstanding::float8 n, exercise_price::float8 strike from cap.grant_status where company_id = $1 and outstanding > 0`, [coId]);
  const pref = classes.filter((k) => k.kind === 'preference' && k.pref_multiple > 0).sort((a, b) => b.seniority - a.seniority);
  const converted = new Set();
  let paid = {}; let perShare = 0; let itm = [];
  for (let round = 0; round < 20; round++) {
    paid = {}; let left = exit;
    for (const k of pref) {
      if (converted.has(k.id)) continue;
      const take = Math.min(left, k.shares * k.original_price * k.pref_multiple); paid[k.id] = take; left -= take;
    }
    const commonShares = classes.filter((k) => k.kind === 'ordinary' || converted.has(k.id) || k.participating).reduce((t, k) => t + k.shares, 0);
    itm = options.slice();
    for (let j = 0; j < 20; j++) {
      const n = commonShares + itm.reduce((t, x) => t + x.n, 0);
      perShare = n ? (left + itm.reduce((t, x) => t + x.n * x.strike, 0)) / n : 0;
      const next = options.filter((x) => x.strike < perShare);
      if (next.length === itm.length) break;
      itm = next;
    }
    const flip = pref.filter((k) => !converted.has(k.id) && !k.participating && perShare * k.shares > paid[k.id]);
    if (!flip.length) break;
    converted.add(flip[0].id);
  }
  const byHolder = new Map();
  const addTo = (name, v) => byHolder.set(name, (byHolder.get(name) || 0) + v);
  for (const h of holders) {
    const k = classes.find((c) => c.id === h.class_id);
    const fromPref = k.kind === 'preference' && !converted.has(k.id) ? (paid[k.id] || 0) * h.shares / k.shares : 0;
    const common = (k.kind === 'ordinary' || converted.has(k.id) || k.participating) ? perShare * h.shares : 0;
    addTo(h.name, fromPref + common);
  }
  for (const x of itm) addTo(x.holder, (perShare - x.strike) * x.n);
  const rows = [...byHolder.entries()].map(([holder, v]) => ({ holder, takes_home: Math.round(v), pct_of_exit: (100 * v / exit).toFixed(2) }))
    .sort((a, b) => b.takes_home - a.takes_home);
  const convertibles = (await db.query("select count(*)::int n from cap.convertibles where company_id = $1 and status = 'outstanding'", [coId]))[0].n;
  return { exit, per_ordinary_share: perShare.toFixed(4),
    preference: pref.map((k) => `${k.code}: ${converted.has(k.id) ? 'converts to ordinary' : `takes ${Math.round(paid[k.id] || 0)} preference`}`).join('; ') || 'none',
    options_in_the_money: itm.reduce((t, x) => t + x.n, 0), note: convertibles ? `${convertibles} SAFE or note outstanding and not converted in this run` : '', rows };
}

// ------------------------------------------------------------------ imports
// Carta: the securities ledger report saved as CSV (Cap table report > Securities ledger by type and class),
// or a vesting report for option grants. Column names vary with the columns chosen in Carta, so each
// field accepts several names. Every row lands in one transaction: a clash stops the whole file.
const CARTA = {
  holder: ['Stakeholder Name', 'Stakeholder', 'Holder Name', 'Name', 'Shareholder'],
  email: ['Stakeholder Email', 'Email', 'Email Address'],
  security: ['Security ID', 'Security', 'Grant ID', 'Certificate ID', 'Label', 'ID'],
  type: ['Security Type', 'Type', 'Grant Type', 'Interest Type'],
  class: ['Share Class', 'Class', 'Stock Class', 'Share Class Name'],
  plan: ['Equity Plan', 'Plan', 'Option Plan'],
  quantity: ['Quantity', 'Shares', 'Quantity Issued', 'Options Granted', 'Granted', 'Number of Shares'],
  price: ['Price Per Share', 'Price', 'Issue Price', 'Cost Per Share', 'Exercise Price', 'Strike Price'],
  date: ['Issue Date', 'Grant Date', 'Date', 'Issued On'],
  start: ['Vesting Start Date', 'Vesting Commencement Date', 'Vest Start'],
  months: ['Vesting Period (Months)', 'Vesting Months', 'Total Vesting Months'],
  cliff: ['Cliff (Months)', 'Cliff Months', 'Cliff'],
  expires: ['Expiration Date', 'Expiry Date', 'Expires'],
  exercised: ['Exercised', 'Options Exercised', 'Exercised Quantity'],
  cancelled: ['Cancelled', 'Forfeited', 'Cancelled Quantity'],
  relationship: ['Relationship', 'Stakeholder Relationship', 'Stakeholder Type'],
};
const dateIn = (v, label) => {
  const s = String(v || '').trim(); if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return date(s);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return date(`${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`); // Carta exports US dates (month first)
  throw Error(`${label}: cannot read date "${s}". Use YYYY-MM-DD or MM/DD/YYYY.`);
};
export function mapCartaRow(row, line) {
  const get = (k) => pick(row, ...CARTA[k]).trim();
  const holder = get('holder'); const security = get('security');
  if (!holder || !security) throw Error(`Row ${line}: stakeholder name and security ID are required`);
  const type = get('type').toLowerCase();
  const isOption = /option|iso|nso|esop|rsu|grant/.test(type) || (!!get('plan') && !get('class'));
  const qty = shares(get('quantity').replace(/\.0+$/, ''), `Row ${line} quantity`);
  const price = get('price') ? sharePrice(get('price'), `Row ${line} price`) : '0';
  const rel = get('relationship').toLowerCase();
  const kind = /founder/.test(rel) ? 'founder' : /employee/.test(rel) ? 'employee' : /advis/.test(rel) ? 'advisor' : /contract|consult/.test(rel) ? 'contractor' : /trust/.test(rel) ? 'trust' : isOption ? 'employee' : 'investor';
  return { holder, email: get('email') || null, security, isOption, className: get('class') || null, plan: get('plan') || null, quantity: qty, price,
    on: dateIn(get('date'), `Row ${line} date`), start: dateIn(get('start'), `Row ${line} vesting start`), months: get('months') ? Number(get('months')) : 48,
    cliff: get('cliff') ? Number(get('cliff')) : 12, expires: dateIn(get('expires'), `Row ${line} expiry`), exercised: Number(get('exercised') || 0),
    cancelled: Number(get('cancelled') || 0), kind, is_employee: ['founder', 'employee'].includes(kind) };
}
async function importCsv(db, pos, opts) {
  allow(opts, ['file', 'dry-run']); noExtra(pos, 1);
  const source = oneOf(pos[0] || '', ['carta', 'stakeholders'], 'import source');
  const co = await company(db, opts, true);
  const c = await companyOf(db, co.id);
  const file = need(opts, 'file');
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  const dryRun = !!opts['dry-run'];
  return tx(db, async () => {
    const result = { company: c.code, source, rows: rows.length, inserted: 0, skipped_identical: 0, stakeholders_added: 0, dry_run: dryRun };
    const holderId = async (name, email, kind, isEmployee) => {
      const found = await db.query('select id from cap.stakeholders where company_id = $1 and (lower(name) = lower($2) or ($3::text is not null and lower(email) = lower($3)))', [c.id, name, email]);
      if (found.length) return found[0].id;
      const code = await nextCode(db, 'stakeholders', c.id, 'S-');
      const [r] = await db.query(`insert into cap.stakeholders (company_id, code, name, kind, is_employee, email, tax_residence) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [c.id, code, name, kind, isEmployee, email, c.jurisdiction]);
      result.stakeholders_added++;
      return r.id;
    };
    for (let i = 0; i < rows.length; i++) {
      const hash = crypto.createHash('sha256').update(`${c.id}:${source}:${JSON.stringify(rows[i])}`).digest('hex');
      if ((await db.query('select 1 from cap.import_rows where source = $1 and row_hash = $2', [source, hash])).length) { result.skipped_identical++; continue; }
      let id;
      if (source === 'stakeholders') {
        const name = pick(rows[i], 'Name', 'Stakeholder Name', 'Stakeholder').trim();
        if (!name) throw Error(`Row ${i + 2}: name is required`);
        const email = pick(rows[i], 'Email', 'Stakeholder Email').trim() || null;
        id = await holderId(name, email, 'investor', false);
        const address = pick(rows[i], 'Address', 'Mailing Address', 'Residential Address').trim();
        if (address) await db.query('update cap.stakeholders set address = $2 where id = $1', [id, address]);
      } else {
        const m = mapCartaRow(rows[i], i + 2);
        if ((await db.query('select 1 from cap.share_events where company_id = $1 and code = $2 union all select 1 from cap.grants where company_id = $1 and code = $2', [c.id, m.security])).length)
          throw Error(`Row ${i + 2}: ${m.security} already exists in ${c.code}. Nothing was imported.`);
        const sid = await holderId(m.holder, m.email, m.kind, m.is_employee);
        if (m.isOption) {
          const plan = await db.query('select id from cap.plans where company_id = $1 and (lower(code) = lower($2) or lower(name) = lower($2))', [c.id, m.plan || '']);
          if (!plan.length) throw Error(`Row ${i + 2}: no plan "${m.plan || '(blank)'}" in ${c.code}. Add the plan first.`);
          if (!m.on) throw Error(`Row ${i + 2}: grant date is required`);
          const [g] = await db.query(`insert into cap.grants (company_id, code, plan_id, stakeholder_id, granted_on, quantity, exercise_price, vesting_start, vest_months, cliff_months, expires_on, board_approved_on)
            values ($1, $2, $3, $4, $5, $6, $7, coalesce($8::date, $5::date), $9, $10, $11, $5) returning id`,
            [c.id, m.security, plan[0].id, sid, m.on, m.quantity, m.price, m.start, m.months, m.cliff, m.expires]);
          id = g.id;
          if (m.cancelled > 0 && m.cancelled >= m.quantity - m.exercised) await db.query("update cap.grants set status = 'cancelled', cancelled_on = $2 where id = $1", [id, m.on]);
          if (m.exercised > 0) result.exercised_to_check = (result.exercised_to_check || 0) + 1;
        } else {
          const cls = await db.query('select id from cap.share_classes where company_id = $1 and (lower(code) = lower($2) or lower(name) = lower($2))', [c.id, m.className || '']);
          if (!cls.length) throw Error(`Row ${i + 2}: no share class "${m.className || '(blank)'}" in ${c.code}. Add the class first.`);
          if (!m.on) throw Error(`Row ${i + 2}: issue date is required`);
          const [e] = await db.query(`insert into cap.share_events (company_id, code, stakeholder_id, class_id, kind, shares, price, on_date, certificate_no, board_approved_on)
            values ($1, $2, $3, $4, 'issue', $5, $6, $7, $2, $7) returning id`, [c.id, m.security, sid, cls[0].id, m.quantity, m.price, m.on]);
          id = e.id;
          // Historic issues were notified under the old system; record them so they do not show as overdue.
          await db.query(`insert into cap.filings (company_id, kind, subject_ref, filed_on, reference, filed_by) values ($1, $2, $3, $4, 'Before import', 'import')
            on conflict do nothing`, [c.id, c.jurisdiction === 'NZ' ? 'nz-share-issue' : 'au-form-484', m.security, m.on]);
        }
      }
      result.inserted++;
      await db.query('insert into cap.import_rows (source, file_name, row_number, row_hash, target_id) values ($1, $2, $3, $4, $5)', [source, path.basename(file), i + 2, hash, id]);
    }
    return result;
  }, { dryRun });
}

// ------------------------------------------------------------------ drafts (never sent)
function draftsDir() { const d = path.resolve(process.env.OUTPUT_DIR || REPO_ROOT, 'drafts'); fs.mkdirSync(d, { recursive: true }); return d; }
function md(rows) {
  if (!rows.length) return '_None._\n';
  const keys = Object.keys(rows[0]);
  return [`| ${keys.join(' | ')} |`, `| ${keys.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${keys.map((k) => String(r[k] ?? '').replace(/\|/g, '/')).join(' | ')} |`)].join('\n') + '\n';
}
const today = async (db) => (await db.query('select current_date::text d'))[0].d;
async function draftWeekly(db, co) {
  const id = co ? co.id : null; const d = await today(db);
  const body = [`# Share register review, week of ${d}${co ? `: ${co.name}` : ''}`, '',
    'Draft. Figures come from the register at the time of writing. Nothing has been sent or lodged.', '',
    '## What needs attention', md(await attention(db, id)),
    '## Filings open', md((await db.query(READS.filings, [id])).filter((r) => !r.state.startsWith('filed'))),
    '## Vesting in the next 30 days', md(await OPTION_READS.vesting.run(db, id, { days: 30 })),
    '## Leavers', md(await db.query(READS.leavers, [id])),
    '## Option pools', md(await db.query(READS.pool, [id])),
    '## Rule checks', md(await db.query(READS.compliance, [id]))].join('\n');
  const file = path.join(draftsDir(), `weekly-review-${co ? co.code + '-' : ''}${d}.md`);
  fs.writeFileSync(file, body);
  return { draft: file, sections: 6 };
}
async function draftLeaverLetter(db, s) {
  const rows = await db.query(`select g.code, g.quantity, g.vested, g.exercised, g.exercisable, g.quantity - g.vested returned, trim_scale(g.exercise_price) price, g.window_ends_on, g.ended_on, c.name company, c.currency
    from cap.grant_status g join cap.companies c on c.id = g.company_id where g.stakeholder_id = $1 and g.status = 'active'`, [s.id]);
  if (!rows.length) throw Error(`${s.name} has no active option grants`);
  if (!rows[0].ended_on) throw Error(`${s.name} has no leaving date. Record it first: leave "${s.name}" --on=YYYY-MM-DD`);
  const first = String(s.name).split(' ')[0];
  const body = [`Hi ${first},`, '',
    `As you leave ${rows[0].company} on ${rows[0].ended_on}, here is where your share options stand.`, '',
    md(rows.map((r) => ({ grant: r.code, granted: r.quantity, vested: r.vested, exercised: r.exercised, can_exercise: r.exercisable, lapse_unvested: r.returned, exercise_price: `${r.currency} ${r.price}` }))),
    ...rows.filter((r) => Number(r.exercisable) > 0).map((r) => `To keep the ${r.exercisable} vested options on ${r.code}, exercise them by ${r.window_ends_on}. The cost is ${r.currency} ${(Number(r.exercisable) * Number(r.price)).toFixed(2)}. After that date they lapse.`),
    '', 'Unvested options lapse on your leaving date under the plan rules.', '',
    'Reply to this email if you want to exercise, and we will send the exercise notice and payment details.', ''].join('\n');
  const [{ code }] = await db.query('select code from cap.stakeholders where id = $1', [s.id]);
  const file = path.join(draftsDir(), `leaver-letter-${code}-${await today(db)}.md`);
  fs.writeFileSync(file, body);
  return { draft: file, grants: rows.length };
}
async function draftFilings(db, co) {
  const open = (await db.query(READS.filings, [co ? co.id : null])).filter((r) => r.state === 'OVERDUE' || r.state === 'due soon');
  const body = [`# Filings to lodge, ${await today(db)}`, '', 'Draft for whoever lodges with the Companies Office, ASIC, the ATO or Inland Revenue. Nothing has been lodged.', '',
    md(open.map((r) => ({ company: r.company, filing: r.kind, subject: r.subject, due: r.due_on, state: r.state, what: r.detail }))), '',
    'Once lodged, record each one: npm run cap -- record-filing --company=<code> --kind=<filing> --subject=<subject> --on=<date> --reference=<ref>', ''].join('\n');
  const file = path.join(draftsDir(), `filings-${co ? co.code + '-' : ''}${await today(db)}.md`);
  fs.writeFileSync(file, body);
  return { draft: file, filings: open.length };
}

// ------------------------------------------------------------------ main
const plain = (v) => (v instanceof Date ? v.toISOString().slice(0, 16).replace('T', ' ') : v);
function print(out) {
  if (Array.isArray(out)) {
    if (!out.length) return console.log('  (none)');
    out = out.map((r) => (r && typeof r === 'object' ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)])) : r));
    const keys = Object.keys(out[0]);
    return console.log(table(out, keys.map((k) => ({ key: k, label: k.replace(/_/g, ' '), width: 70,
      align: typeof out[0][k] === 'number' || /^-?\d+(\.\d+)?$/.test(String(out[0][k] ?? '')) ? 'right' : 'left' }))));
  }
  if (out && typeof out === 'object') {
    for (const [k, v] of Object.entries(out)) {
      if (Array.isArray(v) && v.length && typeof v[0] === 'object') { console.log(`\n${k.replace(/_/g, ' ')}`); print(v); }
      else if (Array.isArray(v) && !v.length) console.log(`\n${k.replace(/_/g, ' ')}\n  (none)`);
      else if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) { console.log(`\n${k.replace(/_/g, ' ')}`); for (const [k2, v2] of Object.entries(v)) console.log(`  ${k2.replace(/_/g, ' ')}: ${v2 ?? ''}`); }
      else console.log(`${k.replace(/_/g, ' ')}: ${Array.isArray(v) ? v.join(', ') : v ?? ''}`);
    }
  }
}
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const db = await getDb();
  try {
    const out = await run(db, args.filter((a) => a !== '--json'));
    if (json) console.log(JSON.stringify(out, null, 2)); else print(out);
  } catch (e) {
    console.error(e.message); process.exitCode = 1;
  } finally { await db.close(); }
}
