-- IT Portal v2 — initial seed. Run once, after schema.sql.
-- Creates the one and only Super Admin row. IsSuperAdmin can never be granted through
-- any API endpoint — this INSERT is the only way that flag is ever set to 1.

-- FirstName/LastName left blank on purpose (not guessed) — editable from the profile
-- page on first login, same EDITABLE_PROFILE_FIELDS flow as every other user in v1.
IF NOT EXISTS (SELECT 1 FROM Users WHERE Email = N'eran@rami-levy-stock.co.il')
INSERT INTO Users (Email, FirstName, LastName, IsSuperAdmin, IsITAdmin, IsProceduresAdmin)
VALUES (N'eran@rami-levy-stock.co.il', N'', N'', 1, 1, 1);
GO
