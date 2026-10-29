# Moving from Carta

Carta keeps your holders, share classes, the ledger of issues, option grants with vesting, SAFEs and documents. It does not hand you the database. You get reports: run them, save them as CSV, and import them here. Test the import, compare the totals with Carta's cap table, and run both side by side until a board meeting has passed before you stop paying.

## 1. Run three reports in Carta

In Carta, open the reports page (Run reports) and save each of these as CSV:

1. **Cap table report**, with the Detailed and Securities ledger options ticked. One row per security: who holds it, what kind, how many, at what price, on what date.
2. **Vesting report**, with every vesting detail, so each grant keeps its schedule, not just the vested total.
3. **Stakeholder details**, for names, emails and addresses.

Carta's reports let you choose columns, and the layout changes from time to time, so check the column names against the table below before you import. Download signed documents (share and grant agreements, SAFEs, board resolutions, valuation reports) separately: no report carries them.

## 2. Set up the company first

Add the company, its share classes and its option plans with `/add` (types `companies`, `share_classes`, `plans`), using the class and plan names your Carta export uses. The import matches a security's class or plan by code or name and stops if one is missing.

## 3. Import the securities ledger

```bash
npm run cap -- import carta --company=<code> --file=imports/securities-ledger.csv --dry-run
npm run cap -- import carta --company=<code> --file=imports/securities-ledger.csv
```

Each field accepts any of these column names (case does not matter):

| Field | Accepted column names |
|---|---|
| holder | Stakeholder Name, Stakeholder, Holder Name, Name, Shareholder |
| email | Stakeholder Email, Email, Email Address |
| security ID | Security ID, Security, Grant ID, Certificate ID, Label, ID |
| type | Security Type, Type, Grant Type, Interest Type (anything with option, ISO, NSO, ESOP, RSU or grant is an option grant) |
| share class | Share Class, Class, Stock Class, Share Class Name |
| plan | Equity Plan, Plan, Option Plan |
| quantity | Quantity, Shares, Quantity Issued, Options Granted, Granted, Number of Shares |
| price | Price Per Share, Price, Issue Price, Cost Per Share, Exercise Price, Strike Price |
| date | Issue Date, Grant Date, Date, Issued On (YYYY-MM-DD, or MM/DD/YYYY as Carta writes it) |
| vesting start | Vesting Start Date, Vesting Commencement Date, Vest Start |
| vesting months | Vesting Period (Months), Vesting Months, Total Vesting Months (48 if blank) |
| cliff | Cliff (Months), Cliff Months, Cliff (12 if blank) |
| expiry | Expiration Date, Expiry Date, Expires |
| relationship | Relationship, Stakeholder Relationship, Stakeholder Type (founder, employee, advisor, contractor, trust, investor) |
| exercised, cancelled | Exercised, Options Exercised; Cancelled, Forfeited |

`examples/carta-securities-ledger.csv` shows the shape.

What happens:

- Holders are matched by name or email. New ones are added with the company's tax residence, and you add addresses next.
- Shares come in as issues on their issue date, with the security ID as the event code and the certificate number. The share issue notice for each is recorded as filed before import, so history does not show as overdue.
- Option grants come in with their vesting schedule and expiry, approved on the grant date. A fully cancelled grant comes in cancelled.
- The whole file is one transaction. A security ID already in the company stops it and nothing is imported. Running the same file twice skips every row.

## 4. Addresses, then check

```bash
npm run cap -- import stakeholders --company=<code> --file=imports/stakeholder-details.csv
npm run cap -- cap-table --company=<code>
npm run cap -- compliance --company=<code>
```

The stakeholder import reads Name, Email and Address (or Mailing Address). Then compare `cap-table` with Carta's: issued shares, options outstanding and the pool should match to the share.

## What does not come across

- **Exercises and transfers.** The securities ledger import brings issues and grants. A grant with options already exercised is flagged in the import result (`exercised_to_check`): record each exercise with `/exercise` on its date so the shares and the grant agree. Record transfers with `/transfer`.
- **Vesting exceptions.** Milestone vesting, acceleration and custom schedules come in as the standard schedule. Fix them with `/customise` or by editing the grant.
- **SAFEs and notes.** Add them with `/add convertibles`; Carta's convertible reports vary too much to map blind.
- **Documents and valuations.** Keep the PDFs in your document store. Record each valuation with `/record-valuation`.
- **US filings.** 409A valuations, Form 3921 and 83(b) elections are United States rules. This base tracks New Zealand and Australian filings.

Mapping your own Carta layout, the exercises and any custom vesting is part of what Enterprise DNA does on the paid paths, or ask Claude Code to map your columns and check the totals with you.
