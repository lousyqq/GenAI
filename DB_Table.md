# GenAI 資料庫架構

- **Server**: Sariel
- **Database**: GenAI（2026-07-14 由 EQDashboardV2 專案改名而來，schema 以 EF Core model 產生並對齊原 EQDashboardV2 欄位長度）
- **連線字串 key**: `ConnectionStrings:GenAI`（appsettings.json；Production 用環境變數 `ConnectionStrings__GenAI`）
- 本專案**無 EF Migrations**；啟動時 `Services/SchemaBootstrap.cs` 只做既有表的欄位補丁、效能索引與測試帳號種子，不會建立全新資料表。全新 DB 請直接執行下方「完整建置 SQL」。
- **變更 DB 架構時，請同步更新本文件（含下方完整建置 SQL 與架構變更歷程）。**

## 完整建置 SQL（遠端主機重建用）

> 以下腳本 = **目前開發環境 GenAI DB 的完整定義**（18 張表、21 個 FK、17 個非叢集索引、基礎種子資料），已於 2026-07-14 在同 server 以臨時 DB 實測：一次跑通、與現行 GenAI 結構比對零差異。
> 使用方式：在遠端主機先 `CREATE DATABASE GenAI;`，再以 `sqlcmd -d GenAI -f 65001 -i 本腳本.sql` 執行（腳本冪等，可重複執行）。
> ⚠️ **維護規則：日後專案修改若涉及 DB 架構變更，必須同步更新本節 SQL（新表 → 加 CREATE TABLE；欄位/索引調整 → 於腳本尾端「5. 架構變更歷程」加對應 ALTER/CREATE 指令）。**

