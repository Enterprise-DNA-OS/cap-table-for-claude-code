<h1 align="center">Cap Table for Claude Code</h1>

<p align="center">
  <strong>The open-source cap table and staff share option system (shareholders, share classes, option grants, vesting, rounds and the filings that follow) that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Works with Claude Code, Codex, OpenCode or Cursor.
</p>

<!-- three-doors -->
<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, your Carta data brought across.<br/><a href="https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=carta">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/carta?utm_source=github&utm_medium=readme&utm_campaign=carta">How it works</a></td>
  </tr>
</table>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#instead-of-carta">Instead of Carta</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

Cap Table for Claude Code does the job you pay Carta for, as a Postgres database and a set of agent commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) (or Codex, OpenCode, Cursor: see `AGENTS.md`) and ask for what you want in plain language. It runs the right query, and it can answer questions the Carta dashboard cannot.

Carta does not publish a full price list for New Zealand or Australian companies. Its pricing pages describe a price per stakeholder with a minimum annual fee, on four packages (Launch, Build, Grow, Scale), so the bill rises with every person you add to the option plan. Here there is no per-holder price at all.

Want the same thing with a web front end, or built on a different stack? That is a customisation, and it is exactly what Enterprise DNA does: [book a call](https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=carta).

It covers the share register and the option plan: companies, share classes with their preferences, holders, every issue, transfer, exercise and cancellation, option pools, grants with cliffs and vesting, leavers and their exercise windows, SAFEs and convertible notes, valuations, a round model and an exit waterfall. It knows the New Zealand and Australian filings each event triggers (share issue notices, ASIC Form 484, ATO ESS statements and report, Inland Revenue ESS income) and tells you what is late. It suits founders and finance leads keeping their own register, and law and accounting firms keeping registers for many client companies in one database.

### Ten questions Carta's screens do not answer

Each one is a command that runs today on the demo data:

