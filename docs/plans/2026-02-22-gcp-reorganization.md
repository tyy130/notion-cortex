# GCP Reorganization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reorganize 17 GCP projects into a clean per-app structure, migrate Cloud Run services out of gen-lang-client projects, and consolidate all billing under one account.

**Architecture:** Create new dedicated projects with clean IDs, redeploy Cloud Run containers into them, link all active projects to a single billing account, then delete the 13 unused/old projects.

**Tech Stack:** gcloud CLI, Cloud Run, Google Cloud Storage (gsutil), GCP Billing API

---

## Reference

- Active billing account: `01235B-83CF7F-82FEE5` (My Billing Account)
- Source project for most migrations: `gen-lang-client-0788213556`
- StenoMind source project: `gen-lang-client-0819978144`
- Design doc: `docs/plans/2026-02-22-gcp-reorganization-design.md`

---

### Task 1: Create new dedicated projects

**Files:** None (gcloud commands only)

**Step 1: Create the 4 new projects**

```bash
gcloud projects create td-sitelink-ai --name="Sitelink AI"
gcloud projects create td-smart-recipe --name="Smart Recipe Maker"
gcloud projects create td-legend-of-bytes --name="Legend of Bytes"
gcloud projects create td-stenomind --name="StenoMind"
```

Expected: Each prints `Create in progress for [https://cloudresourcemanager.googleapis.com/v1/projects/td-*]`

**Step 2: Link each to active billing account**

```bash
gcloud billing projects link td-sitelink-ai --billing-account=01235B-83CF7F-82FEE5
gcloud billing projects link td-smart-recipe --billing-account=01235B-83CF7F-82FEE5
gcloud billing projects link td-legend-of-bytes --billing-account=01235B-83CF7F-82FEE5
gcloud billing projects link td-stenomind --billing-account=01235B-83CF7F-82FEE5
```

Expected: `billingEnabled: true` for each

**Step 3: Enable Cloud Run in each new project**

```bash
for proj in td-sitelink-ai td-smart-recipe td-legend-of-bytes td-stenomind; do
  gcloud services enable run.googleapis.com --project=$proj
  gcloud services enable generativelanguage.googleapis.com --project=$proj
  gcloud services enable aiplatform.googleapis.com --project=$proj
done
```

Expected: `Operation finished successfully` for each

**Step 4: Verify**

```bash
gcloud projects list --filter="projectId:(td-sitelink-ai OR td-smart-recipe OR td-legend-of-bytes OR td-stenomind)" --format="table(projectId,name,lifecycleState)"
```

Expected: All 4 projects listed as ACTIVE

**Step 5: Commit**

```bash
git commit --allow-empty -m "chore(gcp): create 4 new dedicated app projects"
```

---

### Task 2: Get container images from source projects

Before migrating, capture the exact container image URIs so you can redeploy them.

**Step 1: Get image for sitelink-ai**

```bash
gcloud run services describe sitelink-ai \
  --project=gen-lang-client-0788213556 \
  --region=us-west1 \
  --format="value(spec.template.spec.containers[0].image)"
```

Note the output (will look like `us-west1-docker.pkg.dev/... or gcr.io/...`).

**Step 2: Get image for smart-recipe-maker**

```bash
gcloud run services describe smart-recipe-maker \
  --project=gen-lang-client-0788213556 \
  --region=us-west1 \
  --format="value(spec.template.spec.containers[0].image)"
```

**Step 3: Get image for legend-of-bytes**

```bash
gcloud run services describe legend-of-bytes \
  --project=gen-lang-client-0788213556 \
  --region=us-west1 \
  --format="value(spec.template.spec.containers[0].image)"
```

**Step 4: Get image for stenomind**

```bash
gcloud run services describe stenomind \
  --project=gen-lang-client-0819978144 \
  --region=us-west1 \
  --format="value(spec.template.spec.containers[0].image)"
```

**Step 5: Get env vars for each service (secrets/config to carry over)**

