# GCP Reorganization Design
**Date:** 2026-02-22
**Author:** Tyler
**Status:** Approved

## Goal

Clean up 17 GCP projects and 4 billing accounts into a well-organized, per-app structure with consolidated billing.

---

## Current State

### Projects (17 total)

| Project ID | Display Name | Active Services |
|---|---|---|
| flux-cloud-485423 | Flux Cloud | flux-backend (Cloud Run) |
| flux-one-485812 | Flux One | None found |
| tactic-dev-1504496945085 | Tactic Dev | hexlens (Cloud Run) |
| tacticdev-tab | TacticDev Tab | None |
| tckr-core | tckr-core | None found |
| studio-6929455803-a46d8 | Firebase app | Firebase |
| gen-lang-client-0788213556 | AI Projects | sitelink-ai, copy-of-sitelink-ai, legend-of-bytes, smart-recipe-maker (Cloud Run) + storage bucket |
| gen-lang-client-0819978144 | StenoMind | stenomind (Cloud Run) |
| gen-lang-client-0239845784 | dl-ai | APIs only |
| gen-lang-client-0364997434 | EvoFutura | APIs only |
| gen-lang-client-0855154218 | loom | APIs only |
| blueprint-dynamics | Blueprint Dynamics | None |
| blueprint-dynamics-386816 | Blueprint Dynamics | None (duplicate) |
| discoverlbc | DiscoverLBC | None |
| outreach-437121 | Outreach | None |
| the-new-investors-guide | The New Investors Guide | None |
| gemini-cli-home-486409 | Gemini-CLI-Home | Gemini API key only |

### Billing Accounts (4 total)

| Account ID | Name | Status |
|---|---|---|
| 01235B-83CF7F-82FEE5 | My Billing Account | **Open (active)** |
| 012F69-7ADE1B-231FB8 | My Billing Account 1 | Closed |
| 015BB1-56BB07-F4F069 | My Maps Billing Account 1 | Closed |
| 01E7BF-F6CFA4-274D7B | My Maps Billing Account | Closed |

Currently linked to billing: gen-lang-client-0239845784, gen-lang-client-0788213556, tactic-dev-1504496945085, gemini-cli-home-486409

---

## Target State

### New Project Structure

Each app gets its own dedicated GCP project with a clean, descriptive ID.

| New Project ID | App | Migrated From |
|---|---|---|
| `td-sitelink-ai` | sitelink-ai | gen-lang-client-0788213556 |
| `td-smart-recipe` | smart-recipe-maker | gen-lang-client-0788213556 |
| `td-legend-of-bytes` | legend-of-bytes | gen-lang-client-0788213556 |
| `td-stenomind` | stenomind | gen-lang-client-0819978144 |

### Billing

All active projects linked to `01235B-83CF7F-82FEE5` (My Billing Account):
- flux-one-485812
- flux-cloud-485423
- tactic-dev-1504496945085
- tckr-core
- studio-6929455803-a46d8
- td-sitelink-ai (new)
- td-smart-recipe (new)
- td-legend-of-bytes (new)
- td-stenomind (new)

---

## Implementation Phases

### Phase 1 — Create new dedicated projects
- Create 4 new projects: td-sitelink-ai, td-smart-recipe, td-legend-of-bytes, td-stenomind
- Link each to billing account 01235B-83CF7F-82FEE5
- Enable required APIs (Cloud Run, etc.) in each

### Phase 2 — Migrate Cloud Run services
For each service (sitelink-ai, smart-recipe-maker, legend-of-bytes, stenomind):
1. Redeploy container image into new project
2. Migrate environment variables and secrets
3. Verify service is healthy in new project
4. Update any domain mappings
5. Cut over traffic
6. Delete service from old project

Also: migrate storage bucket from gen-lang-client-0788213556 to appropriate new project.

Note: `copy-of-sitelink-ai` is a duplicate — delete, do not migrate.

### Phase 3 — Link all active projects to billing
Link flux-one, flux-cloud, tactic-dev, tckr-core, studio (Firebase) to 01235B-83CF7F-82FEE5.

### Phase 4 — Delete unused projects (13 projects)
After migration is confirmed:
- gen-lang-client-0788213556 (AI Projects)
- gen-lang-client-0819978144 (StenoMind)
- gen-lang-client-0239845784 (dl-ai)
- gen-lang-client-0364997434 (EvoFutura)
- gen-lang-client-0855154218 (loom)
- blueprint-dynamics
- blueprint-dynamics-386816
- discoverlbc
- outreach-437121
- the-new-investors-guide
- tacticdev-tab
- gemini-cli-home-486409

### Phase 5 — Close unused billing accounts
- 012F69-7ADE1B-231FB8 (My Billing Account 1) — already closed, confirm/remove
- 015BB1-56BB07-F4F069 (My Maps Billing Account 1) — already closed, confirm/remove
- 01E7BF-F6CFA4-274D7B (My Maps Billing Account) — already closed, confirm/remove

---

## Key Constraints

- GCP project IDs are **permanent** — cannot be renamed after creation
- Cloud Run services **cannot be moved** between projects — must redeploy
- Storage bucket data must be copied (gsutil rsync), not moved
- Project deletion has a **30-day recovery window** before permanent removal
- Closing a billing account requires all linked projects to be unlinked first
