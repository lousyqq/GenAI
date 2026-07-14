using Microsoft.Data.SqlClient;
using GenAI.Services.Interfaces;

namespace GenAI.Services;

public class SchemaBootstrap : ISchemaBootstrap
{
    private readonly string _connStr;
    private readonly IConfiguration _config;
    private readonly ILogger<SchemaBootstrap> _logger;

    public SchemaBootstrap(IConfiguration config, ILogger<SchemaBootstrap> logger)
    {
        _connStr = config.GetConnectionString("GenAI")
            ?? throw new InvalidOperationException("Missing connection string 'GenAI'");
        _config = config;
        _logger = logger;
    }

    public async Task RunAsync()
    {
        try
        {
            using var conn = new SqlConnection(_connStr);
            await conn.OpenAsync();

            await EnsureAccountStatsColumnsAsync(conn);
            await EnsureOverrideTableAsync(conn, "Map_Account_ExtraMenu");
            await EnsureOverrideTableAsync(conn, "Map_Account_DenyMenu");
            await EnsureMenuAclTableAsync(conn, "Map_Menu_AllowAccount");
            await EnsureMenuAclTableAsync(conn, "Map_Menu_DenyAccount");
            await EnsureUserActivityLogsAsync(conn);
            await EnsureIndexesAsync(conn);
            await SeedTestAccountsAsync(conn);

            _logger.LogInformation("✅ SchemaBootstrap 完成");
        }
        catch (Exception ex)
        {
            // 不擋啟動 — 只在 log 大聲喊
            try
            {
                _logger.LogError(ex, "⚠️ SchemaBootstrap 失敗：{Message} (應用會繼續啟動，請手動檢查 DB)", ex.Message);
            }
            catch
            {
                // 若 Windows EventLog 沒有權限，連 LogError 都會拋錯，這裡吞掉避免進程崩潰
            }
        }
    }

    /// <summary>確保 Accounts 有 LoginCount / LastLoginTime 欄位 (與舊 SettingsService 自動補齊邏輯一致)</summary>
    private async Task EnsureAccountStatsColumnsAsync(SqlConnection conn)
    {
        const string sql = @"
            IF COL_LENGTH('Accounts','LoginCount') IS NULL
                ALTER TABLE Accounts ADD LoginCount INT NULL;
            IF COL_LENGTH('Accounts','LastLoginTime') IS NULL
                ALTER TABLE Accounts ADD LastLoginTime DATETIME NULL;";
        using var cmd = new SqlCommand(sql, conn);
        await cmd.ExecuteNonQueryAsync();
    }

