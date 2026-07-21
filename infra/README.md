# הקמת תשתית Azure — IT Portal v2

הרצה מ-**Azure Cloud Shell** (portal.azure.com → `>_` → Bash), עם משתמש Global Admin.

## לפני שמתחילים

ודא שכבר הרצת (משלב הקמת ה-Service Principal):

```bash
az account show --query id -o tsv
az group create --name it-portal-rg --location israelcentral
az ad sp create-for-rbac --name "it-portal-automation" --role Contributor \
  --scopes /subscriptions/<SUBSCRIPTION_ID>/resourceGroups/it-portal-rg
```

(שמור את `appId`/`password`/`tenant` בצד — הם ישמשו את ה-GitHub Actions workflow
שמפרוס קוד ל-Function App, לא נחוצים לסקריפט הזה.)

## הרצה

```bash
git clone https://github.com/eranbhw/it.ramilevystock.com.git
cd it.ramilevystock.com/infra
chmod +x provision.sh
```

לפני ההרצה — פתח את `provision.sh` ועדכן את בלוק "EDIT THESE" בראש הקובץ, בעיקר:
- `SHARED_MAILBOX_UPN` / `IT_COMPANY_EMAIL` / `ADMIN_EMAIL` — כתובות אמיתיות בארגון.
- `LOCATION` — אם `israelcentral` נכשל (לא כל המשאבים זמינים בכל אזור), שנה ל-`westeurope`.

הרץ הכל ברצף:

```bash
./provision.sh all
```

או שלב-שלב (מומלץ בפעם הראשונה, כדי לעצור אם משהו נכשל):

```bash
./provision.sh resources     # Function App, Storage, SQL Server+DB, firewall
./provision.sh appregs       # 3 App Registrations (api/spa/mail) + הרשאות
./provision.sh easyauth      # Easy Auth v2 על ה-Function App
./provision.sh cors          # CORS מוגבל לדומיין של GitHub Pages
./provision.sh identity      # Managed Identity + פקודת ה-SQL להרצה ידנית
./provision.sh schema        # הנחיות להרצת schema.sql + seed.sql
./provision.sh appsettings   # הגדרות + הסוד של Graph נכתבים ישירות ל-Function App
```

בסוף `appregs` נוצר קובץ `infra/.provision-state` (לא נכנס ל-git) עם ה-IDs
הלא-רגישים. **תעביר לי את התוכן שלו** — זה מה שאני צריך כדי לכתוב את קוד ה-Functions
וה-frontend מול ה-IDs האמיתיים:

```bash
cat .provision-state
```

## GitHub Actions — פריסת הקוד (`api/`) בכל push

כדי ש-`.github/workflows/deploy-functions.yml` יוכל לפרוס, יש להגדיר ב-GitHub
(Settings → Secrets and variables → Actions):

1. **Variable** (לא secret) `AZURE_FUNCTIONAPP_NAME` = שם ה-Function App (מה-`.provision-state`).
2. אחת משתי אפשרויות אימות:
   - **OIDC (מומלץ, בלי סוד מאוחסן)**: 3 Secrets — `AZURE_CLIENT_ID` (ה-`appId` של
     `it-portal-automation`), `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`. ובנוסף פעם
     אחת, ב-Cloud Shell:
     ```bash
     az ad app federated-credential create --id <it-portal-automation appId> --parameters '{
       "name": "github-actions-main",
       "issuer": "https://token.actions.githubusercontent.com",
       "subject": "repo:eranbhw/it.ramilevystock.com:ref:refs/heads/main",
       "audiences": ["api://AzureADTokenExchange"]
     }'
     ```
   - **Publish profile (פשוט יותר, סוד יחיד)**: Function App → Overview → *Get publish
     profile* → מוסיפים כ-Secret בשם `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` ב-GitHub, ומעדכנים
     את השלב הרלוונטי ב-workflow (מתועד כהערה בקובץ עצמו). לא עובר בצ'אט בשום שלב.

