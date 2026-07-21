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
