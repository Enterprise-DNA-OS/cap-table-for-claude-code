---
description: Bring a cap table across from a Carta export (securities ledger saved as CSV), and holder addresses from a stakeholder list.
---

Read docs/replace-carta.md. Add the company, share classes and plans first. Check the file's columns against the accepted names. Run `npm run cap -- import carta --company=<code> --file=<csv> --dry-run`, show the counts, then repeat without --dry-run. Then `import stakeholders` for addresses. A security ID that already exists stops the whole file. Finish with /cap-table and compare the totals to Carta's.
