# Why there is no front end

Carta is a share register with a subscription. Underneath it are ordinary records: companies, share classes, holders, a ledger of issues and transfers, option plans, grants with a vesting schedule, SAFEs and notes. What you pay for is the layer on top that lets people who do not write SQL get at them, and a price that rises with every holder you add.

That layer used to be the whole product, because talking to a database was hard. It is not hard any more. Open this folder in Claude Code, ask "what does Priya have vested, and what does she pay to exercise it?" or "what does the founders' stake look like after a $4m raise with a 10% pool?", and it runs the query and explains the answer.

## What you gain

- **Answers to your own questions.** Dilution, the exit waterfall, who hits a cliff next month, which filings are late: asked in your own words, against your own register.
- **No per-holder pricing.** Add every staff member to the option plan. The bill does not move.
- **Your register in your database.** Plain tables you can back up, hand to an auditor or an acquirer, and query from anything. There is nothing to export because there is nothing to leave.
- **Your rules.** The filing deadlines and checks for New Zealand and Australia are in the base. Your shareholders' agreement terms are one `/customise` away.

## What you give up

- **A holder portal.** In Carta each holder can log in to see their grants. Here the company sends them an option statement (`npm run docs -- option-statement`). Enterprise DNA can build a portal into your version.
- **E-signing.** Grants and certificates are documents you sign the way you sign everything else.
- **Lodging for you.** This base tells you what is owed and when, and drafts the list. A person lodges with the Companies Office, ASIC, the ATO or Inland Revenue.
- **A vendor help desk.** This is open source. Enterprise DNA supports the installed version for businesses that want someone to call.

## Who this fits

Founders and finance leads who keep their own register, and law and accounting firms that keep registers for many client companies in one place. If your holders expect to log in to a portal every week, keep Carta or have a portal built. If you need the answers and the filings right, this is cheaper, faster and yours.

Installed and run for you: https://enterprisedna.co/omni/instead-of/carta