    /// <summary>
    /// 確保 Map_Account_ExtraMenu / Map_Account_DenyMenu 兩張「per-fab 覆寫表」存在且為新版結構。
    /// 結構：(EmpId, FabId, MenuId) 複合主鍵；FabId 為一般欄位（刻意不設 FK 到 Fabs，避免多重 cascade path）。
    /// 兩種情境皆 idempotent：
    ///   (a) 全新安裝 → 直接以新版結構 CREATE TABLE。
    ///   (b) 既有舊版表 (僅 EmpId, MenuId) → ALTER 補 FabId NOT NULL DEFAULT('') + 重建主鍵成 (EmpId, FabId, MenuId)。
    ///       舊資料因無廠區歸屬 → FabId='' (在前端/後端比對任一真實廠區皆 miss → 自動失效)，
    ///       使用者下次儲存該帳號即會被 RemoveRange→per-fab 重寫清掉，屬可接受的安全遷移。
    /// （tableName 為呼叫端硬編碼常數、非使用者輸入，無 SQL injection 風險。）
    /// </summary>
    private async Task EnsureOverrideTableAsync(SqlConnection conn, string tableName)
    {
        // 先檢查是否存在
        bool exists;
        using (var checkCmd = new SqlCommand(
            "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @tb", conn))
        {
            checkCmd.Parameters.AddWithValue("@tb", tableName);
            exists = (int)(await checkCmd.ExecuteScalarAsync())! > 0;
        }

        if (!exists)
        {
            // 全新安裝：新版 per-fab 結構 (FK 到 Accounts ON DELETE CASCADE；FK 到 Menus 預設 NO ACTION)
            var createSql = $@"
                CREATE TABLE [{tableName}] (
                    EmpId  NVARCHAR(50) NOT NULL,
                    FabId  NVARCHAR(50) NOT NULL CONSTRAINT DF_{tableName}_FabId DEFAULT(''),
                    MenuId NVARCHAR(50) NOT NULL,
                    CONSTRAINT PK_{tableName} PRIMARY KEY (EmpId, FabId, MenuId),
                    CONSTRAINT FK_{tableName}_Acc FOREIGN KEY (EmpId)  REFERENCES Accounts(EmpId) ON DELETE CASCADE,
                    CONSTRAINT FK_{tableName}_Mnu FOREIGN KEY (MenuId) REFERENCES Menus(MenuId)
                );";
            using var cmd = new SqlCommand(createSql, conn);
            await cmd.ExecuteNonQueryAsync();
            _logger.LogInformation("✅ SchemaBootstrap 建立資料表 {Table} (per-fab)", tableName);
            return;
        }

        // 既有表：若還是舊版 (沒有 FabId 欄) → 補欄位並重建主鍵成 (EmpId, FabId, MenuId)。
        //   以 COL_LENGTH 判斷，FabId 存在即視為已遷移、整段不執行 → idempotent。
        var migrateSql = $@"
            IF COL_LENGTH('{tableName}','FabId') IS NULL
            BEGIN
                ALTER TABLE [{tableName}] ADD FabId NVARCHAR(50) NOT NULL
                    CONSTRAINT DF_{tableName}_FabId DEFAULT('');

                DECLARE @pk NVARCHAR(128);
                SELECT @pk = name FROM sys.key_constraints
                    WHERE [type]='PK' AND parent_object_id = OBJECT_ID('{tableName}');
                IF @pk IS NOT NULL
                    EXEC('ALTER TABLE [{tableName}] DROP CONSTRAINT [' + @pk + ']');

                ALTER TABLE [{tableName}] ADD CONSTRAINT [PK_{tableName}]
                    PRIMARY KEY (EmpId, FabId, MenuId);
            END";
        using (var cmd = new SqlCommand(migrateSql, conn))
        {
            await cmd.ExecuteNonQueryAsync();
        }
    }

    /// <summary>確保 Map_Menu_AllowAccount / Map_Menu_DenyAccount 兩張 menu-level ACL 表存在</summary>
    private async Task EnsureMenuAclTableAsync(SqlConnection conn, string tableName)
    {
        using (var checkCmd = new SqlCommand(
            "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @tb", conn))
        {
            checkCmd.Parameters.AddWithValue("@tb", tableName);
            var exists = (int)(await checkCmd.ExecuteScalarAsync())! > 0;
            if (exists) return;
        }

        // PK 順序: (MenuId, EmpId)，跟 Account-side override 的 (EmpId, MenuId) 相反，
        // 因為這兩張表的「主要查詢方向」是「某個 menu 有哪些被特別 allow/deny 的 emp」
        var createSql = $@"
            CREATE TABLE [{tableName}] (
                MenuId NVARCHAR(50) NOT NULL,
                EmpId  NVARCHAR(50) NOT NULL,
                CONSTRAINT PK_{tableName} PRIMARY KEY (MenuId, EmpId),
                CONSTRAINT FK_{tableName}_Menu FOREIGN KEY (MenuId) REFERENCES Menus(MenuId),
                CONSTRAINT FK_{tableName}_Acc  FOREIGN KEY (EmpId)  REFERENCES Accounts(EmpId) ON DELETE CASCADE
            );";
        using (var cmd = new SqlCommand(createSql, conn))
        {
            await cmd.ExecuteNonQueryAsync();
            _logger.LogInformation("✅ SchemaBootstrap 建立資料表 {Table}", tableName);
        }
    }

