# Shark Tank pitch — three minutes

## 0:00 — The costly guess

“A test passes on your laptop and fails in CI. Everyone recognizes the next
hour: compare screenshots, paste environment dumps, change five things, rerun,
and celebrate when it turns green—without learning why.

CI tells us *where* software failed. Nobody has productized the scientific
question: **what is the smallest environmental difference that caused it?**”

## 0:30 — The reveal

Launch `./launch.sh`. Choose **The right tool, found second** and click
**Run controlled experiment**.

“Counterfactual Repro Lab captures the failure, then turns environment drift
into a controlled experiment. Every rerun gets a fresh isolated workspace. The
fixture never changes. The input never changes. The lab is physically allowed
to change one bounded variable at a time.”

Point to the live evidence stream as three baseline failures reproduce.

## 1:05 — The magic moment

“Locale? Three failures—rejected. Validation mode? Three failures—rejected.
Tool precedence? Three passes. That is not another green check. It is the first
repeatable `FAIL → PASS` flip.”

Show the intervention ledger and causal verdict:
`simulatedPath.order: legacy-first → current-first`.

“Now the engineer has an explanation with a mechanism: both tools existed, but
first-match resolution selected version 1. The lab changed only order, selected
version 2, and repeated the result.”

## 1:45 — Evidence, not theater

Copy the recipe, then download the receipt.

“The receipt includes the captured bounded environment, fixture and workspace
hashes, every expected and actual observation, rejected controls, and the exact
replay command. It also says what it cannot prove. No private environment dump.
No arbitrary command. No network. No package install.”

“Our falsifiable experiment ran 36 isolated trials. It found all three seeded
causes, reproduced 9/9 baseline failures and 9/9 counterfactual passes, rejected
six plausible controls, verified 36/36 workspace deletions, and took a median
553 ms per scenario.”

## 2:20 — Why this is a moonshot

“The moonshot is not a prettier CI log. It is a new debugging primitive:
**causality as an executable artifact**.

Today, environment knowledge lives in the engineer who happened to fix the
incident. Tomorrow, every cross-environment failure can yield a small,
machine-verifiable causal receipt. Those receipts compound into an
organization's map of which environmental differences actually matter. Agents
stop shotgun-debugging and begin proposing falsifiable interventions.”

## 2:50 — The ask

“Give us one sanitized real-world fixture and its two disagreeing environments.
Our next gate is simple: cut median time-to-cause versus expert manual diagnosis
without broadening the safety boundary.

Counterfactual Repro Lab turns ‘works on my machine’ from an argument into an
experiment.”
