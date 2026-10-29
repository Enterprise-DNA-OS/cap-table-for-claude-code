# Cap Table for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Business:** [YOUR BUSINESS]
- **Operator:** [YOUR NAME], [your role]
- **What matters most:** [the one or two outcomes you care about]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything about a record, read its full history first.
3. **Plain language.** Short sentences. No filler. Numbers in tables.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or faces a customer waits for a yes in this session.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| Add a company, holder, share class, round, option plan or SAFE | `/add` |
| Record the board approval date on a share issue, grant or convertible | `/approve` |
| Everything that needs the company secretary this week: filings overdue or due, rule findings, leavers whose exercise window is closing, cliffs about to vest, pools running low, notes about to mature | `/attention` |
| Cancel an option grant; whatever was not exercised goes back to the pool | `/cancel-grant` |
| The cap table: every holder's ordinary and preference shares, outstanding options and the unallocated pool, issued and fully diluted percentages | `/cap-table` |
| Every company in the database: jurisdiction, type, holders, issued and fully diluted shares, overdue filings | `/companies` |
| One company in full: details, cap table, option pool, open filings and rule findings | `/company` |
| Check the registers against the NZ and Australian rules in docs/compliance.md (share issue notices, ASIC Form 484, ESS reporting, the 50 non-employee shareholder limit, register details) and the operator's policies, and report what is late, due or missing with the rule cited | `/compliance` |
| Convert a SAFE or note into shares at a round | `/convert` |
| SAFEs and convertible notes: principal, cap, discount, interest owed today, maturity | `/convertibles` |
| Make this system yours in plain language | `/customise` |
| Render the share register, the register of option holders, share certificates and option statements as branded HTML | `/documents` |
| Write the list of filings to lodge now, for the accountant, lawyer or whoever lodges, into drafts/ | `/draft-filings` |
| Draft the letter telling a leaver what they keep, what lapses and the date to exercise by | `/draft-leaver-letter` |
| Save the weekly review as a markdown draft in drafts/ (never sent) | `/draft-weekly` |
| Exercise vested options: the shares are issued, the grant is reduced, and the filings owed are named | `/exercise` |
| Write every table to one JSON file: a backup, or the hand-over to an auditor or acquirer | `/export` |
| Every filing the register owes (NZ share issue notices, ASIC Form 484, ATO ESS statements and report, NZ ESS income), with due dates and what is already lodged | `/filings` |
| Grant share options under a plan, checked against what is left in the pool | `/grant-options` |
| One grant with its full vesting schedule and every exercise | `/grant` |
| Every option grant: vested, exercised, exercisable, unvested, outstanding and its state (before cliff, vesting, leaver, expired, cancelled) | `/grants` |
| Bring a cap table across from a Carta export (securities ledger saved as CSV), and holder addresses from a stakeholder list | `/import` |
| Issue new shares to a holder and see the filing it triggers | `/issue-shares` |
| Record that someone has left: vesting stops, unvested options go back to the pool, and the exercise window starts | `/leave` |
| People who have left with options: what vested, what went back to the pool, and when the exercise window closes | `/leavers` |
| Add a dated note to a holder, grant, company or convertible | `/log` |
| Add a read-only HTML view (a dashboard page) from a plain-language description, rendered in the operator's brand by `npm run view` | `/new-view` |
| The option pool: size, granted, exercised, outstanding, returned by leavers and cancellations, and what is left to grant | `/pool` |
| Record that a filing was lodged, so it stops showing as owed | `/record-filing` |
| Record a fair market value per share: an independent valuation or a priced round | `/record-valuation` |
| Model a priced round on today's fully diluted cap table: price per share, SAFE and note conversions, a pool top-up, and everyone's stake before and after | `/round-model` |
| One holder in full: shares by class, option grants with vesting, the next vesting dates, every ledger entry, SAFEs or notes, and notes | `/stakeholder` |
| Transfer shares between two holders | `/transfer` |
| Who vests in the next N days, cliffs first | `/vesting` |
| What each holder takes home if the company sells for a given amount, with preferences paid or converted | `/waterfall` |
| The Monday share register review, written from attention, filings, vesting and the rule checks | `/weekly-review` |

If an ask fits nothing here, run the CLI directly (`npm run <cli> -- --help`) and then propose a new command for it.

## Hard rules

- Never send email or messages from here. Draft to `drafts/`, a person sends.
- Never delete records without an explicit yes in this session. Prefer marking closed or archived.
- Never invent a record. If a name is ambiguous, list the candidates and ask.
- The database is the source of truth. If the answer is not in it, say so.
- Name the company. Codes like G-01 repeat across companies: pass `--company=<code>` whenever the database holds more than one.
- Never lodge anything with the Companies Office, ASIC, the ATO or Inland Revenue. Say what is owed, draft the list, and record it once a person has lodged it.
- Nothing here is legal or tax advice. When a question turns on the law (is this plan exempt, is this a taxing point), say what the records show and who should confirm it.
- Holders' names, addresses and holdings are personal information. Exports and drafts stay private.

## Where things live

- `scripts/` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `docs/` the thesis, the rule sources (`compliance.md`) and the guide for moving off Carta (`replace-carta.md`).
- `documents.json` and `views.json` the registers, certificates, statements and dashboards that `npm run docs` and `npm run view` render.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/carta
