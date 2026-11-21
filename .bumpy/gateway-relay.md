---
inbou: patch
---

Fix lost votes and commands when many people answer at once. The bot now hands each event over without waiting for the work, and it replaces a Gateway connection that has stopped responding within about a minute, where before it could stay deaf for up to five.

Both Workers now keep their logs for three days, so a dropped connection can be traced after the fact.
