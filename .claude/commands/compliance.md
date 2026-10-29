---
description: Check the registers against the NZ and Australian rules in docs/compliance.md (share issue notices, ASIC Form 484, ESS reporting, the 50 non-employee shareholder limit, register details) and the operator's policies, and report what is late, due or missing with the rule cited.
---

1. Run `npm run cap -- compliance` (or `--company=<code>`). Each row has a severity: breached, due soon, near limit, or policy.
2. Read `docs/compliance.md` for the source of each rule and what the check does not cover.
3. Report as a table: rule, company, subject, what is wrong, the source. Breached first, then due soon, near limit, then policy.
4. For each, name the fix: lodge and /record-filing, add an address with /add or `import stakeholders`, record a board approval with /approve, or raise it with the board.
5. If a rule in `docs/compliance.md` looks out of date, say so and stop. Do not guess at law. The operator confirms the rule, then you update the doc and the check together in a migration.

Nothing here is legal or tax advice. The doc records the rules the operator has told the system to enforce, with sources, and this command checks the records against them.
