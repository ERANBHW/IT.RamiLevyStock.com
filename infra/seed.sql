-- IT Portal v2 — initial seed. Run once, after schema.sql.
-- Creates the initial Super Admin rows. IsSuperAdmin can never be granted through
-- any API endpoint — this INSERT is the only way that flag is ever set to 1.

-- FirstName/LastName left blank on purpose (not guessed) — editable from the profile
-- page on first login, same EDITABLE_PROFILE_FIELDS flow as every other user in v1.
IF NOT EXISTS (SELECT 1 FROM Users WHERE Email = N'eran@rami-levy-stock.co.il')
INSERT INTO Users (Email, FirstName, LastName, IsSuperAdmin, IsITAdmin, IsProceduresAdmin)
VALUES (N'eran@rami-levy-stock.co.il', N'', N'', 1, 1, 1);
GO

IF NOT EXISTS (SELECT 1 FROM Users WHERE Email = N'admin@rami-levy-stock.co.il')
INSERT INTO Users (Email, FirstName, LastName, IsSuperAdmin, IsITAdmin, IsProceduresAdmin)
VALUES (N'admin@rami-levy-stock.co.il', N'', N'', 1, 1, 1);
GO

-- v2.1, section 2 — Branches
IF NOT EXISTS (SELECT 1 FROM Branches WHERE Number = 0)
INSERT INTO Branches (Number, Name) VALUES (0, N'מרוחק (ניידים)');
GO
IF NOT EXISTS (SELECT 1 FROM Branches WHERE Number = 1)
INSERT INTO Branches (Number, Name) VALUES (1, N'פרדס חנה');
GO
IF NOT EXISTS (SELECT 1 FROM Branches WHERE Number = 2)
INSERT INTO Branches (Number, Name) VALUES (2, N'רמלה');
GO

-- v2.1, section 3 — Shared folders, seeded by name only. Each row's
-- EntraGroupObjectId is looked up manually in Entra ID → Groups and filled in
-- later via the SuperAdmin "תיקיות משותפות" screen — not guessable, not a secret.
IF NOT EXISTS (SELECT 1 FROM SharedFolders WHERE Name = N'הנהלת חשבונות')
INSERT INTO SharedFolders (Name, EntraGroupObjectId) VALUES (N'הנהלת חשבונות', '');
GO
IF NOT EXISTS (SELECT 1 FROM SharedFolders WHERE Name = N'משאבי אנוש')
INSERT INTO SharedFolders (Name, EntraGroupObjectId) VALUES (N'משאבי אנוש', '');
GO
IF NOT EXISTS (SELECT 1 FROM SharedFolders WHERE Name = N'סחר')
INSERT INTO SharedFolders (Name, EntraGroupObjectId) VALUES (N'סחר', '');
GO
IF NOT EXISTS (SELECT 1 FROM SharedFolders WHERE Name = N'שיווק')
INSERT INTO SharedFolders (Name, EntraGroupObjectId) VALUES (N'שיווק', '');
GO
IF NOT EXISTS (SELECT 1 FROM SharedFolders WHERE Name = N'תפעול')
INSERT INTO SharedFolders (Name, EntraGroupObjectId) VALUES (N'תפעול', '');
GO

-- v2.1, section 7 — ticket categories, migrated 1:1 from the old hardcoded
-- TICKET_CATEGORIES list so nothing changes for users on first deploy; IT Admins can
-- add/rename/remove from here on via the new admin screen.
IF NOT EXISTS (SELECT 1 FROM TicketCategories WHERE Name = N'מחשב / Windows')
INSERT INTO TicketCategories (Name, [Order]) VALUES (N'מחשב / Windows', 1);
GO
IF NOT EXISTS (SELECT 1 FROM TicketCategories WHERE Name = N'Outlook / דואר אלקטרוני')
INSERT INTO TicketCategories (Name, [Order]) VALUES (N'Outlook / דואר אלקטרוני', 2);
GO
IF NOT EXISTS (SELECT 1 FROM TicketCategories WHERE Name = N'Microsoft 365')
INSERT INTO TicketCategories (Name, [Order]) VALUES (N'Microsoft 365', 3);
GO
IF NOT EXISTS (SELECT 1 FROM TicketCategories WHERE Name = N'מדפסת / סורק')
INSERT INTO TicketCategories (Name, [Order]) VALUES (N'מדפסת / סורק', 4);
GO
IF NOT EXISTS (SELECT 1 FROM TicketCategories WHERE Name = N'אינטרנט / רשת')
INSERT INTO TicketCategories (Name, [Order]) VALUES (N'אינטרנט / רשת', 5);
GO
IF NOT EXISTS (SELECT 1 FROM TicketCategories WHERE Name = N'תוכנה ארגונית')
INSERT INTO TicketCategories (Name, [Order]) VALUES (N'תוכנה ארגונית', 6);
GO
IF NOT EXISTS (SELECT 1 FROM TicketCategories WHERE Name = N'הרשאות / סיסמה')
INSERT INTO TicketCategories (Name, [Order]) VALUES (N'הרשאות / סיסמה', 7);
GO
IF NOT EXISTS (SELECT 1 FROM TicketCategories WHERE Name = N'ציוד היקפי')
INSERT INTO TicketCategories (Name, [Order]) VALUES (N'ציוד היקפי', 8);
GO
IF NOT EXISTS (SELECT 1 FROM TicketCategories WHERE Name = N'אחר')
INSERT INTO TicketCategories (Name, [Order]) VALUES (N'אחר', 9);
GO

-- Dynamic subcategory example (as requested): "מדפסת / סורק" offers a live list of the
-- printers in the caller's branch (all branches if the caller is at "מרוחק"), reusing
-- the same Printers catalog + populatePrinterSelect() already used elsewhere.
IF NOT EXISTS (SELECT 1 FROM TicketSubcategories s JOIN TicketCategories c ON c.Id = s.CategoryId
               WHERE c.Name = N'מדפסת / סורק' AND s.Name = N'בחר מדפסת')
INSERT INTO TicketSubcategories (CategoryId, Name, IsDynamic, DynamicSource, [Order])
SELECT Id, N'בחר מדפסת', 1, 'printers-by-branch', 1 FROM TicketCategories WHERE Name = N'מדפסת / סורק';
GO

-- v2.1, section 7 — urgency levels, migrated 1:1 from the old hardcoded TICKET_URGENCIES
-- list/colors so nothing changes visually on first deploy.
IF NOT EXISTS (SELECT 1 FROM TicketUrgencyLevels WHERE Name = N'רגילה')
INSERT INTO TicketUrgencyLevels (Name, Description, ColorHex, Severity, [Order]) VALUES (N'רגילה', N'ניתן להמשיך לעבוד', '#edd76f', 1, 1);
GO
IF NOT EXISTS (SELECT 1 FROM TicketUrgencyLevels WHERE Name = N'גבוהה')
INSERT INTO TicketUrgencyLevels (Name, Description, ColorHex, Severity, [Order]) VALUES (N'גבוהה', N'העבודה נפגעה משמעותית', '#e99b36', 2, 2);
GO
IF NOT EXISTS (SELECT 1 FROM TicketUrgencyLevels WHERE Name = N'משבית')
INSERT INTO TicketUrgencyLevels (Name, Description, ColorHex, Severity, [Order]) VALUES (N'משבית', N'לא ניתן לעבוד', '#d94e4e', 3, 3);
GO