```sql
-- =====================================================================
-- GenAI DB 完整建置指令（schema + 基礎種子資料）
-- 用途：在遠端主機重建與開發環境相同的 GenAI DB
-- 前置：先自行 CREATE DATABASE GenAI; 並確保執行帳號有該 DB 的 db_owner
-- 冪等：可重複執行（皆有 IF NOT EXISTS 防護）
-- =====================================================================
USE GenAI;
SET NOCOUNT ON;

-- ============================ 1. 主表 ============================
IF OBJECT_ID('dbo.Accounts') IS NULL
CREATE TABLE dbo.Accounts (
    EmpId         nvarchar(50)  NOT NULL,
    Name          nvarchar(100) NULL,
    Department    nvarchar(100) NULL,
    RoleLevel     nvarchar(20)  NULL,
    CanEditOthers bit           NULL,
    LoginCount    int           NULL,
    LastLoginTime datetime2     NULL,
    CONSTRAINT PK_Accounts PRIMARY KEY (EmpId)
);

IF OBJECT_ID('dbo.Fabs') IS NULL
CREATE TABLE dbo.Fabs (
    FabId       nvarchar(50)  NOT NULL,
    FabName     nvarchar(50)  NULL,
    DisplayName nvarchar(100) NULL,
    DefaultLang nvarchar(10)  NULL,
    CONSTRAINT PK_Fabs PRIMARY KEY (FabId)
);

IF OBJECT_ID('dbo.Roles') IS NULL
CREATE TABLE dbo.Roles (
    RoleId    nvarchar(50)  NOT NULL,
    GroupName nvarchar(100) NULL,
    CONSTRAINT PK_Roles PRIMARY KEY (RoleId)
);

IF OBJECT_ID('dbo.Menus') IS NULL
CREATE TABLE dbo.Menus (
    MenuId      nvarchar(50)  NOT NULL,
    SysName     nvarchar(100) NULL,
    DisplayName nvarchar(100) NULL,
    MenuMode    nvarchar(20)  NULL,
    Url         nvarchar(max) NULL,
    TargetPage  nvarchar(100) NULL,
    OpenTarget  nvarchar(20)  NULL,
    Icon        nvarchar(max) NULL,
    CreatedBy   nvarchar(50)  NULL,
    IsEnabled   bit           NULL,
    IsPoolItem  bit           NULL,
    IsEdited    bit           NULL,
    GlobalOrder int           NULL,
    CONSTRAINT PK_Menus PRIMARY KEY (MenuId)
);

IF OBJECT_ID('dbo.Apps') IS NULL
CREATE TABLE dbo.Apps (
    AppId      nvarchar(50)  NOT NULL,
    MenuId     nvarchar(50)  NULL,
    AppName    nvarchar(100) NULL,
    Url        nvarchar(max) NULL,
    IconBase64 nvarchar(max) NULL,
    Target     nvarchar(20)  NULL,
    CONSTRAINT PK_Apps PRIMARY KEY (AppId)
);

IF OBJECT_ID('dbo.Requests') IS NULL
CREATE TABLE dbo.Requests (
    RequestId      nvarchar(50)  NOT NULL,
    EmpId          nvarchar(50)  NULL,
    EmpName        nvarchar(100) NULL,
    Reason         nvarchar(max) NULL,
    Timestamp      bigint        NULL,
    Status         nvarchar(20)  NULL,
    WithdrawReason nvarchar(max) NULL,
    Reply          nvarchar(max) NULL,
    ReqType        nvarchar(50)  NULL,
    Fab            nvarchar(50)  NULL,
    CONSTRAINT PK_Requests PRIMARY KEY (RequestId)
);

IF OBJECT_ID('dbo.PersonalSettings') IS NULL
CREATE TABLE dbo.PersonalSettings (
    EmpId      nvarchar(50)  NOT NULL,
    MenuId     nvarchar(50)  NOT NULL,
    IsHidden   bit           NULL,
    OpenTarget nvarchar(20)  NULL,
    Icon       nvarchar(max) NULL,
    SortOrder  int           NULL,
    CONSTRAINT PK_PersonalSettings PRIMARY KEY (EmpId, MenuId)
);

IF OBJECT_ID('dbo.UserActivityLogs') IS NULL
CREATE TABLE dbo.UserActivityLogs (
    LogId        bigint IDENTITY(1,1) NOT NULL,
    Timestamp    datetime2     NOT NULL,
    EmpId        nvarchar(50)  NULL,
    EmpName      nvarchar(100) NULL,
    LoginSource  nvarchar(20)  NULL,
    IpAddress    nvarchar(50)  NULL,
    UserAgent    nvarchar(500) NULL,
    HttpMethod   nvarchar(10)  NULL,
    Path         nvarchar(500) NULL,
    QueryString  nvarchar(500) NULL,
    StatusCode   int           NULL,
    DurationMs   int           NULL,
    Category     nvarchar(50)  NULL,
    Action       nvarchar(50)  NULL,
    TargetType   nvarchar(50)  NULL,
    TargetId     nvarchar(100) NULL,
    Detail       nvarchar(max) NULL,
    IsSuccess    bit           NULL,
    ErrorMessage nvarchar(500) NULL,
    CONSTRAINT PK_UserActivityLogs PRIMARY KEY (LogId)
);

-- ==================== 2. 對應 (Map) 表 + 外鍵 ====================
IF OBJECT_ID('dbo.Map_Account_DefaultPage') IS NULL
CREATE TABLE dbo.Map_Account_DefaultPage (
    EmpId  nvarchar(50) NOT NULL,
    FabId  nvarchar(50) NOT NULL,
    MenuId nvarchar(50) NOT NULL,
    CONSTRAINT PK_Map_Account_DefaultPage PRIMARY KEY (EmpId, FabId, MenuId),
    CONSTRAINT FK_Map_Account_DefaultPage_Accounts_EmpId FOREIGN KEY (EmpId)  REFERENCES dbo.Accounts (EmpId)  ON DELETE CASCADE,
    CONSTRAINT FK_Map_Account_DefaultPage_Fabs_FabId     FOREIGN KEY (FabId)  REFERENCES dbo.Fabs (FabId)      ON DELETE CASCADE,
    CONSTRAINT FK_Map_Account_DefaultPage_Menus_MenuId   FOREIGN KEY (MenuId) REFERENCES dbo.Menus (MenuId)    ON DELETE CASCADE
);

-- 注意：DenyMenu / ExtraMenu 的 FabId 為 nvarchar(450)（沿用 EF 預設），
--       PK 總長超過 900 bytes，建立時會出現警告 — 屬既有設計，可忽略。
IF OBJECT_ID('dbo.Map_Account_DenyMenu') IS NULL
CREATE TABLE dbo.Map_Account_DenyMenu (
    EmpId  nvarchar(50)  NOT NULL,
    FabId  nvarchar(450) NOT NULL,
    MenuId nvarchar(50)  NOT NULL,
    CONSTRAINT PK_Map_Account_DenyMenu PRIMARY KEY (EmpId, FabId, MenuId),
    CONSTRAINT FK_Map_Account_DenyMenu_Accounts_EmpId FOREIGN KEY (EmpId)  REFERENCES dbo.Accounts (EmpId) ON DELETE CASCADE,
    CONSTRAINT FK_Map_Account_DenyMenu_Menus_MenuId   FOREIGN KEY (MenuId) REFERENCES dbo.Menus (MenuId)   ON DELETE CASCADE
);

IF OBJECT_ID('dbo.Map_Account_ExtraMenu') IS NULL
CREATE TABLE dbo.Map_Account_ExtraMenu (
    EmpId  nvarchar(50)  NOT NULL,
    FabId  nvarchar(450) NOT NULL,
    MenuId nvarchar(50)  NOT NULL,
    CONSTRAINT PK_Map_Account_ExtraMenu PRIMARY KEY (EmpId, FabId, MenuId),
    CONSTRAINT FK_Map_Account_ExtraMenu_Accounts_EmpId FOREIGN KEY (EmpId)  REFERENCES dbo.Accounts (EmpId) ON DELETE CASCADE,
    CONSTRAINT FK_Map_Account_ExtraMenu_Menus_MenuId   FOREIGN KEY (MenuId) REFERENCES dbo.Menus (MenuId)   ON DELETE CASCADE
);

IF OBJECT_ID('dbo.Map_Account_ManageMenu') IS NULL
CREATE TABLE dbo.Map_Account_ManageMenu (
    EmpId  nvarchar(50) NOT NULL,
    MenuId nvarchar(50) NOT NULL,
    CONSTRAINT PK_Map_Account_ManageMenu PRIMARY KEY (EmpId, MenuId),
    CONSTRAINT FK_Map_Account_ManageMenu_Accounts_EmpId FOREIGN KEY (EmpId)  REFERENCES dbo.Accounts (EmpId) ON DELETE CASCADE,
    CONSTRAINT FK_Map_Account_ManageMenu_Menus_MenuId   FOREIGN KEY (MenuId) REFERENCES dbo.Menus (MenuId)   ON DELETE CASCADE
);

IF OBJECT_ID('dbo.Map_Account_Role') IS NULL
CREATE TABLE dbo.Map_Account_Role (
    EmpId  nvarchar(50) NOT NULL,
    RoleId nvarchar(50) NOT NULL,
    CONSTRAINT PK_Map_Account_Role PRIMARY KEY (EmpId, RoleId),
    CONSTRAINT FK_Map_Account_Role_Accounts_EmpId FOREIGN KEY (EmpId)  REFERENCES dbo.Accounts (EmpId) ON DELETE CASCADE,
    CONSTRAINT FK_Map_Account_Role_Roles_RoleId   FOREIGN KEY (RoleId) REFERENCES dbo.Roles (RoleId)   ON DELETE CASCADE
);

IF OBJECT_ID('dbo.Map_Fab_Role') IS NULL
CREATE TABLE dbo.Map_Fab_Role (
    FabId  nvarchar(50) NOT NULL,
    RoleId nvarchar(50) NOT NULL,
    CONSTRAINT PK_Map_Fab_Role PRIMARY KEY (FabId, RoleId),
    CONSTRAINT FK_Map_Fab_Role_Fabs_FabId   FOREIGN KEY (FabId)  REFERENCES dbo.Fabs (FabId)   ON DELETE CASCADE,
    CONSTRAINT FK_Map_Fab_Role_Roles_RoleId FOREIGN KEY (RoleId) REFERENCES dbo.Roles (RoleId) ON DELETE CASCADE
);

IF OBJECT_ID('dbo.Map_Menu_AllowAccount') IS NULL
CREATE TABLE dbo.Map_Menu_AllowAccount (
    MenuId nvarchar(50) NOT NULL,
    EmpId  nvarchar(50) NOT NULL,
    CONSTRAINT PK_Map_Menu_AllowAccount PRIMARY KEY (MenuId, EmpId),
    CONSTRAINT FK_Map_Menu_AllowAccount_Accounts_EmpId FOREIGN KEY (EmpId)  REFERENCES dbo.Accounts (EmpId) ON DELETE CASCADE,
    CONSTRAINT FK_Map_Menu_AllowAccount_Menus_MenuId   FOREIGN KEY (MenuId) REFERENCES dbo.Menus (MenuId)   ON DELETE CASCADE
);

IF OBJECT_ID('dbo.Map_Menu_DenyAccount') IS NULL
CREATE TABLE dbo.Map_Menu_DenyAccount (
    MenuId nvarchar(50) NOT NULL,
    EmpId  nvarchar(50) NOT NULL,
    CONSTRAINT PK_Map_Menu_DenyAccount PRIMARY KEY (MenuId, EmpId),
    CONSTRAINT FK_Map_Menu_DenyAccount_Accounts_EmpId FOREIGN KEY (EmpId)  REFERENCES dbo.Accounts (EmpId) ON DELETE CASCADE,
    CONSTRAINT FK_Map_Menu_DenyAccount_Menus_MenuId   FOREIGN KEY (MenuId) REFERENCES dbo.Menus (MenuId)   ON DELETE CASCADE
);

IF OBJECT_ID('dbo.Map_Menu_Structure') IS NULL
CREATE TABLE dbo.Map_Menu_Structure (
    ParentMenuId nvarchar(50) NOT NULL,
    ChildMenuId  nvarchar(50) NOT NULL,
    SortOrder    int          NULL,
    CONSTRAINT PK_Map_Menu_Structure PRIMARY KEY (ParentMenuId, ChildMenuId),
    CONSTRAINT FK_Map_Menu_Structure_Menus_ParentMenuId FOREIGN KEY (ParentMenuId) REFERENCES dbo.Menus (MenuId),
    CONSTRAINT FK_Map_Menu_Structure_Menus_ChildMenuId  FOREIGN KEY (ChildMenuId)  REFERENCES dbo.Menus (MenuId)
);

IF OBJECT_ID('dbo.Map_Role_Menu') IS NULL
CREATE TABLE dbo.Map_Role_Menu (
    RoleId    nvarchar(50) NOT NULL,
    MenuId    nvarchar(50) NOT NULL,
    SortOrder int          NULL,
    CONSTRAINT PK_Map_Role_Menu PRIMARY KEY (RoleId, MenuId),
    CONSTRAINT FK_Map_Role_Menu_Roles_RoleId FOREIGN KEY (RoleId) REFERENCES dbo.Roles (RoleId) ON DELETE CASCADE,
    CONSTRAINT FK_Map_Role_Menu_Menus_MenuId FOREIGN KEY (MenuId) REFERENCES dbo.Menus (MenuId) ON DELETE CASCADE
);

-- ============================ 3. 索引 ============================
-- （IX_Accounts_*、IX_Requests_Status、IX_UserActivityLogs_*、IX_Map_Menu_*_EmpId
--   應用程式啟動時 SchemaBootstrap 也會自動補建，此處先建齊以達到完整一致）
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Accounts_RoleLevel')             CREATE INDEX IX_Accounts_RoleLevel             ON dbo.Accounts (RoleLevel);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Accounts_Search')                CREATE INDEX IX_Accounts_Search                ON dbo.Accounts (Name, Department);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Map_Account_DefaultPage_FabId')  CREATE INDEX IX_Map_Account_DefaultPage_FabId  ON dbo.Map_Account_DefaultPage (FabId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Map_Account_DefaultPage_MenuId') CREATE INDEX IX_Map_Account_DefaultPage_MenuId ON dbo.Map_Account_DefaultPage (MenuId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Map_Account_DenyMenu_MenuId')    CREATE INDEX IX_Map_Account_DenyMenu_MenuId    ON dbo.Map_Account_DenyMenu (MenuId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Map_Account_ExtraMenu_MenuId')   CREATE INDEX IX_Map_Account_ExtraMenu_MenuId   ON dbo.Map_Account_ExtraMenu (MenuId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Map_Account_ManageMenu_MenuId')  CREATE INDEX IX_Map_Account_ManageMenu_MenuId  ON dbo.Map_Account_ManageMenu (MenuId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Map_Account_Role_RoleId')        CREATE INDEX IX_Map_Account_Role_RoleId        ON dbo.Map_Account_Role (RoleId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Map_Fab_Role_RoleId')            CREATE INDEX IX_Map_Fab_Role_RoleId            ON dbo.Map_Fab_Role (RoleId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Map_Menu_AllowAccount_EmpId')    CREATE INDEX IX_Map_Menu_AllowAccount_EmpId    ON dbo.Map_Menu_AllowAccount (EmpId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Map_Menu_DenyAccount_EmpId')     CREATE INDEX IX_Map_Menu_DenyAccount_EmpId     ON dbo.Map_Menu_DenyAccount (EmpId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Map_Menu_Structure_ChildMenuId') CREATE INDEX IX_Map_Menu_Structure_ChildMenuId ON dbo.Map_Menu_Structure (ChildMenuId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Map_Role_Menu_MenuId')           CREATE INDEX IX_Map_Role_Menu_MenuId           ON dbo.Map_Role_Menu (MenuId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Requests_Status')                CREATE INDEX IX_Requests_Status                ON dbo.Requests (Status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_UserActivityLogs_Category_Time') CREATE INDEX IX_UserActivityLogs_Category_Time ON dbo.UserActivityLogs (Category, Timestamp DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_UserActivityLogs_EmpId_Timestamp') CREATE INDEX IX_UserActivityLogs_EmpId_Timestamp ON dbo.UserActivityLogs (EmpId, Timestamp DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_UserActivityLogs_Timestamp')     CREATE INDEX IX_UserActivityLogs_Timestamp     ON dbo.UserActivityLogs (Timestamp DESC);

-- ======================= 4. 基礎種子資料 =======================
-- 單一廠區 12A（前端固定綁定 12A）
IF NOT EXISTS (SELECT 1 FROM dbo.Fabs WHERE FabId = 'fab_12a')
    INSERT INTO dbo.Fabs (FabId, FabName, DisplayName, DefaultLang) VALUES ('fab_12a', '12A', '12A', 'zh');

-- 唯一權限群組（自動開帳號時由 appsettings Auth:DefaultRoleIds 指派）
IF NOT EXISTS (SELECT 1 FROM dbo.Roles WHERE RoleId = 'role_1')
    INSERT INTO dbo.Roles (RoleId, GroupName) VALUES ('role_1', N'12A 主模組');

IF NOT EXISTS (SELECT 1 FROM dbo.Map_Fab_Role WHERE FabId = 'fab_12a' AND RoleId = 'role_1')
    INSERT INTO dbo.Map_Fab_Role (FabId, RoleId) VALUES ('fab_12a', 'role_1');

-- 16 個主選單目錄（folder），子選單由管理者於 UI 自行新增
DECLARE @menus TABLE (Ord int, MenuId nvarchar(50), Nm nvarchar(100));
INSERT INTO @menus VALUES
 (1,'m_df1','DF1'),(2,'m_df2','DF2'),(3,'m_df3','DF3'),(4,'m_df4','DF4'),
 (5,'m_et1','ET1'),(6,'m_et2','ET2'),(7,'m_et3','ET3'),(8,'m_et4','ET4'),
 (9,'m_lt3','LT3'),(10,'m_lt4','LT4'),
 (11,'m_tf1','TF1'),(12,'m_tf2','TF2'),(13,'m_tf3','TF3'),(14,'m_tf4','TF4'),(15,'m_tf5','TF5'),(16,'m_tf6','TF6');

INSERT INTO dbo.Menus (MenuId, SysName, DisplayName, MenuMode, CreatedBy, IsEnabled, IsPoolItem, IsEdited, GlobalOrder)
SELECT m.MenuId, m.Nm, m.Nm, 'folder', 'system', 1, 0, 0, m.Ord * 10
FROM @menus m
WHERE NOT EXISTS (SELECT 1 FROM dbo.Menus x WHERE x.MenuId = m.MenuId);

INSERT INTO dbo.Map_Role_Menu (RoleId, MenuId, SortOrder)
SELECT 'role_1', m.MenuId, m.Ord
FROM @menus m
WHERE NOT EXISTS (SELECT 1 FROM dbo.Map_Role_Menu x WHERE x.RoleId = 'role_1' AND x.MenuId = m.MenuId);

-- 完成檢查
SELECT (SELECT COUNT(*) FROM sys.tables)        AS Tables,
       (SELECT COUNT(*) FROM dbo.Menus)         AS Menus,
       (SELECT COUNT(*) FROM dbo.Map_Role_Menu) AS RoleMenus,
       (SELECT COUNT(*) FROM dbo.Roles)         AS Roles,
       (SELECT COUNT(*) FROM dbo.Fabs)          AS Fabs;

-- ==================== 5. 架構變更歷程（增量 ALTER） ====================
-- （尚無。日後 DB 架構變更時，將對應的 ALTER/CREATE 指令依日期附加於此，
--   讓已建立的遠端 DB 可只執行增量部分升級。）
```

