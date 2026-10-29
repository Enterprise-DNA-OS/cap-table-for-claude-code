// npm test: a temporary database, every command, the rules and the edge cases. Never touches a live database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { migrate } from './migrate.mjs';
import { seed } from './seed.mjs';
import { run, READS, TABLES, date, cents, shares, sharePrice, mapCartaRow } from './cap.mjs';
import { parseCsv } from './lib/csv.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-test-'));
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || '';
process.env.DATA_DIR = path.join(temp, 'db');
process.env.OUTPUT_DIR = temp;
let db; let checks = 0;
const ok = (v, msg) => { assert.ok(v, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const rejects = async (fn, re) => { await assert.rejects(fn, re); checks++; };
const file = (name, v) => { const f = path.join(temp, `${name}.json`); fs.writeFileSync(f, JSON.stringify(v)); return `--data=${f}`; };
function cli(script, args = []) {
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', script), ...args], { cwd: REPO_ROOT, env: process.env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout); checks++;
  return r.stdout;
}
const one = async (sql, p = []) => (await db.query(sql, p))[0];
const grant = (co, code) => one('select * from cap.grant_status where company = $1 and code = $2', [co, code]);
const K = '--company=KWR'; const H = '--company=HBL';

try {
  db = await getDb();
  await migrate(db);
  eq((await migrate(db)).ran.length, 0, 'repeat migration is a no-op');
  await seed(db); await seed(db);
  eq((await run(db, ['companies'])).length, 2, 'two companies');
  eq((await run(db, ['cap-table', K])).length, 12, 'seed is idempotent: 11 holders and the pool');
  eq((await one('select count(*)::int n from cap.notes')).n, 2, 'notes seeded once');

  // Every read runs, with and without a company.
  for (const c of Object.keys(READS)) { ok(Array.isArray(await run(db, [c])), c); ok(Array.isArray(await run(db, [c, H])), `${c} HBL`); }
  const help = await run(db, ['help']);
  eq(help.reads.length, Object.keys(READS).length + 4, 'help lists every read');

  // The cap table adds up.
  const kc = await one("select sum(issued)::bigint issued, sum(fully_diluted)::bigint fd, round(sum(fd_pct), 0) pct from cap.cap_table where company = 'KWR'");
  eq(Number(kc.issued), 10140000, 'KWR issued shares');
  eq(Number(kc.fd), 11100000, 'KWR fully diluted = shares + options + pool');
  eq(Number(kc.pct), 100, 'percentages add to 100');
  eq(Number((await one("select ordinary from cap.cap_table where company = 'KWR' and code = 'F2'")).ordinary), 3800000, 'transfer out reduces the holder');

  // Vesting, worked by hand: monthly after a 12-month cliff, stopping on the leaving date.
  const g1 = await grant('KWR', 'G-01');
  eq(Number(g1.vested), 65000, '26 of 48 months of 120,000');
  eq(Number(g1.exercisable), 25000, 'vested less the 40,000 exercised');
  eq(Number(g1.outstanding), 80000, 'outstanding after exercise');
  eq(Number((await grant('KWR', 'G-02')).vested), 29166, 'leaver vests 14 months, then stops');
  eq(Number((await grant('KWR', 'G-02')).unvested), 0, 'a leaver has nothing unvested');
  eq(Number((await grant('KWR', 'G-03')).outstanding), 28333, 'leaver keeps only vested');
  eq(Number((await grant('KWR', 'G-04')).vested), 0, 'nothing vests before the cliff');
  eq(Number((await grant('KWR', 'G-05')).vested), 10000, 'quarterly vesting with no cliff');
  eq(Number((await grant('HBL', 'G-01')).vested), 53125, 'HBL 17 of 48 months');
  const pool = await one("select * from cap.pool where company = 'KWR'");
  eq(Number(pool.available), 1000000 - Number(pool.outstanding) - Number(pool.exercised), 'pool available');
  eq(Number(pool.returned), 51667 + 70834, 'unvested leaver options return to the pool');
  const ve = await run(db, ['vesting', '--days=40', K]);
  ok(ve.some((r) => r.holder === 'Mere Tipene' && r.cliff === 'CLIFF' && Number(r.quantity) === 15000), 'cliff of 12/48 shows');
  ok(!ve.some((r) => r.holder === 'Josh Kim'), 'leavers do not vest');
  eq((await one("select sum(quantity)::int n from cap.vest_events where company = 'KWR' and grant_code = 'G-04'")).n, 60000, 'schedule adds to the grant');
  await rejects(() => run(db, ['vesting', '--days=0']), /whole number/);

  // Filings: what is owed, and when.
  const ob = async (co, kind, subj) => one('select * from cap.obligations where company = $1 and kind = $2 and subject_ref = $3', [co, kind, subj]);
  eq((await ob('KWR', 'nz-share-issue', 'K-008')).state, 'OVERDUE', 'NZ exercise not notified in 10 working days');
  eq((await ob('KWR', 'nz-ess-income', 'K-008')).state, 'OVERDUE', 'NZ ESS income not reported');
  ok((await ob('KWR', 'nz-ess-income', 'K-008')).detail.includes('benefit about 20000'), 'ESS benefit from the valuation on file');
  eq((await ob('HBL', 'au-form-484', 'H-006')).state, 'OVERDUE', 'AU proprietary transfer not notified in 28 days');
  const h7 = await ob('HBL', 'au-form-484', 'H-007');
  ok(h7.state === 'due soon' && h7.days_left === 5, 'AU issue due in 5 days');
  eq((await ob('KWR', 'nz-share-issue', 'K-005')), undefined, 'NZ transfers owe no issue notice');
  const fy = await one("select subject_ref from cap.obligations where company = 'HBL' and kind = 'au-ess-statement' and state = 'filed'");
  eq((await ob('HBL', 'au-ess-report', fy.subject_ref)).state, 'OVERDUE', 'ESS annual report missing for the year the statement went out');
  eq((await one("select cap.add_working_days('2026-10-23', 10)::text d")).d, '2026-11-06', 'ten working days skips weekends');

  const rules = new Set((await run(db, ['compliance'])).map((r) => r.rule));
  for (const r of ['nz-share-issue-notice', 'nz-ess-income', 'au-share-change-notice', 'au-ess-report', 'register-address', 'option-register-details', 'board-approval', 'convertible-matured'])
    ok(rules.has(r), `rule ${r} found`);
  ok(!rules.has('ledger-negative') && !rules.has('transfer-unbalanced') && !rules.has('pool-overgranted'), 'clean ledger');
  const att = await run(db, ['attention']);
  for (const a of ['filings', 'rules', 'leavers', 'vesting']) ok(att.some((i) => i.area === a), `attention covers ${a}`);
  ok(att.some((i) => i.area === 'leavers' && i.item.startsWith('Josh Kim')), 'Josh window closing');
  ok(!att.some((i) => i.area === 'leavers' && i.item.startsWith("Liam")), 'Liam has 40 days, not urgent');

  // Lookups: codes clash across companies; --company, names and partial ids settle it.
  await rejects(() => run(db, ['grant', 'G-01']), /Ambiguous grants.*KWR G-01.*HBL G-01/);
  eq((await run(db, ['grant', 'G-01', K])).grant.holder, 'Priya Shah', 'grant within a company');
  eq((await run(db, ['stakeholder', 'priya shah'])).stakeholder.code, 'E1', 'case-insensitive name');
  const pid = (await one("select id from cap.stakeholders where code = 'E4' and company_id = cap.company_id('KWR')")).id;
  eq((await run(db, ['stakeholder', pid.slice(0, 8)])).stakeholder.name, 'Josh Kim', 'partial id');
  await rejects(() => run(db, ['stakeholder', 'nobody']), /No stakeholders/);
  await rejects(() => run(db, ['cap-table', '--typo']), /Unknown option/);
  await rejects(() => run(db, ['cap-table', 'extra']), /Unexpected/);
  await rejects(() => run(db, ['nonsense']), /Unknown command/);
  await rejects(() => run(db, ['round-model', '--raise=1', '--pre-money=1']), /Name the company/);
  eq((await run(db, ['company', 'harbourline'])).company.code, 'HBL', 'company by name');
  eq((await run(db, ['grant', 'G-01', K])).schedule.length, 37, 'cliff plus 36 monthly vests');
  assert.throws(() => date('2026-02-30')); checks++;
  eq(cents('$150,000'), 15000000, 'amount with symbol'); eq(shares('1,250,000'), 1250000, 'shares with commas');
  eq(sharePrice('$0.0125'), '0.0125', 'fractional share price');
  assert.throws(() => shares('10.5')); checks++;
  assert.throws(() => sharePrice('1.1234567')); checks++;
  ok(parseCsv('﻿A,B\r\n"a,b","line\nwith ""quotes"""')[0].B === 'line\nwith "quotes"', 'CSV quoting');

  // Round model: the round price times the pre-round shares is the pre-money; the pool hits its target.
  const rm = await run(db, ['round-model', K, '--raise=4,000,000', '--pre-money=16000000', '--pool=10']);
  const rows = rm.rows.filter((r) => r.holder !== 'Total');
  eq(rows.reduce((t, r) => t + r.after, 0), rm.rows.at(-1).after, 'post-round shares add up');
  ok(Math.abs(Number(rm.price_per_share) * (rm.rows.at(-1).after - rm.new_shares) - 16000000) < 16000000 * 0.0005, 'price x pre-round shares = pre-money');
  eq(rows.find((r) => r.holder.startsWith('Unallocated pool')).after_pct, '10.00', 'pool topped up to 10% post');
  ok(rows.some((r) => r.holder.includes('SAFE-1 converts') && r.after > 0), 'SAFE converts');
  const safe = rows.find((r) => r.holder.includes('SAFE-1'));
  const base = rm.rows.at(-1).after - rm.new_shares;
  const expectSafe = 150000 / Math.min(15000000 / base, Number(rm.price_per_share) * 0.8);
  ok(Math.abs(safe.after - expectSafe) / expectSafe < 0.0005, 'SAFE converts at the better of cap and discount');
  const plain = await run(db, ['round-model', K, '--raise=4000000', '--pre-money=16000000', '--no-convert']);
  eq(plain.conversions, 0, 'no conversion when told'); eq(plain.pool_top_up, 0, 'no pool target, no top-up');
  await rejects(() => run(db, ['round-model', K, '--raise=1', '--pre-money=1', '--pool=60']), /--pool/);

  // Waterfall: preference at a low exit, conversion at a high one, and every dollar accounted for.
  const low = await run(db, ['waterfall', K, '--exit=3000000']);
  eq(low.rows.find((r) => r.holder === 'Tasman Ventures Fund II LP').takes_home, 1500000, 'Series A takes 1x back at a low exit');
  ok(Math.abs(low.rows.reduce((t, r) => t + r.takes_home, 0) - 3000000) <= low.rows.length, 'low exit fully paid out');
  const high = await run(db, ['waterfall', K, '--exit=20000000']);
  ok(high.preference.includes('converts'), 'Series A converts at a high exit');
  ok(Math.abs(high.rows.reduce((t, r) => t + r.takes_home, 0) - 20000000) <= high.rows.length + 1, 'high exit fully paid out');
  eq(high.options_in_the_money, 267499, 'every option in the money at a high exit');
  ok(high.note.includes('2 SAFE'), 'unconverted SAFEs flagged');

  // Writes. An issue owes a notice; recording it clears the finding.
  const is = await run(db, ['issue-shares', 'Hannah Reid', K, '--class=ORD', '--shares=10,000', '--price=0.95', '--approved-on=2026-01-05']);
  ok(is.code === 'K-009' && is.filing.startsWith('nz-share-issue due'), 'issue numbered and the notice owed');
  await rejects(() => run(db, ['issue-shares', 'Hannah Reid', K, '--class=XX', '--shares=1', '--price=1']), /No share classes/);
  await rejects(() => run(db, ['record-filing', K, '--kind=nz-share-issue', '--subject=K-999', '--on=2026-01-01']), /Nothing owed/);
  await rejects(() => run(db, ['record-filing', K, '--kind=fax', '--subject=K-008', '--on=2026-01-01']), /--kind/);
  const rf = await run(db, ['record-filing', K, '--kind=nz-share-issue', '--subject=K-008', '--on=2026-10-28', '--reference=Companies Office']);
  eq(rf.late, true, 'late filing recorded as late');
  await rejects(() => run(db, ['record-filing', K, '--kind=nz-share-issue', '--subject=K-008', '--on=2026-10-28']), /already recorded/);
  ok(!(await run(db, ['compliance', K])).some((r) => r.rule === 'nz-share-issue-notice' && r.subject === 'K-008'), 'filing clears the finding');

  const tr = await run(db, ['transfer', 'Grace Liu', 'Wattle Seed', H, '--class=ORD', '--shares=10000', '--price=1.10']);
  ok(tr.filing.startsWith('au-form-484'), 'AU proprietary transfer owes a 484');
  await rejects(() => run(db, ['transfer', 'Grace Liu', 'Wattle Seed', H, '--class=ORD', '--shares=999999']), /holds 90000/);
  await rejects(() => run(db, ['transfer', 'Grace Liu', 'Grace Liu', H, '--class=ORD', '--shares=1']), /two different/);
  ok(!(await run(db, ['compliance', H])).some((r) => r.rule === 'transfer-unbalanced'), 'transfer balances');

  const gr = await run(db, ['grant-options', 'Mere Tipene', K, '--plan=ESOP', '--quantity=5000', '--price=0.95', '--approved-on=2026-10-01']);
  eq(gr.code, 'G-007', 'grant numbered'); eq(gr.fair_value_on_file, '0.95', 'valuation shown at grant');
  await rejects(() => run(db, ['grant-options', 'Mere Tipene', K, '--plan=ESOP', '--quantity=900000', '--price=0.95']), /options left/);
  await rejects(() => run(db, ['grant-options', 'Mere Tipene', K, '--plan=ESOP', '--quantity=1', '--price=1', '--cliff=x']), /whole number/);

  await rejects(() => run(db, ['exercise', 'G-01', K, '--quantity=30000']), /25000 vested/);
  await rejects(() => run(db, ['exercise', 'G-04', K, '--quantity=1']), /0 vested/);
  const ex = await run(db, ['exercise', 'G-03', K, '--quantity=28333', '--certificate=C7']);
  ok(ex.filings_owed.includes('nz-share-issue') && ex.filings_owed.includes('nz-ess-income'), 'NZ exercise owes the notice and ESS income');
  eq(ex.pay_to_company, '12749.85', 'exercise cost');
  eq(Number((await grant('KWR', 'G-03')).outstanding), 0, 'leaver fully exercised');
  ok(!(await run(db, ['attention', K])).some((i) => i.area === 'leavers' && i.item.startsWith('Josh')), 'exercised leaver drops out of attention');

  const before = Number((await one("select available from cap.pool where company = 'KWR'")).available);
  const lv = await run(db, ['leave', 'Mere Tipene', K, '--on=2026-10-29']);
  eq(lv.grants.length, 2, 'leaving shows each grant');
  await rejects(() => run(db, ['leave', 'Mere Tipene', K, '--on=2026-10-29']), /already has a leaving date/);
  eq(Number((await one("select available from cap.pool where company = 'KWR'")).available), before + 65000, 'leaving before the cliff returns everything');
  const cg = await run(db, ['cancel-grant', 'G-06', K]);
  eq(Number(cg.back_to_pool), 50000, 'cancelled grant returns to pool');
  await rejects(() => run(db, ['cancel-grant', 'G-06', K]), /already cancelled/);
  ok(!(await run(db, ['compliance', K])).some((r) => r.rule === 'board-approval' && r.subject.startsWith('G-06')), 'cancelled grant needs no approval');

  eq((await run(db, ['approve', 'K-009', K, '--on=2026-10-01'])).kind, 'event', 'approve a share event');
  await rejects(() => run(db, ['approve', 'G-01', '--on=2026-10-01']), /Ambiguous/);
  const cv = await run(db, ['convert', 'SAFE-1', K, '--round=A', '--class=SA', '--shares=125000']);
  eq(cv.shares, 125000, 'SAFE converted');
  eq((await one("select status from cap.convertibles where code = 'SAFE-1'")).status, 'converted', 'SAFE closed');
  await rejects(() => run(db, ['convert', 'SAFE-1', K, '--round=A', '--class=SA', '--shares=1']), /not outstanding/);
  eq((await run(db, ['record-valuation', K, '--class=ORD', '--price=1.10', '--method=Board estimate', '--on=2026-10-28'])).price, '1.1', 'valuation recorded');

  // The 50 non-employee shareholder limit for an Australian proprietary company.
  for (let i = 1; i <= 44; i++) {
    await run(db, ['add', 'stakeholders', H, file(`h${i}`, { code: `X${i}`, name: `Investor ${i}`, kind: 'investor', address: `${i} George Street, Sydney NSW 2000` })]);
    await run(db, ['issue-shares', `X${i}`, H, '--class=ORD', '--shares=100', '--price=1', '--approved-on=2026-10-01']);
  }
  ok((await run(db, ['compliance', H])).some((r) => r.rule === 'au-50-non-employee' && r.severity === 'near limit'), 'near the 50 limit');
  for (let i = 45; i <= 48; i++) {
    await run(db, ['add', 'stakeholders', H, file(`h${i}`, { code: `X${i}`, name: `Investor ${i}`, kind: 'investor', address: 'Sydney' })]);
    await run(db, ['issue-shares', `X${i}`, H, '--class=ORD', '--shares=100', '--price=1', '--approved-on=2026-10-01']);
  }
  ok((await run(db, ['compliance', H])).some((r) => r.rule === 'au-50-non-employee' && r.severity === 'breached'), 'over the limit');
  await rejects(() => run(db, ['add', 'stakeholders', H, file('bad', { code: 'Y1', name: 'x', kind: 'alien' })]), /check/);
  await rejects(() => run(db, ['add', 'stakeholders', H, file('bad2', { code: 'Y1', bogus: 1 })]), /Unknown field/);

  const note = await run(db, ['log', 'stakeholder', 'Josh Kim', K, '--author=Aroha Ngata', '--text=Exercised in full.']);
  eq(note.logged, 'KWR E4', 'note logged');
  await rejects(() => db.query("update cap.notes set body = 'changed'"), /append-only/);

  // Imports: dry run rolls back, a repeat skips, a clash stops the whole file.
  const ledger = path.join(REPO_ROOT, 'examples', 'carta-securities-ledger.csv');
  const dry = await run(db, ['import', 'carta', K, `--file=${ledger}`, '--dry-run']);
  eq(dry.inserted, 3, 'dry run counts rows');
  eq((await one("select count(*)::int n from cap.stakeholders where name = 'Nadia Petrov'")).n, 0, 'dry run rolled back');
  await rejects(() => run(db, ['import', 'carta', `--file=${ledger}`]), /Name the company/);
  const imp = await run(db, ['import', 'carta', K, `--file=${ledger}`]);
  ok(imp.inserted === 3 && imp.stakeholders_added === 2, 'shares, preference and an option grant imported; Tasman matched by name');
  eq((await run(db, ['import', 'carta', K, `--file=${ledger}`])).skipped_identical, 3, 'repeat import skips');
  eq((await one("select on_date::text d from cap.share_events where code = 'CS-101'")).d, '2026-03-14', 'US date read month first');
  eq((await one("select state from cap.obligations where subject_ref = 'CS-101'")).state, 'filed', 'historic issues not shown as overdue');
  eq(Number((await one("select quantity from cap.grants where code = 'ES-301'")).quantity), 30000, 'option grant imported');
  const clash = path.join(temp, 'clash.csv');
  fs.writeFileSync(clash, 'Stakeholder Name,Security ID,Security Type,Share Class,Quantity,Price Per Share,Issue Date\nNew Person,CS-900,Common,ORD,10,1,2026-01-01\nAnother,CS-101,Common,ORD,10,1,2026-01-01\n');
  await rejects(() => run(db, ['import', 'carta', K, `--file=${clash}`]), /already exists/);
  eq((await one("select count(*)::int n from cap.stakeholders where name = 'New Person'")).n, 0, 'clash stopped the whole import');
  const noPlan = path.join(temp, 'noplan.csv');
  fs.writeFileSync(noPlan, 'Stakeholder Name,Security ID,Security Type,Equity Plan,Quantity,Exercise Price,Grant Date\nX,ES-999,Option,Mystery Plan,10,1,2026-01-01\n');
  await rejects(() => run(db, ['import', 'carta', K, `--file=${noPlan}`]), /no plan/);
  assert.throws(() => mapCartaRow({ 'Stakeholder Name': 'X' }, 2), /required/); checks++;
  assert.throws(() => mapCartaRow({ 'Stakeholder Name': 'X', 'Security ID': 'A', Quantity: '1', 'Issue Date': '14.03.2026' }, 2), /cannot read date/); checks++;
  const sh = await run(db, ['import', 'stakeholders', K, `--file=${path.join(REPO_ROOT, 'examples', 'stakeholders.csv')}`]);
  eq(sh.inserted, 2, 'addresses imported');
  ok(!(await run(db, ['compliance', K])).some((r) => r.rule === 'register-address'), 'address clears the register finding');

  // Export, drafts, views and documents.
  const exp = await run(db, ['export', `--out=${path.join(temp, 'exports', 'backup.json')}`]);
  ok(TABLES.every((t) => t in exp.counts) && exp.counts.share_events > 15, 'export has every table');
  const wk = await run(db, ['draft-weekly', K]);
  ok(fs.readFileSync(wk.draft, 'utf8').includes('## Filings open'), 'weekly draft written');
  const ll = await run(db, ['draft-leaver-letter', 'Liam', K]);
  ok(fs.readFileSync(ll.draft, 'utf8').includes('exercise them by'), 'leaver letter drafted');
  await rejects(() => run(db, ['draft-leaver-letter', 'Priya', K]), /no leaving date/);
  const fl = await run(db, ['draft-filings']);
  ok(fl.filings > 0 && fs.readFileSync(fl.draft, 'utf8').includes('record-filing'), 'filing list drafted');
  await db.close(); db = null;
  ok(cli('view.mjs').includes('views/week.html'), 'views render');
  const docs = cli('docs.mjs');
  ok(/\d+ document\(s\) rendered/.test(docs) && docs.includes('share-register') && docs.includes('option-statement') && docs.includes('share-certificate'), 'documents render');
  ok(cli('cap.mjs', ['compliance', '--json']).trim().startsWith('['), 'json output');
  console.log(`PASS ${checks} checks (${process.env.DATABASE_URL ? 'postgres' : 'pglite'})`);
} finally {
  if (db) await db.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
