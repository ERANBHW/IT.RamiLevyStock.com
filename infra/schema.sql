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
    TicketNumber    AS ('TK-' + RIGHT('0000' + CAST(TicketId AS VARCHAR(10)), 4)) PERSISTED,
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
