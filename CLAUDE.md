# CLAUDE.md — Master Configuration

This project is organized around the **WAT framework**. Claude Code reads this file at the
start of every session. It is the single source of truth for how work is structured here:
what to do (Workflows), who does it (the Agent), and what it is done with (Tools).

---

## The WAT Framework

**WAT = Workflows · Agent · Tools.**

### W — Workflows
Step-by-step procedure files that **orchestrate the work**. A workflow describes *what to do
and in what order* to accomplish a repeatable task — the inputs it needs, the sequence of
steps, the tools each step uses, and where outputs go. Workflows live in [`/workflows/`](workflows/).

Think of a workflow as the recipe: it is plain, explicit, and re-runnable, so the same task
produces the same result every time.

### A — Agent
**Claude Code — the AI agent that reads, plans, and executes.** The Agent is the active
party in this framework. It:

1. **Reads** the relevant workflow (and this file) to understand the task.
2. **Plans** the steps, confirming intent and surfacing decisions when they matter.
3. **Executes** the steps, invoking the Tools the workflow specifies and writing transient
   work to [`/temp/`](temp/).

The Agent interprets workflows, adapts when reality differs from the procedure, and reports
results honestly.

### T — Tools
**Scripts and integrations that the Agent uses to get things done.** Tools are the concrete
capabilities a workflow step calls on — local scripts, CLI utilities, and API integrations.
They live in [`/tools/`](tools/). Secrets that tools need (API keys, tokens) are loaded from
[`.env`](.env), never hardcoded.

> **In short:** Workflows say *what*, the Agent does the *doing*, and Tools are the *how*.

---

## Current Workflows

- **[Check NJ Campsite Availability](workflows/check-nj-campsite-availability.md)** —
  reads your stored favorite sites ([`config/preferred-sites.json`](config/preferred-sites.json)),
  fetches live availability from the NJ state-park portal, and writes an interactive
  color-coded HTML calendar you click to see which park has a preferred site open on a
  given day. Tool: [`tools/nj-campsite-availability.js`](tools/nj-campsite-availability.js).
  Read-only (never books).

Add more workflow files under [`/workflows/`](workflows/) following
[How to Add a Workflow](#how-to-add-a-workflow) below.

**Where data lives:** the **Agency OS** Google Sheet holds lead / CRM data, read via
[`tools/gsheets-read.md`](tools/gsheets-read.md).

> **Golden rule — draft-and-approve.** Workflows *read and propose*; they never send email,
> spend money, publish, or edit the workbook on their own. Every outward or data-changing
> action is written as a draft to
> [`temp/outputs/approvals/`](temp/outputs/approvals/README.md) for the founder to sign off.

> **Planned — AI virtual team.** A future expansion adds business-role charters under
> `workflows/roles/` coordinated by a **Founder's Office** orchestrator. Those files are not
> built yet; add them when the team structure is needed.

---

## Folder Structure

```
.
├── CLAUDE.md          # This file — master config the Agent reads each session
├── .env               # API keys & secrets — NEVER commit
├── .env.example       # Committed template listing the keys .env should define
├── .gitignore         # Keeps .env and /temp/ working files out of version control
├── workflows/         # W — step-by-step procedure files
├── tools/             # T — scripts and integrations
├── config/            # Persistent user settings (e.g. preferred-sites.json)
└── temp/              # Temporary working files (safe to delete)
    ├── outputs/       # Generated artifacts produced by workflows
    └── resources/     # Downloaded or staged inputs used during a run
```

| Path                 | Purpose                                                            |
|----------------------|-------------------------------------------------------------------|
| `/workflows/`        | Step-by-step procedures that orchestrate tasks.                    |
| `/tools/`            | Scripts and integrations the Agent invokes.                       |
| `/temp/`             | Scratch space for a single run; not source-controlled.            |
| `/temp/outputs/`     | Files a workflow generates (reports, exports, results).           |
| `/temp/resources/`   | Inputs fetched or staged for the current run.                     |
| `.env`               | API keys and secrets. **Never commit.** Load values from here.    |

---

## Operating Rules for the Agent

1. **Read the workflow first.** Before executing a task, open the matching file in
   [`/workflows/`](workflows/) and follow its steps. If no workflow exists for the task,
   say so and propose creating one.
2. **Use tools, don't reinvent them.** Prefer existing scripts/integrations in
   [`/tools/`](tools/) over ad-hoc one-offs. If a needed tool is missing, propose adding it.
3. **Keep transient work in `/temp/`.** Write generated artifacts to
   [`/temp/outputs/`](temp/outputs/) and staged inputs to
   [`/temp/resources/`](temp/resources/). Treat `/temp/` as disposable.
4. **Never hardcode or commit secrets.** Load credentials from [`.env`](.env). When adding a
   new secret, also document it (key name + description, no value) in `.env.example`.
5. **Report results faithfully.** If a step fails or is skipped, say so with the evidence.

---

## How to Add a Workflow

1. Create a file in [`/workflows/`](workflows/) named for the task (e.g. `generate-report.md`).
2. Document: **Goal**, **Inputs**, **Steps** (numbered, each naming any tool it uses),
   **Outputs** (where results land under `/temp/outputs/`), and **Notes/edge cases**.
3. Keep it explicit and re-runnable — a new reader should be able to follow it without guessing.

## How to Add a Tool

1. Add the script or integration to [`/tools/`](tools/) with a clear, descriptive name.
2. At the top of the file, comment what it does, its inputs/outputs, and how to invoke it.
3. If it needs secrets, read them from [`.env`](.env) and add the key (name only) to `.env.example`.
4. Reference the tool by name from the workflow step(s) that use it.