## 資料表一覽（18 張）

### Accounts — 帳號
| 欄位 | 型別 | Null | Key |
|---|---|---|---|
| EmpId | nvarchar(50) | NO | PK |
| Name | nvarchar(100) | YES | |
| Department | nvarchar(100) | YES | |
| RoleLevel | nvarchar(20) | YES | |
| CanEditOthers | bit | YES | |
| LoginCount | int | YES | |
| LastLoginTime | datetime2 | YES | |

### Apps — 應用程式項目
| 欄位 | 型別 | Null | Key |
|---|---|---|---|
| AppId | nvarchar(50) | NO | PK |
| MenuId | nvarchar(50) | YES | |
| AppName | nvarchar(100) | YES | |
| Url | nvarchar(max) | YES | |
| IconBase64 | nvarchar(max) | YES | |
| Target | nvarchar(20) | YES | |

### Fabs — 廠區
| 欄位 | 型別 | Null | Key |
|---|---|---|---|
| FabId | nvarchar(50) | NO | PK |
| FabName | nvarchar(50) | YES | |
| DisplayName | nvarchar(100) | YES | |
| DefaultLang | nvarchar(10) | YES | |

### Menus — 選單
| 欄位 | 型別 | Null | Key |
|---|---|---|---|
| MenuId | nvarchar(50) | NO | PK |
| SysName | nvarchar(100) | YES | |
| DisplayName | nvarchar(100) | YES | |
| MenuMode | nvarchar(20) | YES | |
| Url | nvarchar(max) | YES | |
| TargetPage | nvarchar(100) | YES | |
| OpenTarget | nvarchar(20) | YES | |
| Icon | nvarchar(max) | YES | |
| CreatedBy | nvarchar(50) | YES | |
| IsEnabled | bit | YES | |
| IsPoolItem | bit | YES | |
| IsEdited | bit | YES | |
| GlobalOrder | int | YES | |

