#!/usr/bin/env bash
# IT Portal v2 — Azure infrastructure provisioning.
#
# Run this in Azure Cloud Shell (Bash), from an account with Global Admin / Owner
# rights on the subscription. Assumes you already ran (per the migration doc):
#   az account show --query id -o tsv
#   az group create --name it-portal-rg --location israelcentral
#   az ad sp create-for-rbac --name "it-portal-automation" --role Contributor \
#     --scopes /subscriptions/<SUBSCRIPTION_ID>/resourceGroups/it-portal-rg
#
# This script itself runs as YOU (the signed-in Global Admin), not as that Service
# Principal — the SP is only for the Claude session that later deploys application
# code via GitHub Actions. Nothing in this script prints secrets to stdout; the one
# secret it generates (the Graph mail app's client secret) is written straight into
# the Function App's settings and never echoed.
#
# Safe to re-run: every step checks for an existing resource before creating one.
#
# Usage:
#   chmod +x provision.sh
#   ./provision.sh all          # run everything in order
#   ./provision.sh step5        # run a single step (see STEP NAMES below)
#
# STEP NAMES: resources, appregs, easyauth, cors, identity, schema, appsettings

set -euo pipefail

# ── EDIT THESE ────────────────────────────────────────────────────────────
RESOURCE_GROUP="it-portal-rg"
LOCATION="northeurope"                  # israelcentral/westeurope unavailable to this subscription
SQL_LOCATION="swedencentral"            # Azure SQL specifically rejected northeurope/eastus/uksouth/
                                         # francecentral/westus2/germanywestcentral for this subscription —
                                         # swedencentral was the first that worked. Try other regions here
                                         # if this ever needs to be re-run somewhere it's since closed off.
FRONTEND_URL="https://it.ramilevystock.com"
NAME_SUFFIX="$(az account show --query id -o tsv | cut -c1-6)"   # deterministic, unique-ish
STORAGE_ACCOUNT="itportalst${NAME_SUFFIX}"       # must be globally unique, <=24 chars, lowercase
FUNCTION_APP="it-portal-api-${NAME_SUFFIX}"      # must be globally unique
SQL_SERVER="it-portal-sql-${NAME_SUFFIX}x"       # must be globally unique — "x" suffix because Azure
                                                  # poisons a global name for a while after ANY failed
                                                  # create attempt under it, even in the wrong region
SQL_DATABASE="it-portal-db"

# Mail settings — fill in your real Exchange Online addresses before running "appsettings"/"all"
SHARED_MAILBOX_UPN="support@rami-levy-stock.co.il"      # the shared mailbox Graph sends from
IT_COMPANY_EMAIL="support@rami-levy-stock.co.il"        # recipient for new-ticket notifications — swap for the real IT company mailbox after go-live
ADMIN_EMAIL="eran@rami-levy-stock.co.il"                # recipient for new-ticket notifications
# ─────────────────────────────────────────────────────────────────────────