## שלבים שדורשים UI (לא ניתנים ל-CLI בביטחון)

### תיבת דואר משותפת (Exchange Online)
ב-Exchange Admin Center או PowerShell (`Connect-ExchangeOnline`):
```powershell
New-Mailbox -Shared -Name "IT Portal" -DisplayName "IT Portal" -Alias it-support
```
כתובת התיבה חייבת להתאים ל-`SHARED_MAILBOX_UPN` בסקריפט.

**הקשחה מומלצת** (לא חובה בשלב ראשון): להגביל את `it-portal-mail` App Registration
כך שיוכל לשלוח **רק** מהתיבה הזו, לא מכל תיבה בארגון:
```powershell
New-ApplicationAccessPolicy -AppId <MAIL_APP_ID> -PolicyScopeGroupId it-support@rami-levy-stock.co.il `
  -AccessRight RestrictAccess -Description "IT Portal mail app — shared mailbox only"
```

### schema.sql / seed.sql / grant-identity.sql
הדרך הפשוטה ביותר: Portal → SQL databases → `it-portal-db` → **Query editor (preview)**,
מתחבר עם החשבון שלך (AAD) ישירות מהדפדפן — בלי צורך בפקודות `sqlcmd`/דגלי אימות.
פותחים את `schema.sql`, מדביקים ומריצים; אז `seed.sql`; ואחרי `provision.sh identity`,
את הפלט של `grant-identity.sql.template` (עם השם האמיתי של ה-Function App כבר מוצב).

### Easy Auth — אם `./provision.sh easyauth` נכשל
Function App → **Authentication** → Add identity provider → Microsoft →
- App registration: Pick an existing app registration → `it-portal-api`
- Client secret: לא נדרש (מאמתים רק bearer token, אין login redirect)
- Issuer URL: `https://login.microsoftonline.com/<TENANT_ID>/v2.0`
- Restrict access: Require authentication
- Unauthenticated requests: HTTP 401 Unauthorized

### Intune — כניסה אוטומטית (שלב ה' בתוכנית הראשית)
Intune admin center → Devices → Configuration → **Settings Catalog** →
קטגוריה **Microsoft Edge** → "Action on startup" = *Open a list of URLs*,
"Startup URLs" = `https://it.ramilevystock.com` → שיוך לקבוצת המכשירים הרלוונטית.
אין צורך בשום קובץ התקנה/קיצור דרך — זו מדיניות בלבד.

## תקלות אמיתיות שנתקלנו בהן בהרצה בפועל (שווה להכיר)

- **Node 24 לא יציב על Linux Consumption** — גרם ל-503 קבוע על האתר וגם על ה-SCM,
  ולא נפתר בשום ריסטארט/תיקון אחר. המעבר ל-`--runtime-version 22` (כבר מוגדר
  בסקריפט) פתר מיידית. אם בעתיד `provision.sh` ישודרג לגרסת Node חדשה יותר —
  לבדוק קודם שהיא באמת עובדת על Linux Consumption (לא רק מופיעה ב-
  `az functionapp list-runtimes`).
- **Storage Account חייב להיות **באותו אזור** בדיוק כמו ה-Function App** —
  אחרת ה-Consumption plan נתקע ב-503 קבוע בלי שגיאה ברורה. הסקריפט בודק את זה
  עכשיו ונכשל בבירור אם יש חוסר-התאמה, במקום להיכשל בשקט.
- **`SCM_DO_BUILD_DURING_DEPLOYMENT=true`** חובה כדי ש-Azure יריץ `npm install`
  בזמן פריסה. בלעדיו, פריסת zip "מצליחה" (exit code 0) אבל שום פונקציה לא
  נרשמת בפועל כי `node_modules` אף פעם לא הותקן.
- **Deploy אמין**: אם `az functionapp deploy`/`config-zip` מחזירים הצלחה
  מפוקפקת (בלי פלט, בלי רישום ב-deployment history) — `func azure functionapp
  publish <name> --javascript` (מתוך תיקיית `api/`, אחרי `npm install` מקומי)
  הרבה יותר אמין ומדפיס בבירור אילו functions זוהו בסוף.