### Roles — 角色
| 欄位 | 型別 | Null | Key |
|---|---|---|---|
| RoleId | nvarchar(50) | NO | PK |
| GroupName | nvarchar(100) | YES | |

### Requests — 申請單
| 欄位 | 型別 | Null | Key |
|---|---|---|---|
| RequestId | nvarchar(50) | NO | PK |
| EmpId | nvarchar(50) | YES | |
| EmpName | nvarchar(100) | YES | |
| Reason | nvarchar(max) | YES | |
| Timestamp | bigint | YES | |
| Status | nvarchar(20) | YES | |
| WithdrawReason | nvarchar(max) | YES | |
| Reply | nvarchar(max) | YES | |
| ReqType | nvarchar(50) | YES | |
| Fab | nvarchar(50) | YES | |

### PersonalSettings — 個人化設定
| 欄位 | 型別 | Null | Key |
|---|---|---|---|
| EmpId | nvarchar(50) | NO | PK |
| MenuId | nvarchar(50) | NO | PK |
| IsHidden | bit | YES | |
| OpenTarget | nvarchar(20) | YES | |
| Icon | nvarchar(max) | YES | |
| SortOrder | int | YES | |

### UserActivityLogs — 使用者活動紀錄
| 欄位 | 型別 | Null | Key |
|---|---|---|---|
| LogId | bigint | NO | PK |
| Timestamp | datetime2 | NO | |
| EmpId | nvarchar(50) | YES | |
| EmpName | nvarchar(100) | YES | |
| LoginSource | nvarchar(20) | YES | |
| IpAddress | nvarchar(50) | YES | |
| UserAgent | nvarchar(500) | YES | |
| HttpMethod | nvarchar(10) | YES | |
| Path | nvarchar(500) | YES | |
| QueryString | nvarchar(500) | YES | |
| StatusCode | int | YES | |
| DurationMs | int | YES | |
| Category | nvarchar(50) | YES | |
| Action | nvarchar(50) | YES | |
| TargetType | nvarchar(50) | YES | |
| TargetId | nvarchar(100) | YES | |
| Detail | nvarchar(max) | YES | |
| IsSuccess | bit | YES | |
| ErrorMessage | nvarchar(500) | YES | |