SUBSCRIPTION_ID="$(az account show --query id -o tsv)"
TENANT_ID="$(az account show --query tenantId -o tsv)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say() { echo -e "\n\033[1;36m▶ $1\033[0m"; }

# ── STEP: core resources ────────────────────────────────────────────────
step_resources() {
  say "Storage account for the Function App"
  EXISTING_STORAGE_LOCATION="$(az storage account show --name "$STORAGE_ACCOUNT" --resource-group "$RESOURCE_GROUP" \
    --query location -o tsv 2>/dev/null || true)"
  if [ -z "$EXISTING_STORAGE_LOCATION" ]; then
    az storage account create --name "$STORAGE_ACCOUNT" --resource-group "$RESOURCE_GROUP" \
      --location "$LOCATION" --sku Standard_LRS
  elif [ "$EXISTING_STORAGE_LOCATION" != "$LOCATION" ]; then
    # A Consumption-plan Function App needs its storage account in the SAME region — a
    # mismatch here (e.g. left over from an earlier LOCATION value that got changed after
    # a failed attempt) causes the app to come up perpetually 503, with no useful error.
    echo "  ✗ Storage account '$STORAGE_ACCOUNT' already exists in '$EXISTING_STORAGE_LOCATION', but LOCATION is now '$LOCATION'."
    echo "    Either change LOCATION back to '$EXISTING_STORAGE_LOCATION', or pick a new STORAGE_ACCOUNT name so a fresh one is created in '$LOCATION'."
    exit 1
  fi

  say "Function App (Node 22, Linux Consumption)"
  az functionapp show --name "$FUNCTION_APP" --resource-group "$RESOURCE_GROUP" &>/dev/null || \
    az functionapp create --name "$FUNCTION_APP" --resource-group "$RESOURCE_GROUP" \
      --storage-account "$STORAGE_ACCOUNT" --consumption-plan-location "$LOCATION" \
      --runtime node --runtime-version 22 --functions-version 4 --os-type Linux

  say "Azure SQL logical server (Azure AD-only auth, you as admin)"
  MY_UPN="$(az ad signed-in-user show --query userPrincipalName -o tsv)"
  MY_OID="$(az ad signed-in-user show --query id -o tsv)"
  az sql server show --name "$SQL_SERVER" --resource-group "$RESOURCE_GROUP" &>/dev/null || \
    az sql server create --name "$SQL_SERVER" --resource-group "$RESOURCE_GROUP" \
      --location "$SQL_LOCATION" --enable-ad-only-auth \
      --external-admin-principal-type User \
      --external-admin-name "$MY_UPN" --external-admin-sid "$MY_OID"

  say "Azure SQL Database (Serverless, free tier)"
  az sql db show --name "$SQL_DATABASE" --server "$SQL_SERVER" --resource-group "$RESOURCE_GROUP" &>/dev/null || \
    az sql db create --name "$SQL_DATABASE" --server "$SQL_SERVER" --resource-group "$RESOURCE_GROUP" \
      --edition GeneralPurpose --family Gen5 --capacity 1 --compute-model Serverless \
      --use-free-limit --free-limit-exhaustion-behavior AutoPause \
      --backup-storage-redundancy Local

  say "SQL firewall: allow Azure services + this Cloud Shell session"
  az sql server firewall-rule create --resource-group "$RESOURCE_GROUP" --server "$SQL_SERVER" \
    --name AllowAzureServices --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0 || true
  MY_IP="$(curl -s ifconfig.me)"
  az sql server firewall-rule create --resource-group "$RESOURCE_GROUP" --server "$SQL_SERVER" \
    --name AllowDeployerIP --start-ip-address "$MY_IP" --end-ip-address "$MY_IP" || true

  echo -e "\nFunction App: https://${FUNCTION_APP}.azurewebsites.net"
  echo "SQL Server:   ${SQL_SERVER}.database.windows.net"
}

# ── STEP: App Registrations (api / spa / mail) ──────────────────────────
step_appregs() {
  say "App Registration #1 — it-portal-api (backs Easy Auth)"
  API_APP_ID="$(az ad app list --display-name it-portal-api --query '[0].appId' -o tsv)"
  if [ -z "$API_APP_ID" ]; then
    API_APP_ID="$(az ad app create --display-name it-portal-api --sign-in-audience AzureADMyOrg --query appId -o tsv)"
  fi
  API_OBJECT_ID="$(az ad app show --id "$API_APP_ID" --query id -o tsv)"
  az ad app update --id "$API_APP_ID" --identifier-uris "api://${API_APP_ID}"
  # A Service Principal (Enterprise Application) is required for admin consent to work
  # against this app — "az ad app create" alone does not create one.
  az ad sp create --id "$API_APP_ID" &>/dev/null || true

  SCOPE_ID="$(az ad app show --id "$API_APP_ID" --query "api.oauth2PermissionScopes[?value=='access_as_user'].id" -o tsv)"
  if [ -z "$SCOPE_ID" ]; then
    SCOPE_ID="$(uuidgen)"
    az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/${API_OBJECT_ID}" \
      --headers "Content-Type=application/json" \
      --body "{\"api\":{\"oauth2PermissionScopes\":[{\"id\":\"${SCOPE_ID}\",\"adminConsentDisplayName\":\"Access IT Portal API\",\"adminConsentDescription\":\"Allows the app to call the IT Portal API as the signed-in user.\",\"userConsentDisplayName\":\"Access IT Portal API\",\"userConsentDescription\":\"Allow the app to call the IT Portal API on your behalf.\",\"value\":\"access_as_user\",\"type\":\"User\",\"isEnabled\":true}]}}"
  fi

  say "App Registration #2 — it-portal-spa (public client, PKCE)"
  SPA_APP_ID="$(az ad app list --display-name it-portal-spa --query '[0].appId' -o tsv)"
  if [ -z "$SPA_APP_ID" ]; then
    SPA_APP_ID="$(az ad app create --display-name it-portal-spa --sign-in-audience AzureADMyOrg --query appId -o tsv)"
  fi
  SPA_OBJECT_ID="$(az ad app show --id "$SPA_APP_ID" --query id -o tsv)"
  az ad sp create --id "$SPA_APP_ID" &>/dev/null || true
  az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/${SPA_OBJECT_ID}" \
    --headers "Content-Type=application/json" \
    --body "{\"spa\":{\"redirectUris\":[\"${FRONTEND_URL}/index.html\"]}}"
  az ad app permission add --id "$SPA_APP_ID" --api "$API_APP_ID" --api-permissions "${SCOPE_ID}=Scope" || true
  az ad app permission admin-consent --id "$SPA_APP_ID" || \
    echo "  ⚠ admin-consent needs Global Admin — you have it, but if this failed grant it in the Portal: Entra ID → App registrations → it-portal-spa → API permissions → Grant admin consent"

  say "App Registration #3 — it-portal-mail (confidential client, Mail.Send)"
  MAIL_APP_ID="$(az ad app list --display-name it-portal-mail --query '[0].appId' -o tsv)"
  if [ -z "$MAIL_APP_ID" ]; then
    MAIL_APP_ID="$(az ad app create --display-name it-portal-mail --sign-in-audience AzureADMyOrg --query appId -o tsv)"
    az ad sp create --id "$MAIL_APP_ID" &>/dev/null || true
  fi
  MAIL_SECRET="$(az ad app credential reset --id "$MAIL_APP_ID" --append --query password -o tsv)"
  # Microsoft Graph app role "Mail.Send" (well-known GUID, application permission).
  az ad app permission add --id "$MAIL_APP_ID" --api 00000003-0000-0000-c000-000000000000 \
    --api-permissions b633e1c5-b582-4048-a93e-9f11b44c7e96=Role || true
  az ad app permission admin-consent --id "$MAIL_APP_ID" || \
    echo "  ⚠ admin-consent needs Global Admin — if this failed grant it in the Portal: Entra ID → App registrations → it-portal-mail → API permissions → Grant admin consent"

  say "Recommended hardening (optional, do it once Mail.Send works): scope the mail app to ONLY the shared mailbox with an Exchange Online ApplicationAccessPolicy — see infra/README.md."

  # Persist non-secret IDs for later steps / for you to hand back to Claude.
  cat > "${SCRIPT_DIR}/.provision-state" <<EOF
TENANT_ID=${TENANT_ID}
API_APP_ID=${API_APP_ID}
API_SCOPE_ID=${SCOPE_ID}
SPA_APP_ID=${SPA_APP_ID}
MAIL_APP_ID=${MAIL_APP_ID}
FUNCTION_APP=${FUNCTION_APP}
SQL_SERVER=${SQL_SERVER}
SQL_DATABASE=${SQL_DATABASE}
EOF
  # The one secret goes straight to the Function App below, and only there — never echoed.
  export MAIL_SECRET
  echo "$MAIL_SECRET" > "${SCRIPT_DIR}/.mail-secret.tmp"
  chmod 600 "${SCRIPT_DIR}/.mail-secret.tmp"

  echo -e "\nSaved non-secret IDs to infra/.provision-state — cat that file and paste its contents back."
}

# ── STEP: Easy Auth v2 on the Function App ──────────────────────────────
step_easyauth() {
  source "${SCRIPT_DIR}/.provision-state"
  say "Upgrading auth config to v2 (new Function Apps default to v1, which rejects 'az webapp auth set')"
  az webapp auth config-version upgrade --resource-group "$RESOURCE_GROUP" --name "$FUNCTION_APP" >/dev/null || true

  say "Configuring Easy Auth (App Service Authentication) — bearer-token validation only, no login redirect needed"
  TMP_JSON="$(mktemp)"
  sed -e "s#{{TENANT_ID}}#${TENANT_ID}#g" \
      -e "s#{{API_APP_ID}}#${API_APP_ID}#g" \
      -e "s#{{SPA_APP_ID}}#${SPA_APP_ID}#g" \
      "${SCRIPT_DIR}/authsettingsv2.template.json" > "$TMP_JSON"
  az webapp auth set --resource-group "$RESOURCE_GROUP" --name "$FUNCTION_APP" --body "@${TMP_JSON}" \
    || echo "  ⚠ CLI config failed — fall back to the Portal: Function App → Authentication → Add identity provider → Microsoft, App ID = ${API_APP_ID}, issuer https://login.microsoftonline.com/${TENANT_ID}/v2.0, then require authentication + Return 401. See infra/README.md."
  rm -f "$TMP_JSON"
}

# ── STEP: CORS ───────────────────────────────────────────────────────────
step_cors() {
  say "Locking CORS to ${FRONTEND_URL}"
  az functionapp cors remove --resource-group "$RESOURCE_GROUP" --name "$FUNCTION_APP" --allowed-origins "*" &>/dev/null || true
  az functionapp cors add --resource-group "$RESOURCE_GROUP" --name "$FUNCTION_APP" --allowed-origins "$FRONTEND_URL"
}

# ── STEP: Managed Identity + SQL grant ───────────────────────────────────
step_identity() {
  say "Assigning System-Assigned Managed Identity to the Function App"
  az functionapp identity assign --resource-group "$RESOURCE_GROUP" --name "$FUNCTION_APP" >/dev/null

  say "Granting that identity access to the SQL database"
  echo "Run this in the Azure Portal: SQL Database (${SQL_DATABASE}) → Query editor (sign in with your AAD account), then paste and run:"
  echo "----------------------------------------------------------------"
  sed "s#{{FUNCTION_APP_NAME}}#${FUNCTION_APP}#g" "${SCRIPT_DIR}/grant-identity.sql.template"
  echo "----------------------------------------------------------------"
  echo "(Portal Query editor avoids CLI/sqlcmd auth-flag guessing entirely — it's already signed in as you.)"
}

# ── STEP: schema + seed ──────────────────────────────────────────────────
step_schema() {
  say "Apply schema.sql and seed.sql"
  echo "Easiest path: Portal → SQL Database (${SQL_DATABASE}) → Query editor → open and run infra/schema.sql,"
  echo "then infra/seed.sql, in that order."
  echo
  echo "CLI alternative (needs sqlcmd, preinstalled in Cloud Shell):"
  echo "  sqlcmd -S ${SQL_SERVER}.database.windows.net -d ${SQL_DATABASE} -G --authentication-method ActiveDirectoryDefault -i infra/schema.sql"
  echo "  sqlcmd -S ${SQL_SERVER}.database.windows.net -d ${SQL_DATABASE} -G --authentication-method ActiveDirectoryDefault -i infra/seed.sql"
}

# ── STEP: App Settings ────────────────────────────────────────────────────
step_appsettings() {
  source "${SCRIPT_DIR}/.provision-state"
  if [ ! -f "${SCRIPT_DIR}/.mail-secret.tmp" ]; then
    echo "Missing infra/.mail-secret.tmp — run 'appregs' first."; exit 1
  fi
  MAIL_SECRET="$(cat "${SCRIPT_DIR}/.mail-secret.tmp")"
  say "Writing App Settings to the Function App (SQL connection info, Graph mail credentials, recipients)"
  az functionapp config appsettings set --resource-group "$RESOURCE_GROUP" --name "$FUNCTION_APP" --settings \
    "SQL_SERVER=${SQL_SERVER}.database.windows.net" \
    "SQL_DATABASE=${SQL_DATABASE}" \
    "GRAPH_TENANT_ID=${TENANT_ID}" \
    "GRAPH_CLIENT_ID=${MAIL_APP_ID}" \
    "GRAPH_CLIENT_SECRET=${MAIL_SECRET}" \
    "GRAPH_SENDER_MAILBOX=${SHARED_MAILBOX_UPN}" \
    "IT_COMPANY_EMAIL=${IT_COMPANY_EMAIL}" \
    "ADMIN_EMAIL=${ADMIN_EMAIL}" \
    "MAIL_SENDER_NAME=IT-Rami-Levy-Stock" \
    >/dev/null
  rm -f "${SCRIPT_DIR}/.mail-secret.tmp"
  echo "Done. The mail secret was written directly to the Function App and the temp file was deleted."
}

case "${1:-}" in
  resources)   step_resources ;;
  appregs)     step_appregs ;;
  easyauth)    step_easyauth ;;
  cors)        step_cors ;;
  identity)    step_identity ;;
  schema)      step_schema ;;
  appsettings) step_appsettings ;;
  all)
    step_resources
    step_appregs
    step_easyauth
    step_cors
    step_identity
    step_schema
    step_appsettings
    ;;
  *)
    echo "Usage: $0 {resources|appregs|easyauth|cors|identity|schema|appsettings|all}"
    exit 1
    ;;
esac
