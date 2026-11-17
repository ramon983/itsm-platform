#!/usr/bin/env bash
# One-time Google Cloud setup for the AdminZero API: Artifact Registry, service accounts, Secret Manager,
# and keyless GitHub Actions deploys via Workload Identity Federation (no JSON keys anywhere).
#
# Usage:  PROJECT_ID=my-project REGION=us-central1 GITHUB_REPO=ramon983/itsm-platform ./backend/scripts/setup_gcp.sh
# Re-running is safe: every step checks before creating.
set -euo pipefail

: "${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-us-central1}"
GITHUB_REPO="${GITHUB_REPO:-ramon983/itsm-platform}"
AR_REPO="${AR_REPO:-adminzero}"
POOL="github-pool"
PROVIDER="github-provider"
DEPLOY_SA="adminzero-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME_SA="adminzero-run@${PROJECT_ID}.iam.gserviceaccount.com"
SECRETS=(ANTHROPIC_API_KEY DATABASE_URL SIEM_WEBHOOK_SECRET VAULT_KMS_KEY)

gcloud config set project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

echo "› Enabling APIs"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com \
  iamcredentials.googleapis.com sts.googleapis.com >/dev/null

echo "› Artifact Registry repo ${AR_REPO}"
gcloud artifacts repositories describe "$AR_REPO" --location "$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "$AR_REPO" --repository-format=docker --location "$REGION"

echo "› Service accounts"
for sa in adminzero-deployer adminzero-run; do
  gcloud iam service-accounts describe "${sa}@${PROJECT_ID}.iam.gserviceaccount.com" >/dev/null 2>&1 || \
    gcloud iam service-accounts create "$sa" --display-name "AdminZero ${sa#adminzero-}"
done
for role in roles/run.admin roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:${DEPLOY_SA}" --role "$role" --condition=None >/dev/null
done
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --member "serviceAccount:${DEPLOY_SA}" --role roles/iam.serviceAccountUser >/dev/null

echo "› Secrets (values are read from your terminal, never written to disk)"
for name in "${SECRETS[@]}"; do
  if ! gcloud secrets describe "$name" >/dev/null 2>&1; then
    read -r -s -p "  Value for ${name} (leave empty to skip): " value; echo
    if [[ -n "$value" ]]; then
      printf '%s' "$value" | gcloud secrets create "$name" --replication-policy=automatic --data-file=- >/dev/null
    else
      echo "  skipped ${name} — create it later with: printf '…' | gcloud secrets create ${name} --data-file=-"
      continue
    fi
  fi
  gcloud secrets add-iam-policy-binding "$name" --member "serviceAccount:${RUNTIME_SA}" --role roles/secretmanager.secretAccessor >/dev/null
done

echo "› Workload Identity Federation for ${GITHUB_REPO}"
gcloud iam workload-identity-pools describe "$POOL" --location global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create "$POOL" --location global --display-name "GitHub Actions"
gcloud iam workload-identity-pools providers describe "$PROVIDER" --location global --workload-identity-pool "$POOL" >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --location global --workload-identity-pool "$POOL" \
    --issuer-uri "https://token.actions.githubusercontent.com" \
    --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition "assertion.repository=='${GITHUB_REPO}'"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${GITHUB_REPO}" >/dev/null

WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"
cat <<NEXT

Done. Set these GitHub repository variables (Settings → Secrets and variables → Actions → Variables):
  GCP_PROJECT_ID          ${PROJECT_ID}
  GCP_REGION              ${REGION}
  ARTIFACT_REGISTRY_REPO  ${AR_REPO}
  WIF_PROVIDER            ${WIF_PROVIDER}
  DEPLOY_SERVICE_ACCOUNT  ${DEPLOY_SA}
  RUNTIME_SERVICE_ACCOUNT ${RUNTIME_SA}

or run:
  gh variable set GCP_PROJECT_ID -b ${PROJECT_ID} && gh variable set GCP_REGION -b ${REGION} && \\
  gh variable set ARTIFACT_REGISTRY_REPO -b ${AR_REPO} && gh variable set WIF_PROVIDER -b ${WIF_PROVIDER} && \\
  gh variable set DEPLOY_SERVICE_ACCOUNT -b ${DEPLOY_SA} && gh variable set RUNTIME_SERVICE_ACCOUNT -b ${RUNTIME_SA}

After the first deploy, set ADMINZERO_API_URL to the Cloud Run URL so the dashboard calls the live API.
NEXT