### 對應（Map）表 — 10 張
| 資料表 | 複合 PK 欄位 | 其他欄位 |
|---|---|---|
| Map_Account_DefaultPage | EmpId nvarchar(50), FabId nvarchar(50), MenuId nvarchar(50) | — |
| Map_Account_DenyMenu | EmpId nvarchar(50), FabId nvarchar(450), MenuId nvarchar(50) | — |
| Map_Account_ExtraMenu | EmpId nvarchar(50), FabId nvarchar(450), MenuId nvarchar(50) | — |
| Map_Account_ManageMenu | EmpId nvarchar(50), MenuId nvarchar(50) | — |
| Map_Account_Role | EmpId nvarchar(50), RoleId nvarchar(50) | — |
| Map_Fab_Role | FabId nvarchar(50), RoleId nvarchar(50) | — |
| Map_Menu_AllowAccount | MenuId nvarchar(50), EmpId nvarchar(50) | — |
| Map_Menu_DenyAccount | MenuId nvarchar(50), EmpId nvarchar(50) | — |
| Map_Menu_Structure | ParentMenuId nvarchar(50), ChildMenuId nvarchar(50) | SortOrder int NULL |
| Map_Role_Menu | RoleId nvarchar(50), MenuId nvarchar(50) | SortOrder int NULL |