- **`az ad app create` לא יוצר Service Principal** לאפליקציה — בלי זה, admin
  consent נכשל עם "Your organization does not have a subscription (or service
  principal) for the following API(s)". צריך `az ad sp create --id <appId>`
  בנוסף (כבר מתוקן בסקריפט לכל שלוש האפליקציות).
- **SQL Serverless נרדם** (`autoPauseDelay` — אחרי חוסר פעילות) — כל חיבור
  ראשון אחרי תקופת שקט ייכשל/יתעכב כמה עשרות שניות בזמן שהוא מתעורר. נסו שוב.
- שמות גלובליים (Storage Account, Function App, SQL Server) שנכשלו ביצירה
  **נשארים "תפוסים"** לזמן מה גם אם המשאב מעולם לא נוצר בפועל — אם מקבלים
  "already exists in location X" למרות ש-`show` מחזיר ResourceNotFound, זה
  באג ידוע ב-Azure; הפתרון הוא שם חדש.

## ייבוא חד-פעמי של משתמשים קיימים מ-365 (v2.1, סעיף 4א — עודכן)

**הוחלט מפורשות: לפורטל אין ולא יהיה שום App Registration עם הרשאת Graph על משתמשים —
לא קריאה, לא כתיבה, לא מחיקה, לא הוספה.** שום סוד/credential קבוע לא יושב באוויר עם
גישה לספריית המשתמשים. הקמת/עדכון משתמשים ב-Entra ID תמיד ידני, דרך הסקריפט שהפורטל
מייצר (ראה PROJECT_STATUS.md סעיף 4ב/4ג) שרץ תחת ההתחברות האישית של IT.

כדי לאכלס את `Users` בפעם הראשונה עם המשתמשים הקיימים כבר ב-365, יש תהליך חד-פעמי:

1. **אתה** מריץ את `infra/export-entra-users.ps1` (ב-Cloud Shell או PowerShell מקומי עם
   מודול Microsoft.Graph) — מתחבר עם `Connect-MgGraph` תחת **ההתחברות האישית שלך**
   (delegated, לא app-only), לא דרך שום App Registration של הפורטל. מייצא משתמשי Member
   פעילים בלבד (לא אורחים, לא מושבתים) ל-`entra-users-export.json`.
2. מעביר לי (ל-Claude, בשיחה) את הקובץ.
3. אני מריץ `node infra/generate-user-seed.js entra-users-export.json` שמתאים כל משתמש
   לפי `department` לטבלת `Branches` (התאמה מדויקת בלבד — אחרת נשאר `NULL`, לתקן ידנית
   בפורטל) ומייצר `infra/bootstrap-users.sql` — כל שורה מוגנת (`IF NOT EXISTS`), בטוח
   להריץ גם אם חלק מהמשתמשים כבר קיימים (למשל שני ה-SuperAdmin הזרועים).
4. אתה מריץ את `infra/bootstrap-users.sql` פעם אחת דרך Portal → SQL Database → Query
   editor (אותו תהליך כמו `schema.sql`/`seed.sql`).

מהנקודה הזו והלאה — **כל ניהול המשתמשים דרך מסך "ניהול משתמשים" בפורטל בלבד**, ידני
לגמרי, בלי שום סנכרון אוטומטי חוזר מ-365.

## אבטחה

- ה-secret היחיד שנוצר (Graph mail client secret) נכתב ישירות ל-App Settings של
  ה-Function App ומעולם לא מודפס למסך — הקובץ הזמני שמכיל אותו נמחק בסוף `appsettings`.
- ה-Function App מתחבר ל-SQL עם ה-Managed Identity שלו, בלי סיסמה בכלל.
- `IsSuperAdmin` לא ניתן לשינוי משום endpoint — רק `seed.sql`/גישה ישירה ל-DB.
