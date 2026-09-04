# Triage labels

Use these labels for triage:

- `needs-triage`: the correct next owner or action cannot be determined automatically.
- `needs-info`: a decision or required input is missing, so execution cannot begin.
- `ready-for-agent`: intent, dependencies, acceptance criteria, and validation are complete enough for Agent execution.
- `ready-for-human`: the next step requires human review or a user decision.
- `wontfix`: the user explicitly decided not to execute the Ticket; record the reason and re-evaluate dependants.

Tickets generated from an approved Spec use `ready-for-agent` when complete and `needs-info` when required decisions are missing. They do not use `needs-triage` merely as a default holding state.
