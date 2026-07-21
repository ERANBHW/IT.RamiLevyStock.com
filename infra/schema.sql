-- IT Portal v2 — Azure SQL schema.
-- Run once against a fresh it-portal-db (Portal Query editor or sqlcmd).
-- Safe to re-run: every CREATE is guarded with an existence check.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Users')
CREATE TABLE Users (
    Email               NVARCHAR(320)   NOT NULL PRIMARY KEY,
    FirstName           NVARCHAR(100)   NOT NULL DEFAULT '',
    LastName            NVARCHAR(100)   NOT NULL DEFAULT '',
    Phone               NVARCHAR(50)    NOT NULL DEFAULT '',
    Branch              NVARCHAR(100)   NOT NULL DEFAULT '',
    Role                NVARCHAR(100)   NOT NULL DEFAULT '',
    IsSuperAdmin        BIT             NOT NULL DEFAULT 0,
    IsITAdmin           BIT             NOT NULL DEFAULT 0,
    IsProceduresAdmin   BIT             NOT NULL DEFAULT 0,
    CreatedAt           DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt           DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Computers')
CREATE TABLE Computers (
    ComputerName        NVARCHAR(100)   NOT NULL PRIMARY KEY,
    Type                NVARCHAR(100)   NOT NULL DEFAULT '',
    RAM                 NVARCHAR(50)    NOT NULL DEFAULT '',
    IP                  NVARCHAR(50)    NOT NULL DEFAULT '',
    Printer             NVARCHAR(100)   NOT NULL DEFAULT '',
    AnyDeskId           NVARCHAR(50)    NOT NULL DEFAULT '',
    AssignedUserEmail   NVARCHAR(320)   NULL,
    Branch              NVARCHAR(100)   NOT NULL DEFAULT '',
    Notes               NVARCHAR(MAX)   NOT NULL DEFAULT '',
    CreatedAt           DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt           DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Computers_AssignedUser FOREIGN KEY (AssignedUserEmail)
        REFERENCES Users(Email) ON DELETE SET NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Computers_AssignedUserEmail')
CREATE INDEX IX_Computers_AssignedUserEmail ON Computers(AssignedUserEmail);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Tickets')
CREATE TABLE Tickets (
    TicketId        INT IDENTITY(1,1)  NOT NULL PRIMARY KEY,
    TicketNumber    AS (CAST('TK-' + RIGHT('0000' + CAST(TicketId AS VARCHAR(10)), 4) AS NVARCHAR(20))) PERSISTED,
    Timestamp       DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
    UserEmail       NVARCHAR(320)   NOT NULL,
    UserName        NVARCHAR(200)   NOT NULL DEFAULT '',
    Phone           NVARCHAR(50)    NOT NULL DEFAULT '',
    Branch          NVARCHAR(100)   NOT NULL DEFAULT '',
    ComputerName    NVARCHAR(100)   NOT NULL DEFAULT '',
    IP              NVARCHAR(50)    NOT NULL DEFAULT '',
    Printer         NVARCHAR(100)   NOT NULL DEFAULT '',
    AnyDeskId       NVARCHAR(50)    NOT NULL DEFAULT '',
    Category        NVARCHAR(100)   NOT NULL DEFAULT '',
    Urgency         NVARCHAR(50)    NOT NULL DEFAULT '',
    Description     NVARCHAR(MAX)   NOT NULL DEFAULT '',
    Status          NVARCHAR(20)    NOT NULL DEFAULT N'פתוחה',
    AssignedToEmail NVARCHAR(320)   NULL,
    AssignedToName  NVARCHAR(200)   NULL,
    ClosedAt        DATETIME2       NULL,
    UpdatedAt       DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_Tickets_TicketNumber UNIQUE (TicketNumber),
    CONSTRAINT CK_Tickets_Status CHECK (Status IN (N'פתוחה', N'בטיפול', N'סגורה'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Tickets_UserEmail')
CREATE INDEX IX_Tickets_UserEmail ON Tickets(UserEmail);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Tickets_ComputerName')
CREATE INDEX IX_Tickets_ComputerName ON Tickets(ComputerName);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Tickets_Status')
CREATE INDEX IX_Tickets_Status ON Tickets(Status);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TicketLog')
CREATE TABLE TicketLog (
    Id              INT IDENTITY(1,1)  NOT NULL PRIMARY KEY,
    TicketNumber    NVARCHAR(20)    NOT NULL,
    Timestamp       DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
    ActorEmail      NVARCHAR(320)   NOT NULL,
    ActorName       NVARCHAR(200)   NOT NULL DEFAULT '',
    Action          NVARCHAR(30)    NOT NULL,
    FieldName       NVARCHAR(50)    NULL,
    OldValue        NVARCHAR(MAX)   NULL,
    NewValue        NVARCHAR(MAX)   NULL,
    Message         NVARCHAR(MAX)   NULL,
    CONSTRAINT FK_TicketLog_Ticket FOREIGN KEY (TicketNumber)
        REFERENCES Tickets(TicketNumber) ON DELETE CASCADE,
    CONSTRAINT CK_TicketLog_Action CHECK (Action IN
        ('created', 'field_updated', 'assigned', 'status_changed', 'note'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_TicketLog_TicketNumber')
CREATE INDEX IX_TicketLog_TicketNumber ON TicketLog(TicketNumber);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Procedures')
CREATE TABLE Procedures (
    Id          UNIQUEIDENTIFIER   NOT NULL PRIMARY KEY DEFAULT NEWID(),
    Title       NVARCHAR(200)      NOT NULL DEFAULT '',
    Content     NVARCHAR(MAX)      NOT NULL DEFAULT '',
    Category    NVARCHAR(100)      NOT NULL DEFAULT '',
    [Order]     INT                NOT NULL DEFAULT 0,
    UpdatedAt   DATETIME2          NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedBy   NVARCHAR(320)      NOT NULL DEFAULT ''
);
GO

-- ============================================================================
-- v2.1 additions (see PROJECT_STATUS.md, "תוכנית v2.1"). Consolidated schema
-- for all v2.1 sections, applied once — corresponding backend/frontend land
-- across later steps. All guarded, safe to re-run.
-- ============================================================================

-- Section 2 — Branches (סעיף 2)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Branches')
CREATE TABLE Branches (
    Number  INT             NOT NULL PRIMARY KEY,
    Name    NVARCHAR(100)   NOT NULL DEFAULT ''
);
GO

-- Seed data (Branches, SharedFolders) lives in seed.sql, run after this file.

-- Section 3 — Shared folders (סעיף 3): Entra ID group = SharePoint site
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SharedFolders')
CREATE TABLE SharedFolders (
    Id                    UNIQUEIDENTIFIER   NOT NULL PRIMARY KEY DEFAULT NEWID(),
    Name                  NVARCHAR(100)       NOT NULL DEFAULT '',
    EntraGroupObjectId    NVARCHAR(50)        NOT NULL DEFAULT ''
);
GO

-- Section 8 — Printers (סעיף 8)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Printers')
CREATE TABLE Printers (
    PrinterName     NVARCHAR(100)   NOT NULL PRIMARY KEY,
    IP              NVARCHAR(50)    NOT NULL DEFAULT '',
    BranchNumber    INT             NULL,
    Notes           NVARCHAR(MAX)   NOT NULL DEFAULT '',
    CONSTRAINT FK_Printers_Branch FOREIGN KEY (BranchNumber) REFERENCES Branches(Number)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Printers_BranchNumber')
CREATE INDEX IX_Printers_BranchNumber ON Printers(BranchNumber);
GO

-- Users: Branch (free text) → BranchNumber FK; new IsUserRequestSubmitter flag (סעיף 4ב)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'BranchNumber')
ALTER TABLE Users ADD BranchNumber INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Users_Branch')
ALTER TABLE Users ADD CONSTRAINT FK_Users_Branch FOREIGN KEY (BranchNumber) REFERENCES Branches(Number);
GO
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'Branch')
ALTER TABLE Users DROP COLUMN Branch;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'IsUserRequestSubmitter')
ALTER TABLE Users ADD IsUserRequestSubmitter BIT NOT NULL DEFAULT 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Users_BranchNumber')
CREATE INDEX IX_Users_BranchNumber ON Users(BranchNumber);
GO

-- Computers: Branch (free text) → BranchNumber FK now (step 2 lands the code for this).
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Computers') AND name = 'BranchNumber')
ALTER TABLE Computers ADD BranchNumber INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Computers_Branch')
ALTER TABLE Computers ADD CONSTRAINT FK_Computers_Branch FOREIGN KEY (BranchNumber) REFERENCES Branches(Number);
GO
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Computers') AND name = 'Branch')
ALTER TABLE Computers DROP COLUMN Branch;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Computers') AND name = 'DefaultPrinterName')
ALTER TABLE Computers ADD DefaultPrinterName NVARCHAR(100) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Computers_DefaultPrinter')
ALTER TABLE Computers ADD CONSTRAINT FK_Computers_DefaultPrinter FOREIGN KEY (DefaultPrinterName) REFERENCES Printers(PrinterName) ON DELETE SET NULL;
GO
-- IP dropped entirely (v2.1, section 7 — no longer relevant, superseded by AnyDesk).
-- Printer (free text) dropped now too — replaced by DefaultPrinterName above (section 8).
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Computers') AND name = 'IP')
ALTER TABLE Computers DROP COLUMN IP;
GO
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Computers') AND name = 'Printer')
ALTER TABLE Computers DROP COLUMN Printer;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Computers_BranchNumber')
CREATE INDEX IX_Computers_BranchNumber ON Computers(BranchNumber);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Computers_DefaultPrinterName')
CREATE INDEX IX_Computers_DefaultPrinterName ON Computers(DefaultPrinterName);
GO

-- Section 4ב — user-creation requests (סעיף 4ב)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'UserRequests')
CREATE TABLE UserRequests (
    RequestId       INT IDENTITY(1,1)  NOT NULL PRIMARY KEY,
    RequestNumber   AS (CAST('NU-' + RIGHT('0000' + CAST(RequestId AS VARCHAR(10)), 4) AS NVARCHAR(20))) PERSISTED,
    Timestamp       DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
    RequesterEmail  NVARCHAR(320)   NOT NULL,
    RequesterName   NVARCHAR(200)   NOT NULL DEFAULT '',
    FirstNameHe     NVARCHAR(100)   NOT NULL DEFAULT '',
    LastNameHe      NVARCHAR(100)   NOT NULL DEFAULT '',
    FirstNameEn     NVARCHAR(100)   NOT NULL DEFAULT '',
    LastNameEn      NVARCHAR(100)   NOT NULL DEFAULT '',
    BranchNumber    INT             NULL,
    Role            NVARCHAR(100)   NOT NULL DEFAULT '',
    SuggestedEmail  NVARCHAR(320)   NOT NULL DEFAULT '',
    TempPassword    NVARCHAR(100)   NOT NULL DEFAULT '',
    Status          NVARCHAR(20)    NOT NULL DEFAULT N'ממתינה',
    ReviewedByEmail NVARCHAR(320)   NULL,
    ReviewedAt      DATETIME2       NULL,
    CONSTRAINT UQ_UserRequests_RequestNumber UNIQUE (RequestNumber),
    CONSTRAINT FK_UserRequests_Branch FOREIGN KEY (BranchNumber) REFERENCES Branches(Number),
    CONSTRAINT CK_UserRequests_Status CHECK (Status IN (N'ממתינה', N'הוקם'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_UserRequests_Status')
CREATE INDEX IX_UserRequests_Status ON UserRequests(Status);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'UserRequestFolders')
CREATE TABLE UserRequestFolders (
    RequestId       INT                 NOT NULL,
    SharedFolderId  UNIQUEIDENTIFIER    NOT NULL,
    CONSTRAINT PK_UserRequestFolders PRIMARY KEY (RequestId, SharedFolderId),
    CONSTRAINT FK_UserRequestFolders_Request FOREIGN KEY (RequestId)
        REFERENCES UserRequests(RequestId) ON DELETE CASCADE,
    CONSTRAINT FK_UserRequestFolders_Folder FOREIGN KEY (SharedFolderId)
        REFERENCES SharedFolders(Id)
);
GO