    /// <summary>確保 UserActivityLogs 表存在（索引統一由 EnsureIndexesAsync 建立，避免兩處各自維護）</summary>
    private async Task EnsureUserActivityLogsAsync(SqlConnection conn)
    {
        using (var checkCmd = new SqlCommand(
            "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'UserActivityLogs'", conn))
        {
            var exists = (int)(await checkCmd.ExecuteScalarAsync())! > 0;
            if (!exists)
            {
                var createSql = @"
                    CREATE TABLE UserActivityLogs (
                        LogId        BIGINT IDENTITY(1,1) PRIMARY KEY,
                        Timestamp    DATETIME2 NOT NULL,
                        EmpId        NVARCHAR(50)  NULL,
                        EmpName      NVARCHAR(100) NULL,
                        LoginSource  NVARCHAR(20)  NULL,
                        IpAddress    NVARCHAR(45)  NULL,
                        UserAgent    NVARCHAR(500) NULL,
                        HttpMethod   NVARCHAR(10)  NULL,
                        Path         NVARCHAR(500) NULL,
                        QueryString  NVARCHAR(500) NULL,
                        StatusCode   INT           NULL,
                        DurationMs   INT           NULL,
                        Category     NVARCHAR(50)  NULL,
                        Action       NVARCHAR(100) NULL,
                        TargetType   NVARCHAR(50)  NULL,
                        TargetId     NVARCHAR(100) NULL,
                        Detail       NVARCHAR(MAX) NULL,
                        IsSuccess    BIT           NULL,
                        ErrorMessage NVARCHAR(500) NULL
                    );";
                using var createCmd = new SqlCommand(createSql, conn);
                await createCmd.ExecuteNonQueryAsync();
                _logger.LogInformation("✅ SchemaBootstrap 建立資料表 UserActivityLogs（索引稍後由 EnsureIndexesAsync 建立）");
            }
        }
    }

    /// <summary>
    /// 效能索引的「單一事實來源」(single source of truth)。
    /// 本專案無 EF Migrations、啟動也不呼叫 EnsureCreated/Migrate，
    /// 因此 EF Fluent 的 HasIndex 只是 model metadata、不會在既有 DB 真的建索引；
    /// 所有實體索引一律集中在此以 idempotent raw SQL 建立。
    /// 表名/欄位皆為硬編碼常數（非使用者輸入），無 SQL injection 風險。
    /// </summary>
    private async Task EnsureIndexesAsync(SqlConnection conn)
    {
        var indexes = new (string Name, string Table, string Cols)[]
        {
            ("IX_Accounts_RoleLevel",                "Accounts",         "RoleLevel"),
            // P2：帳號清單搜尋 (AccountService.GetAccountsPagedAsync) 對 EmpId/Name/Department 做子字串
            //     `Contains` → SQL `LIKE '%term%'`（前置萬用字元，本質 non-sargable、無法 B-tree seek，必掃描）。
            //     以「窄覆蓋索引 (Name, Department)」讓不可避免的掃描改讀這條瘦索引（葉層自動含 clustered key
            //     EmpId 作 row locator）而非整個寬 Accounts 表 —— 尤其 COUNT(*) 的三欄 OR-of-LIKE 完全被涵蓋、
            //     免回主表。子字串 UX 維持不變（真正子線性需 full-text，屬過度設計、不在本次範圍）。
            ("IX_Accounts_Search",                   "Accounts",         "Name, Department"),
            ("IX_Requests_Status",                   "Requests",         "Status"),
            ("IX_UserActivityLogs_EmpId_Timestamp",  "UserActivityLogs", "EmpId, Timestamp DESC"),
            ("IX_UserActivityLogs_Timestamp",        "UserActivityLogs", "Timestamp DESC"),
            ("IX_UserActivityLogs_Category_Time",    "UserActivityLogs", "Category, Timestamp DESC"),
            // E6：menu-level ACL 兩張表 PK 皆為 (MenuId, EmpId)，故「WHERE EmpId=@me」原本走全表掃描；
            //     補 EmpId 索引讓 MenuAuthService.GetVisibleMenuIdsAsync 的可見性查詢走 index seek。
            ("IX_Map_Menu_AllowAccount_EmpId",       "Map_Menu_AllowAccount", "EmpId"),
            ("IX_Map_Menu_DenyAccount_EmpId",        "Map_Menu_DenyAccount",  "EmpId"),
        };

        foreach (var ix in indexes)
        {
            try
            {
                var sql = $@"
                    IF OBJECT_ID('{ix.Table}') IS NOT NULL
                       AND NOT EXISTS (SELECT 1 FROM sys.indexes
                                       WHERE name = '{ix.Name}' AND object_id = OBJECT_ID('{ix.Table}'))
                        CREATE NONCLUSTERED INDEX [{ix.Name}] ON [{ix.Table}] ({ix.Cols});";
                using var cmd = new SqlCommand(sql, conn);
                await cmd.ExecuteNonQueryAsync();
            }
            catch (Exception ex)
            {
                // 單一索引失敗不該擋啟動 — 記 warning 後繼續
                _logger.LogWarning(ex, "建立索引 {Index} 失敗（略過，不影響啟動）", ix.Name);
            }
        }

        _logger.LogInformation("✅ SchemaBootstrap 效能索引檢查完成 (idempotent)");
    }