```bash
gcloud run services describe sitelink-ai \
  --project=gen-lang-client-0788213556 \
  --region=us-west1 \
  --format="yaml(spec.template.spec.containers[0].env)"

gcloud run services describe smart-recipe-maker \
  --project=gen-lang-client-0788213556 \
  --region=us-west1 \
  --format="yaml(spec.template.spec.containers[0].env)"

gcloud run services describe legend-of-bytes \
  --project=gen-lang-client-0788213556 \
  --region=us-west1 \
  --format="yaml(spec.template.spec.containers[0].env)"

gcloud run services describe stenomind \
  --project=gen-lang-client-0819978144 \
  --region=us-west1 \
  --format="yaml(spec.template.spec.containers[0].env)"
```

Record all env vars — you'll need them in Task 3.

---

### Task 3: Migrate Cloud Run services to new projects

For each service: deploy to new project, verify, then proceed.

**Step 1: Deploy sitelink-ai to td-sitelink-ai**

Replace `IMAGE_URI` with the value from Task 2 Step 1. Replace `ENV_FLAGS` with `--set-env-vars KEY=VALUE,...` from Task 2 Step 5.

```bash
gcloud run deploy sitelink-ai \
  --image=IMAGE_URI \
  --project=td-sitelink-ai \
  --region=us-west1 \
  --allow-unauthenticated \
  ENV_FLAGS
```

**Step 2: Verify sitelink-ai is healthy**

```bash
gcloud run services describe sitelink-ai \
  --project=td-sitelink-ai \
  --region=us-west1 \
  --format="value(status.url)"
```

Then curl the URL:
```bash
curl -I $(gcloud run services describe sitelink-ai --project=td-sitelink-ai --region=us-west1 --format="value(status.url)")
```

Expected: HTTP 200 or your app's expected response

**Step 3: Deploy smart-recipe-maker to td-smart-recipe**

```bash
gcloud run deploy smart-recipe-maker \
  --image=IMAGE_URI \
  --project=td-smart-recipe \
  --region=us-west1 \
  --allow-unauthenticated \
  ENV_FLAGS
```

Verify same as Step 2 but for td-smart-recipe.

**Step 4: Deploy legend-of-bytes to td-legend-of-bytes**

```bash
gcloud run deploy legend-of-bytes \
  --image=IMAGE_URI \
  --project=td-legend-of-bytes \
  --region=us-west1 \
  --allow-unauthenticated \
  ENV_FLAGS
```

Verify same as Step 2 but for td-legend-of-bytes.

**Step 5: Deploy stenomind to td-stenomind**

```bash
gcloud run deploy stenomind \
  --image=IMAGE_URI \
  --project=td-stenomind \
  --region=us-west1 \
  --allow-unauthenticated \
  ENV_FLAGS
```

Verify same as Step 2 but for td-stenomind.

**Step 6: Commit**

```bash
git commit --allow-empty -m "chore(gcp): migrate Cloud Run services to dedicated projects"
```

---

### Task 4: Migrate storage bucket

The bucket `ai-studio-bucket-650217820681-us-west1` lives in `gen-lang-client-0788213556`. Determine which app owns it, then migrate.

**Step 1: Check what's in the bucket**

```bash
gsutil ls gs://ai-studio-bucket-650217820681-us-west1/
```

**Step 2: Create a new bucket in the appropriate project**

Based on bucket contents, choose the right new project (likely td-sitelink-ai or td-smart-recipe). Replace `CHOSEN_PROJECT`:

```bash
gcloud storage buckets create gs://CHOSEN_PROJECT-storage \
  --project=CHOSEN_PROJECT \
  --location=US-WEST1
```

**Step 3: Copy bucket contents**

```bash
gsutil -m rsync -r \
  gs://ai-studio-bucket-650217820681-us-west1 \
  gs://CHOSEN_PROJECT-storage
```

Expected: Files listed as copied

**Step 4: Verify copy**

```bash
gsutil ls gs://CHOSEN_PROJECT-storage/
```

Confirm same file structure as source bucket.

**Step 5: Update any Cloud Run env vars that reference the old bucket name**

```bash
gcloud run services update sitelink-ai \
  --project=td-sitelink-ai \
  --region=us-west1 \
  --update-env-vars BUCKET_NAME=CHOSEN_PROJECT-storage
```

(Only if a service references the bucket by name)

---

### Task 5: Link existing active projects to billing

