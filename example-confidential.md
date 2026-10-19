---
title: Hosting Renewal Proposal
client: ACME Corp
subtitle: Infrastructure team
tlp: amber
versions:
  - version: "1.0"
    date: "2026-10-19"
    status: "First draft"
contacts:
  - name: "Jane Doe"
    role: "Account manager"
    email: "jane.doe@example.com"
---

# Summary

We propose to renew ACME's hosting for three years, move the database to a managed service, and add a second region for disaster recovery. %%Check the region list with the ops team before sending.%%

The migration runs in May<span data-audience="internal">, provided the network team is free that month</span>.

# Offer

## Scope

1. Renewal of the current platform, unchanged.
2. Managed database, with daily backups kept 30 days.
3. A second region, on standby, tested twice a year.

> [!internal] Negotiation
> If they push back on the second region, offer it at cost for the first year rather than dropping it.

## Pricing %%internal%%

The list price is 120 k€ a year. We can go down to 104 k€ — our floor, at an 18 % margin.

## Delivery

| Phase | When | Owner |
| --- | --- | --- |
| Database migration | May | ACME + our team |
| Second region | June | Our team |
| Failover test | July | Our team<span data-audience="internal"> (Paul, if he is back from leave)</span> |

## Risk assessment %%tlp:red%%

The current database host was breached in 2025; ACME has not been told the details. This is why the migration comes first.

# Next steps

- Send this proposal by Friday.
- Book a review with ACME's IT lead the week after.

---

*This note shows every way to mark a confidential passage. Export it with* **Export all versions as PDF reports** *: the full version labels the restricted passages, and the Client version (marked TLP:AMBER like the note, unless the profile sets its own marking) leaves out the comment, both phrases, the Pricing section, the Negotiation callout and the TLP:RED risk assessment.*
