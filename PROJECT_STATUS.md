# IT Portal — סטטוס פרויקט (עדכון אחרון: v2 חי, v2.1 מתוכנן)

מסמך זה קיים כדי שאפשר יהיה לפתוח שיחת Claude Code **חדשה** ולהמשיך לעבוד מיד, בלי לאבד
הקשר. עדכנו אותו בכל שינוי משמעותי (תשתית חדשה, פיצ'ר גדול שנגמר, גותצ'ה חדש שנתקלנו בו).

## מה זה הפרויקט

פורטל IT פנימי לחברת רמי לוי סטוק — עובדים פותחים קריאות שירות, רואים נהלים, IT מנהל
משתמשים/מחשבים. **v1** היה על Google Apps Script + Sheets, נבנה ב-repo הזה בכמה שלבים.
חשבון הגוגל שהריץ אותו (`itramilevystock@gmail.com`, אישי, לא Workspace) **נחסם לצמיתות**
ע"י גוגל (הפרת תנאי שימוש) — לכן **v2** הוא בנייה מחדש מלאה על Azure + Microsoft Entra ID,
תוך שימוש חוזר בעיצוב/לוגיקה עסקית של v1. v2 **חי בפרודקשן** ומאומת עובד.

## סטטוס נוכחי

- **v2 (Azure/Entra ID)**: חי ב-`https://it.ramilevystock.com` (GitHub Pages, ענף `main`).
  מאומת: SSO שקט עובד, Easy Auth מחזיר 401 נכון בלי טוקן, קוד ה-Backend פרוס ורץ, SQL זרוע.
- **v2.1 (התוכנית הבאה)**: **מתוכננת אבל לא בוצעה עדיין**. התוכן המלא למטה, בסעיף
  "תוכנית v2.1".
- PRs שכבר מוזגו ל-`main`: #2 (המיגרציה המלאה מ-Google ל-Azure), #3 (סופר-אדמין שני), #4
  (תיקון CDN של MSAL שהיה שבור).

## ארכיטקטורה

| רכיב | טכנולוגיה |
|---|---|
| Frontend | GitHub Pages (`index.html`+`common.js`+`common.css`, SPA בקובץ אחד, בלי build step) |
| אימות | MSAL.js מול Entra ID (SPA public client, PKCE) + `ssoSilent()` |
| Backend | Azure Functions Node.js, ראוטר entity/action יחיד ב-`api/src/functions/dispatch.js` |
| אימות בקשות | Easy Auth (App Service Authentication v2) — מאמת טוקן *לפני* שהקוד רץ |
| DB | Azure SQL Database Serverless (free tier), Managed Identity (בלי סיסמה) |
| מייל | Microsoft Graph `sendMail`, App Registration נפרד (`it-portal-mail`) |

## משאבי Azure אמיתיים (לא סודות — שמות/IDs בלבד)