1. Which filings are overdue across every client company, and by how many days? (`filings`)
2. Who hits a vesting cliff in the next 30 days, and how many options vest at once? (`vesting --days=30`)
3. Which leavers have vested options that lapse this month if nobody tells them? (`attention`)
4. What does each founder own after a $4m raise at $16m pre-money with the pool topped up to 10%, with the SAFE and the note converting? (`round-model`)
5. At a $3m sale, does the Series A take its preference or convert, and what do the founders take home? (`waterfall`)
6. What employment income does Priya's exercise create at the last valuation, and when must Inland Revenue hear about it? (`filings`)
7. How close is this Australian proprietary company to the 50 non-employee shareholder limit? (`compliance`)
8. Which grants and share issues have no board approval on file? (`compliance`)
9. How many options went back to the pool from leavers and cancellations this year? (`pool`)
10. Which holders are on the register with no address? (`compliance`)

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your data sits in plain Postgres tables you own. Any tool can read them. No export, no lock-in.
- No seats, no tiers, no add-ons. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for the honest trade-offs too.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/cap-table-for-claude-code.git
cd cap-table-for-claude-code
npm install
npm run demo
```

Then open the folder in Claude Code and type `/attention`: two fictional companies, one in Auckland and one in Sydney, with late filings, a cliff about to vest, a leaver whose window is closing and a matured note. Then try `/round-model` and `/waterfall`.

Without an agent: `npm run cap -- help`, `npm run view` (dashboards in `views/`) and `npm run docs` (share registers, option registers, certificates and option statements in `docs-out/`).

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee.

## The commands

| Command | What it does |
|---|---|
| `/add` | Add a company, holder, share class, round, option plan or SAFE. |
| `/approve` | Record the board approval date on a share issue, grant or convertible. |
| `/attention` | Everything that needs the company secretary this week: filings overdue or due, rule findings, leavers whose exercise window is closing, cliffs about to vest, pools running low, notes about to mature. |
| `/cancel-grant` | Cancel an option grant; whatever was not exercised goes back to the pool. |
| `/cap-table` | The cap table: every holder's ordinary and preference shares, outstanding options and the unallocated pool, issued and fully diluted percentages. |
| `/companies` | Every company in the database: jurisdiction, type, holders, issued and fully diluted shares, overdue filings. |
| `/company` | One company in full: details, cap table, option pool, open filings and rule findings. |
| `/compliance` | Check the registers against the NZ and Australian rules in docs/compliance.md (share issue notices, ASIC Form 484, ESS reporting, the 50 non-employee shareholder limit, register details) and the operator's policies, and report what is late, due or missing with the rule cited. |
| `/convert` | Convert a SAFE or note into shares at a round. |
| `/convertibles` | SAFEs and convertible notes: principal, cap, discount, interest owed today, maturity. |
| `/customise` | Make this system yours in plain language. |
| `/documents` | Render the share register, the register of option holders, share certificates and option statements as branded HTML. |
| `/draft-filings` | Write the list of filings to lodge now, for the accountant, lawyer or whoever lodges, into drafts/. |
| `/draft-leaver-letter` | Draft the letter telling a leaver what they keep, what lapses and the date to exercise by. |
| `/draft-weekly` | Save the weekly review as a markdown draft in drafts/ (never sent). |
| `/exercise` | Exercise vested options: the shares are issued, the grant is reduced, and the filings owed are named. |
| `/export` | Write every table to one JSON file: a backup, or the hand-over to an auditor or acquirer. |
| `/filings` | Every filing the register owes (NZ share issue notices, ASIC Form 484, ATO ESS statements and report, NZ ESS income), with due dates and what is already lodged. |
| `/grant-options` | Grant share options under a plan, checked against what is left in the pool. |
| `/grant` | One grant with its full vesting schedule and every exercise. |
| `/grants` | Every option grant: vested, exercised, exercisable, unvested, outstanding and its state (before cliff, vesting, leaver, expired, cancelled). |
| `/import` | Bring a cap table across from a Carta export (securities ledger saved as CSV), and holder addresses from a stakeholder list. |
| `/issue-shares` | Issue new shares to a holder and see the filing it triggers. |
| `/leave` | Record that someone has left: vesting stops, unvested options go back to the pool, and the exercise window starts. |
| `/leavers` | People who have left with options: what vested, what went back to the pool, and when the exercise window closes. |
| `/log` | Add a dated note to a holder, grant, company or convertible. |
| `/new-view` | Add a read-only HTML view (a dashboard page) from a plain-language description, rendered in the operator's brand by `npm run view`. |
| `/pool` | The option pool: size, granted, exercised, outstanding, returned by leavers and cancellations, and what is left to grant. |
| `/record-filing` | Record that a filing was lodged, so it stops showing as owed. |
| `/record-valuation` | Record a fair market value per share: an independent valuation or a priced round. |
| `/round-model` | Model a priced round on today's fully diluted cap table: price per share, SAFE and note conversions, a pool top-up, and everyone's stake before and after. |
| `/stakeholder` | One holder in full: shares by class, option grants with vesting, the next vesting dates, every ledger entry, SAFEs or notes, and notes. |
| `/transfer` | Transfer shares between two holders. |
| `/vesting` | Who vests in the next N days, cliffs first. |
| `/waterfall` | What each holder takes home if the company sells for a given amount, with preferences paid or converted. |
| `/weekly-review` | The Monday share register review, written from attention, filings, vesting and the rule checks. |

## Instead of Carta

Run Carta's cap table report (with the securities ledger), vesting report and stakeholder details as CSV, set up the company, classes and plans, then:

```bash
npm run cap -- import carta --company=KWR --file=imports/securities-ledger.csv --dry-run
npm run cap -- import carta --company=KWR --file=imports/securities-ledger.csv
npm run cap -- import stakeholders --company=KWR --file=imports/stakeholder-details.csv
```

The full guide, with every accepted column name and what does not come across: [docs/replace-carta.md](docs/replace-carta.md). The rules each check enforces, with sources: [docs/compliance.md](docs/compliance.md).

## Your first hour: ten things to ask for

1. "Set up our company: Kauri Labs Limited, New Zealand, ordinary shares and a 10% option plan."
2. "Import our Carta export from imports/ and show me where the totals differ."
3. "What is overdue?"
4. "Show me the cap table, fully diluted."
5. "Grant Aroha 20,000 options at $0.95, four years with a one-year cliff, approved at yesterday's board meeting."
6. "Who vests in the next 90 days?"
7. "Josh left on 10 August. What does he keep, and draft him the letter."
8. "Model a $3m raise at $12m pre with a 12% post-money pool."
9. "What does everyone get if we sell for $25m?"
10. "Our shareholders' agreement says transfers need 20 working days' notice to the other holders. Add that as a check." (`/customise`)

## Architecture

```
cap-table-for-claude-code/
  CLAUDE.md                 how the operator wants this run (routing table + house rules)
  AGENTS.md                 the same, for Codex / OpenCode / Cursor / Gemini CLI
  .claude/commands/         the slash commands
  scripts/                  the CLI the commands drive
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema
  supabase/seed.sql         demo data
  docs/                     the thesis and the migration guide
```

## Built for coding agents

The database, CLI and command recipes work with Claude Code, Codex, OpenCode or Cursor. Ask your coding agent for a new command and have it implement and test the change against the same records.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end.

## Want it installed and run for you?

Enterprise DNA installs Cap Table for Claude Code for your business, migrates your Carta data, connects it to the rest of your tools, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: [enterprisedna.co/omni/book](https://enterprisedna.co/omni/book/?offer=replace-software&utm_source=github&utm_medium=readme&utm_campaign=carta)
- Read more: [enterprisedna.co/omni/instead-of/carta](https://enterprisedna.co/omni/instead-of/carta?utm_source=github&utm_medium=readme&utm_campaign=carta)

## License

MIT. Copyright (c) 2026 Enterprise DNA.