    /// <summary>把 appsettings.Auth.TestAccounts.Accounts 中所有工號 upsert 進 Accounts 表 (僅在 TestAccounts.Enabled=true 時)</summary>
    private async Task SeedTestAccountsAsync(SqlConnection conn)
    {
        var enabled = _config.GetValue<bool>("Auth:TestAccounts:Enabled");
        if (!enabled) return;

        var section = _config.GetSection("Auth:TestAccounts:Accounts");
        if (!section.Exists()) return;

        foreach (var child in section.GetChildren())
        {
            var empId = child["EmpId"];
            if (string.IsNullOrWhiteSpace(empId)) continue;

            // admin 是緊急通道、不寫 DB；user 與 00058897 之類則寫入便於 UI 管理
            // (admin 寫進去也無妨 — 但保留現狀避免覆寫使用者已調好的 admin Account)
            if (string.Equals(empId, "admin", StringComparison.OrdinalIgnoreCase)) continue;

            var name = child["Name"] ?? empId;
            var dept = child["Department"] ?? "";
            var roleLevel = child["RoleLevel"] ?? "user";
            var canEditOthers = bool.TryParse(child["CanEditOthers"], out var b) && b;

            // 只在不存在時 INSERT (絕不覆寫使用者後續從 UI 改過的 Name/Dept 等欄位)
            const string upsertSql = @"
                IF NOT EXISTS (SELECT 1 FROM Accounts WHERE EmpId = @EmpId)
                BEGIN
                    INSERT INTO Accounts (EmpId, Name, Department, RoleLevel, CanEditOthers, LoginCount, LastLoginTime)
                    VALUES (@EmpId, @Name, @Dept, @RoleLevel, @CanEditOthers, 0, NULL);
                END";
            using var cmd = new SqlCommand(upsertSql, conn);
            cmd.Parameters.AddWithValue("@EmpId", empId);
            cmd.Parameters.AddWithValue("@Name", name);
            cmd.Parameters.AddWithValue("@Dept", dept);
            cmd.Parameters.AddWithValue("@RoleLevel", roleLevel);
            cmd.Parameters.AddWithValue("@CanEditOthers", canEditOthers);

            var affected = await cmd.ExecuteNonQueryAsync();
            if (affected > 0)
            {
                _logger.LogInformation("✅ SchemaBootstrap 種入測試帳號 {EmpId} ({Name})", empId, name);
            }
        }
    }
}