> 注意：Map_Account_DenyMenu / Map_Account_ExtraMenu 的 FabId 為 nvarchar(450)（沿用 EF 預設，PK 總長超過 900 bytes 會有 index key 警告），與其他表的 FabId nvarchar(50) 不一致，屬既有設計沿用。

## 基礎種子資料（2026-07-14，12A 減量改造）
schema 未變動；以下為必要的基礎資料列（缺少會導致選單不顯示）：

| 資料表 | 資料 | 用途 |
|---|---|---|
| Fabs | `fab_12a` / FabName `12A` / DisplayName `12A` / DefaultLang `zh` | 唯一廠區（前端固定綁定 12A） |
| Roles | `role_1` / `12A 主模組` | 預設權限群組；自動開帳號時指派（appsettings `Auth:DefaultRoleIds`） |
| Map_Fab_Role | `fab_12a` ↔ `role_1` | 廠區-角色鏈（選單可見性必經） |
| Menus | `m_df1`~`m_df4`, `m_et1`~`m_et4`, `m_lt3`, `m_lt4`, `m_tf1`~`m_tf6`（MenuMode=`folder`, CreatedBy=`system`, GlobalOrder=10~160） | 16 個主選單目錄 DF1-4/ET1-4/LT3-4/TF1-6 |
| Map_Role_Menu | `role_1` → 上述 16 個選單（SortOrder 1~16） | 使選單對持有 role_1 的帳號可見 |

另外 `/api/Auth/WhoAmI` 會在登入時自動寫入：Accounts（自動開帳號，RoleLevel=user）、Map_Account_Role（指派 DefaultRoleIds）、以及依 `Auth:AccountOverrides` 覆寫 RoleLevel/CanEditOthers。

## 效能索引（由 SchemaBootstrap 啟動時自動建立，idempotent）
- IX_Accounts_RoleLevel（Accounts.RoleLevel）
- IX_Accounts_Search（Accounts.Name, Department）
- IX_Requests_Status（Requests.Status）
- IX_UserActivityLogs_EmpId_Timestamp / IX_UserActivityLogs_Timestamp / IX_UserActivityLogs_Category_Time
- IX_Map_Menu_AllowAccount_EmpId / IX_Map_Menu_DenyAccount_EmpId