- Subscription: `490fb4ad-cf82-4cc5-8f03-a476426b195f` ("Portal Rami-Levy-Stock")
- Tenant: `9831f885-99f6-47db-9d56-c5a7136ccfe7`
- Resource Group: `it-portal-rg`
- Function App: `it-portal-api-490fb4` — **Node 22** (לא 24, ראה גותצ'ות), northeurope
- Storage Account (של ה-Function App): `itportalst490fb4ne` — **northeurope, חייב** להיות
  באותו אזור בדיוק כמו ה-Function App
- SQL Server: `it-portal-sql-490fb4x` — **swedencentral** (לא northeurope — היחיד שקיבל
  יצירה בפועל אחרי כמה ניסיונות באזורים אחרים)
- SQL Database: `it-portal-db` (Serverless, free tier, autopause אחרי חוסר פעילות)
- App Registrations:
  - `it-portal-api` (`a211569e-5213-4ae4-8883-f03186890e58`) — מגבה את Easy Auth
  - `it-portal-spa` (`b9997216-1b46-41b5-b003-9ad947c3cc84`) — public client ל-MSAL
  - `it-portal-mail` (`cede0ded-eb70-4a34-a510-76683a03146f`) — Graph `Mail.Send`, שולח
    מ-`support@rami-levy-stock.co.il`
- Super Admins ב-DB (טבלת `Users`, `IsSuperAdmin=1`): `eran@rami-levy-stock.co.il`,
  `admin@rami-levy-stock.co.il`
- Service Principal לפריסה/ניהול (`it-portal-automation`) — נוצר לפי `infra/README.md`,
  ה-secret שלו **לא** נשמר בשום מקום קבוע; אם צריך שוב, ליצור מחדש (`az ad sp create-for-rbac`)

## גותצ'ות אמיתיים (חשוב לדעת לפני שנוגעים בתשתית)

1. **Node 24 לא יציב על Linux Consumption** — גרם ל-503 קבוע (גם על ה-app וגם על ה-SCM),
   לא נפתר בשום ריסטארט. חייב `--runtime-version 22`.
2. **Storage Account וFunction App חייבים להיות באותו אזור בדיוק** — אחרת 503 קבוע בלי
   שגיאה ברורה (תלות פנימית של ה-Consumption plan ב-content share).
3. **`SCM_DO_BUILD_DURING_DEPLOYMENT=true`** חובה כ-App Setting, אחרת פריסת zip "מצליחה"
   אבל אף פונקציה לא נרשמת (npm install אף פעם לא רץ).
4. **פריסה אמינה**: `func azure functionapp publish <name> --javascript` (מתוך `api/`,
   אחרי `npm install` מקומי) — הרבה יותר אמין מ-`az functionapp deploy`/`config-zip` שנכשלו
   בשקט בהרצה בפועל.
5. **`az ad app create` לא יוצר Service Principal** — בלי `az ad sp create --id <appId>`
   בנוסף, admin consent נכשל עם "no subscription/service principal for this API".
6. **CDN של MSAL**: `alcdn.msauth.net` החזיר 404 בכל גרסה שניסינו — עברנו ל-jsDelivר
   (`https://cdn.jsdelivr.net/npm/@azure/msal-browser@3.27.0/lib/msal-browser.min.js`).
7. **Azure "תופס" שמות גלובליים** (Storage/Function/SQL Server) לזמן-מה גם אחרי יצירה
   שנכשלה — אם מקבלים "already exists in location X" אבל `show` מחזיר ResourceNotFound,
   זה הבאג הזה; הפתרון הוא שם חדש.
8. תיעוד מלא + סקריפט provisioning אידמפוטנטי: `infra/provision.sh` + `infra/README.md`.

## ארכיטקטורת קוד (דפוסים לשמור עליהם בהמשך)

- `api/src/entities/*.js` — דפוס אחיד: `rowToX()` (המרת שורת SQL לאובייקט camelCase),
  `list`/`create`/`update`/`remove`, **בדיקת הרשאה בשורה הראשונה** של כל handler מול
  `caller.isSuperAdmin`/`isITAdmin`/`isProceduresAdmin` (מגיע מ-`dispatch.js`, לעולם לא
  מהלקוח).
- `api/src/functions/dispatch.js` — HTTP trigger יחיד, ראוטר `{entity, action}`, טוען את
  זהות המתקשר **רק** מ-Easy Auth header (`x-ms-client-principal`), לעולם לא מפרמטר שהלקוח
  שלח.
- `infra/schema.sql`/`seed.sql` — idempotent (`IF NOT EXISTS` על כל `CREATE`), מותר להריץ
  שוב בלי נזק.
- `index.html` — SPA בקובץ אחד, `showView(id)` מחליף `.app.active`, מודלים כ-
  `<div class="profile-modal-backdrop">` standalone.
- `common.js` — MSAL init + `apiGet`/`apiPost` helpers שמצרפים Bearer token אוטומטית.

## תוכנית v2.1 — עדיין לא בוצעה

המשתמש בדק את v2 בדפדפן בפועל ומצא סדרת פערים/בקשות. **התוכנית המלאה, מפורטת לפי סעיפים,
נמצאת למטה** — זה בדיוק מה שצריך להתחיל לבצע בשיחה החדשה.

### הקשר לתוכנית
v2 עובד אבל: אין הגבלת גישה רשתית אמיתית, סניפים/תיקיות משותפות הם טקסט חופשי, אין דרך
מסודרת להקים משתמש חדש, תור הקריאות לא מספיק בולט/שימושי, מודלים מאבדים קלט בקליק בטעות,
יש באג בטבלת מחשבים, טופס פתיחת קריאה עמוס מדי, ואין קטלוג מדפסות.

### החלטות שכבר סוכמו (לא לשאול שוב)
- **סעיף הקמת משתמשים הוא script-generation בלבד** — הפורטל **לא** יוצר/משנה משתמשים
  אוטומטית ב-365 (המשתמש שקל את זה ואז חזר בו במפורש). IT תמיד מריץ ידנית. App Registration
  `it-portal-graph` (חדש, לכתוב) מקבל **רק** `User.Read.All` (read-only) — בלי הרשאות כתיבה
  בשום מקום.
- ניהול סניפים/תיקיות משותפות — Super Admin בלבד.
- IP יורד **לגמרי** משדה יצירת/עריכת מחשב (לא רק אופציונלי) — לא רלוונטי יותר.
- מודלי עריכה: קליק על הרקע **לא סוגר בכלל** — רק כפתור "ביטול", עם אזהרה אם יש קלט
  שהשתנה.
- טופס פתיחת קריאה נבנה מחדש כמעט מאפס — צר בהרבה, שורת סיכום + 2 עפרונות במקום 7 שדות.

### נקודה פתוחה יחידה שנשארה
**Cloudflare**: האם ה-DNS של `it.ramilevystock.com` כבר proxied (ענן כתום) דרך Cloudflare,
ואיזו תוכנית Zero Trust יש? זה קובע אם סעיף 1 (הגבלת גישה) הוא Cloudflare Access + Entra
Conditional Access, או Conditional Access בלבד.

---

### סעיף 1 — הגבלת גישה רשתית

GitHub Pages עצמו לא יודע להגביל IP. אם `it.ramilevystock.com` proxied דרך Cloudflare —
Cloudflare Access (Zero Trust) יכול: Allow אם (IP ∈ 3 כתובות הסניפים) **או** (זהות Entra ID
מאומתת + משתמש/קבוצה מורשית) — בדיוק "לאפשר למחשבים/משתמשים ספציפיים גישה מרחוק". בנוסף,
Conditional Access ב-Entra ID (כלול ב-Business Premium) כשכבת הגנה שנייה על ה-API/SPA
עצמם. שתי המדיניות הן הקמה ידנית ב-Portal-ים המתאימים (Cloudflare dashboard + Entra ID),
לא קוד — לתעד ב-`infra/README.md`.

### סעיף 2 — ניהול סניפים (Branches)

טבלה חדשה `Branches (Number INT PK, Name NVARCHAR(100))`. זרע: `0=מרוחק (ניידים)`,
`1=פרדס חנה`, `2=רמלה`. `Users.Branch`/`Computers.Branch` (טקסט חופשי היום) → `BranchNumber
INT NULL` FK. `Tickets.Branch` **נשאר טקסט חופשי** (snapshot היסטורי בכוונה) אבל מתמלא
מתוך הבחירה. **חשוב**: סניף = שדה Department ב-365 (ראה סעיף 4) — חוץ מ"מרוחק" שנשאר ריק.
Backend: `api/src/entities/branches.js` (list=כולם, CUD=SuperAdmin). Frontend: view/modal
אדמין חדש, כל `<input>` טקסט לסניף הופך ל-`<select>`.

### סעיף 3 — תיקיות משותפות (קבוצות Entra ID = אתרי SharePoint)

טבלה `SharedFolders (Id UNIQUEIDENTIFIER PK, Name NVARCHAR(100), EntraGroupObjectId
NVARCHAR(50))`. Object ID (לא רק שם) כדי שהסקריפט (סעיף 4) יוכל להוסיף חברים בלי חיפוש-
לפי-שם שביר. זרע: הנהלת חשבונות/משאבי אנוש/סחר/שיווק/תפעול — Object ID של כל קבוצה נמצא
ידנית ב-Entra ID → Groups → [קבוצה] בפעם הראשונה. אותו דפוס backend/frontend כמו סניפים.

### סעיף 4 — מודל משתמשים: סנכרון נכנס מ-365 (read-only) + הקמת משתמש = סקריפט

**אין קריאת כתיבה ל-Graph משום מקום בקוד.** IT תמיד מריץ ידנית.

**4א — סנכרון נכנס**: App Registration `it-portal-graph`, `User.Read.All` בלבד. `users.
syncFromEntra` (SuperAdmin) — `GET /users` מ-Graph, upsert לפי UPN: חדשים נוספים עם פרופיל
ריק, קיימים לא נדרסים, עוזבים לא נמחקים אוטומטית (רק ספירה מוצגת).

**4ב — בקשת הקמת משתמש**: הרשאה חדשה `Users.IsUserRequestSubmitter BIT` (SuperAdmin
בלבד מעניק, checkbox נוסף לצד IsITAdmin/IsProceduresAdmin). טבלה `UserRequests`
(RequestId, RequestNumber `NU-####`, Timestamp, RequesterEmail/Name, FirstNameHe,
LastNameHe, FirstNameEn, LastNameEn, BranchNumber FK, Role, SuggestedEmail, TempPassword
— נוצרת אקראית פעם אחת, Status [`ממתינה`/`הוקם`], ReviewedByEmail, ReviewedAt) +
`UserRequestFolders (RequestId, SharedFolderId)`. חישוב מייל **בצד שרת בלבד**:
`firstNameEn.toLowerCase() + '.' + lastNameEn.slice(0,2).toLowerCase() +
'@rami-levy-stock.co.il'` (eran+vana → eran.va@...). Department = שם הסניף (ריק ל"מרוחק").

זרימה: טופס (שם עברית+אנגלית, סניף, תפקיד, תיקיות מרובות-בחירה) → `userRequests.create`
(שולח מייל ל-IT כמו קריאה, מייצר סיסמה זמנית). IT פותח בתור ייעודי, **יכול לערוך כל שדה** —
כל עריכה קוראת ל-`userRequests.previewScript` שמחזירה סקריפט מעודכן (הלוגיקה תמיד בשרת).
סקריפט ב-`<textarea readonly>` + כפתור העתקה. אחרי הרצה ידנית ב-Cloud Shell, כפתור "סימון
כהוקם" (`userRequests.markCompleted`) → Status=`הוקם` **ופותח תיבת-העתקה שנייה**: הודעת
ברוכים-הבאים למשתמש (מייל+סיסמה זמנית+הנחיית שינוי בכניסה ראשונה).

תוכן הסקריפט (Graph PowerShell, בהנחת cloud-only — אין אזכור AD מקומי בפרויקט; אם יש,
להחליף ל-`New-ADUser`):
```powershell
Connect-MgGraph -Scopes "User.ReadWrite.All","Group.ReadWrite.All"
$pw = ConvertTo-SecureString "<TempPassword>" -AsPlainText -Force
$user = New-MgUser -DisplayName "<שם עברית>" -UserPrincipalName "<מייל>" `
  -MailNickname "<local-part>" -AccountEnabled `
  -PasswordProfile @{Password=$pw; ForceChangePasswordNextSignIn=$true} `
  -GivenName "<EN>" -Surname "<EN>" -JobTitle "<תפקיד>" -Department "<סניף, ריק אם מרוחק>" `
  -UsageLocation "IL"
Add-MgGroupMember -GroupId "<Object ID תיקייה 1>" -DirectoryObjectId $user.Id
```

**4ג — הוספה ידנית** דרך "ניהול משתמשים": אותו מנגנון — כפתור "הכן סקריפט הקמה" (ראה
סעיף 11 לשינויי UX של הטופס הזה).

### סעיף 5 — דשבורד קריאות בדף הבית

**לא (רק) view נפרד** — בלוק מעוצב **בתוך `view-hub`** עצמו, בין הקוביות, ל-IT Admin בלבד:
3 מונים בולטים (פתוחות/בטיפול/סגורות), פירוט קומפקטי לפי סניף, רשימת קריאות פתוחות/
בטיפול עם קליק→מודל פרטים קיים. בתוך מודל הפרטים: שדה+כפתור "הוסף הערה" (קורא ל-
`tickets.updateStatus` עם `message` בלבד, בלי שינוי status, מרענן timeline מיד). Toggle
סגורות בתוך הבלוק. מיון/סינון לפי משתמש בצד לקוח. רענון אוטומטי כל 20-30 שניות
(`setInterval`, מבוטל בניווט). ה-view המלא הקיים (`view-admin-tickets`) יכול להישאר
כ"לכל הקריאות" מהבלוק.

### סעיף 6 — מודלים: רק כפתור ביטול סוגר

מסירים לגמרי את listener ה-backdrop-click מכל מודלי עריכה (קיים היום: `if (e.target ===
this) close...()`). **רק** כפתור "ביטול" סוגר, ובודק `dirty` (מופעל ב-`input`/`change`
הראשון אחרי פתיחה) לפני סגירה — `confirm('יש נתונים שלא נשמרו — לצאת בכל זאת?')`.
`common.js`: `confirmDiscard(dirty)`. חל על: פרופיל, משתמש-אדמין, מחשב-אדמין, נוהל, עריכת
קריאה, בקשת הקמת משתמש.

### סעיף 6.5 — פורמט טלפון

מסכת קלט ל-`XXX-XXX-XXXX` על אירוע `input` (JS פשוט, בלי ספרייה). בכל שדה טלפון (פרופיל,
משתמש-אדמין, קריאה).

### סעיף 7 — תיקון + שיפור ניהול מחשבים

**קודם כל לשחזר את השגיאה בפועל** (לא לנחש) — לפתוח מודל "מחשב חדש", למלא שם, לשמור,
ולתעד את השגיאה המדויקת (טקסט בפאנל + F12→Network→Response). מ-`api/src/entities/
computers.js` הקיים אין תיאוריה חזקה — נראה תקין בבדיקת קוד. IP **יורד לגמרי** מהטופס
(לא רק לא-חובה). ולידציה מקומית (שם חובה+כפילות לפני שליחה), מצב טעינה, הודעות ברורות.
AnyDesk quick-connect כבר קיים (`anydesk:` link) — לשמר.

### סעיף 8 — קטלוג מדפסות + ניתוב מייל חיצוני

טבלה `Printers (PrinterName PK, IP, BranchNumber FK, Notes)`. `Computers` מקבל
`DefaultPrinterName NULL` FK (מחליף שדה `Printer` חופשי — migration חד-פעמי). Backend:
`printers.js` (IT Admin CRUD). `tickets.create` מקבל `printerName` אופציונלי — אם קיים,
`sendTicketEmails` שולח ל-`PRINTER_SUPPORT_EMAIL` (App Setting חדש) **במקום**
`IT_COMPANY_EMAIL`/`ADMIN_EMAIL`. Frontend: toggle "עבור: המחשב שלי/מדפסת" בטופס קריאה —
כשבוחרים מדפסת, `<select>` **מסונן לפי סניף המשתמש**, עם **ברירת מחדל** =
`DefaultPrinterName` של המחשב המשוייך (ניתן לשינוי).

### סעיף 10 — עיצוב מחדש טופס פתיחת קריאה

הטופס הנוכחי (7 שדות read-only) "נראה רע ושבור" — לבנות מחדש: שורה אחת **"פותח/ת קריאה
בשם [שם] על [מחשב]"** עם עיפרון ✏️ ליד כל ערך — עיפרון שם → טקסט חופשי להחלפה *לקריאה זו
בלבד*; עיפרון מחשב → `<select>` למחשב אחר או מדפסת (סעיף 8). טלפון/סניף/IP/מדפסת הישנים
**לא מוצגים** (עדיין נשלחים לשרת מהפרופיל/בחירה). קטגוריה/דחיפות/תיאור נשארים כמו שהיו.

### סעיף 11 — UX טופס "הוסף משתמש"

מייל: שדה מקבל **רק username** (לפני ה-@), `@Rami-Levy-Stock.co.il` מוצג כסיומת קבועה,
השרת מרכיב את הכתובת המלאה. הוספת multi-select תיקיות משותפות. checkbox חדש "מורשה להקמת
משתמשים" (`IsUserRequestSubmitter`) לצד השאר, רק ל-SuperAdmin. כפתור "הכן סקריפט הקמה".

### סדר ביצוע מוצע
0. (בוצע) המסמך הזה.
1. סכימה מרוכזת: Branches, SharedFolders, Printers, UserRequests(+folders), כל ה-FK
   changes, בבת אחת ב-`schema.sql`/`seed.sql`.
2. Backend+Frontend לסעיפים 2+3 (הכי פשוטים, בסיס לשאר).
3. תיקון סעיף 7 (מחשבים, כולל הסרת IP) + סעיף 6 (מודלים) + 6.5 (טלפון) + 4א (סנכרון
   נכנס, read-only) — win מהיר, לא תלוי בכלום. App Registration `it-portal-graph`.
4. סעיף 4ב+4ג+11 (הקמת משתמש → סקריפט) — תלוי בסניפים+תיקיות משלב 2.
5. סעיף 8 (מדפסות) — תלוי בסניפים.
6. סעיף 5 (דשבורד) + סעיף 10 (טופס קריאה מחדש).
7. סעיף 1 (Cloudflare+Conditional Access) — checklist ל-README, לביצוע ידני מתי שנוח.

### אימות
- כל endpoint חדש: לבדוק admin וגם משתמש רגיל (403 כשצריך) לפני שנחשב גמור.
- טופס בקשת משתמש: מייל מחושב זהה בשרת ובלקוח, עריכה מרעננת את הסקריפט.
- הסקריפט: להריץ פעם אחת בפועל על **משתמש טסט** (לא עובד אמיתי) לפני שסומכים עליו.
- מדפסות: קריאה עבור מדפסת → מייל מגיע לתמיכת המדפסות, לא ל-IT; ברירת מחדל נכונה.
- מודלים: קליק על רקע לא סוגר כלום; ביטול עם dirty=true מציג אזהרה.

---

## איך להתחיל שיחה חדשה

פתח שיחת Claude Code חדשה בריפו הזה (`eranbhw/it.ramilevystock.com`) ותכתוב:

> קרא את `PROJECT_STATUS.md` בשורש הריפו. תתחיל לבצע את תוכנית v2.1 המתועדת שם, בסדר
> הביצוע המוצע (סעיף 1 בסכימה, אח"כ 2, וכו'). אם יש לך שאלת הבהרה בדרך, תשאל.

זה מספיק כדי להתחיל ישר בעניינים בלי לחזור על כל ההקשר.