**Step 1: Link the projects not yet on billing**

```bash
gcloud billing projects link flux-one-485812 --billing-account=01235B-83CF7F-82FEE5
gcloud billing projects link flux-cloud-485423 --billing-account=01235B-83CF7F-82FEE5
gcloud billing projects link tckr-core --billing-account=01235B-83CF7F-82FEE5
gcloud billing projects link studio-6929455803-a46d8 --billing-account=01235B-83CF7F-82FEE5
```

Note: tactic-dev-1504496945085 is already linked — skip it.

**Step 2: Verify all active projects are on billing**

```bash
gcloud billing projects list --billing-account=01235B-83CF7F-82FEE5 \
  --format="table(projectId,billingEnabled)"
```

Expected: flux-one, flux-cloud, tactic-dev, tckr-core, studio, td-sitelink-ai, td-smart-recipe, td-legend-of-bytes, td-stenomind all listed with `billingEnabled: True`

**Step 3: Commit**

```bash
git commit --allow-empty -m "chore(gcp): consolidate billing to single account"
```

---

### Task 6: Delete unused projects (Phase 1 — safe deletes)

Start with projects that have zero resources and were not mentioned as needed.

**Step 1: Delete the gen-lang-client API-only projects**

```bash
gcloud projects delete gen-lang-client-0239845784 --quiet
gcloud projects delete gen-lang-client-0364997434 --quiet
gcloud projects delete gen-lang-client-0855154218 --quiet
```

Expected: `Deleted [https://cloudresourcemanager.googleapis.com/v1/projects/...]`

Note: Projects enter a 30-day recovery window — not immediately permanent.

**Step 2: Delete zero-resource legacy projects**

```bash
gcloud projects delete blueprint-dynamics --quiet
gcloud projects delete blueprint-dynamics-386816 --quiet
gcloud projects delete discoverlbc --quiet
gcloud projects delete outreach-437121 --quiet
gcloud projects delete the-new-investors-guide --quiet
gcloud projects delete tacticdev-tab --quiet
gcloud projects delete gemini-cli-home-486409 --quiet
```

**Step 3: Verify**

```bash
gcloud projects list --format="table(projectId,name,lifecycleState)"
```

Deleted projects will show `DELETE_REQUESTED` for 30 days, then disappear.

---

### Task 7: Delete old gen-lang-client source projects

Only do this AFTER Task 3 (service migration) and Task 4 (bucket migration) are fully verified.

**Step 1: Confirm nothing is left in the source projects**

```bash
gcloud run services list --project=gen-lang-client-0788213556 --region=us-west1
gcloud run services list --project=gen-lang-client-0819978144 --region=us-west1
gcloud storage buckets list --project=gen-lang-client-0788213556
```

Expected: Empty lists for all three commands

**Step 2: Delete copy-of-sitelink-ai (duplicate, not migrating)**

```bash
gcloud run services delete copy-of-sitelink-ai \
  --project=gen-lang-client-0788213556 \
  --region=us-west1 \
  --quiet
```

**Step 3: Unlink from billing before deletion**

```bash
gcloud billing projects unlink gen-lang-client-0788213556
gcloud billing projects unlink gen-lang-client-0819978144
```

**Step 4: Delete the old source projects**

```bash
gcloud projects delete gen-lang-client-0788213556 --quiet
gcloud projects delete gen-lang-client-0819978144 --quiet
```

**Step 5: Final verification**

```bash
gcloud projects list --format="table(projectId,name,lifecycleState)"
```

Expected: Only clean, intentional projects remain (flux-one, flux-cloud, tactic-dev, tckr-core, studio, td-sitelink-ai, td-smart-recipe, td-legend-of-bytes, td-stenomind)

**Step 6: Commit**

```bash
git commit --allow-empty -m "chore(gcp): delete 13 unused projects, complete reorganization"
```

---

## Rollback Notes

- Deleted projects can be restored within 30 days: `gcloud projects undelete PROJECT_ID`
- Cloud Run services in old projects remain active until you delete them — no rush
- Billing unlinking is instant and reversible
- Storage bucket copy (gsutil rsync) does not delete source — original is safe until you manually remove it
