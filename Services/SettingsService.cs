using System.Data;
using Microsoft.Data.SqlClient;
using System.Text.Json;
using GenAI.Services.Interfaces;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.EntityFrameworkCore;

namespace GenAI.Services;

/// <summary>
/// 設定資料服務 - 從 SettingsController 抽出的核心業務邏輯
/// </summary>
public class SettingsService : ISettingsService
{
    private readonly string _connStr;
    private readonly ILogger<SettingsService> _logger;
    private readonly Microsoft.Extensions.Caching.Memory.IMemoryCache _cache;
    private readonly GenAI.Data.AppDbContext _dbContext;
    private readonly IInitialDataCacheInvalidator _cacheInvalidator;
    private readonly GenAI.Services.Interfaces.IIconStorageService _iconStorage;
    private static readonly SemaphoreSlim _semaphore = new(1, 1);

    // 快取 key 與 ETag 已移交 IInitialDataCacheInvalidator（Singleton）統一持有，
    //   讓 EF SaveChanges 攔截器也能共用同一份；此處以 property 轉接，維持原本讀寫快取的程式碼形狀。
    private string InitialDataCacheKey_Global => _cacheInvalidator.GlobalCacheKey;
    private string InitialDataCacheKey_Volatile => _cacheInvalidator.VolatileCacheKey;

    private static readonly string[] TableNames = new[]
    {
        "Menus", "Fabs", "Roles", "Accounts", "Apps", "Requests",
        "Map_Fab_Role", "Map_Account_Role", "Map_Account_ManageMenu",
        "Map_Role_Menu", "Map_Menu_Structure", "Map_Account_DefaultPage",
        // ⚠️ PersonalSettings 刻意「不」列入全量覆寫清單：它是 per-user 自訂版面，
        //    一律走 RESTful /api/PersonalSettings（per-user delete+insert）。若放進這裡，
        //    SaveData / Excel 匯入會用單一使用者的快照 DELETE→INSERT 整張表，洗掉所有人的個人版面。
        //    讀取端 GetInitialDataAsync 是直接以 _dbContext.PersonalSettings 取得，不依賴本清單。
        // 帳號層級可視覆寫 (RBAC 之外的個別調整)
        "Map_Account_ExtraMenu", "Map_Account_DenyMenu",
        // Menu 層級存取控制 (白名單 / 黑名單)
        "Map_Menu_AllowAccount", "Map_Menu_DenyAccount"
    };

    public string GetCurrentETag() => _cacheInvalidator.CurrentETag;

    public SettingsService(IConfiguration config, ILogger<SettingsService> logger, Microsoft.Extensions.Caching.Memory.IMemoryCache cache, GenAI.Data.AppDbContext dbContext, IInitialDataCacheInvalidator cacheInvalidator, GenAI.Services.Interfaces.IIconStorageService iconStorage)
    {
        _connStr = config.GetConnectionString("GenAI")
            ?? throw new InvalidOperationException("Missing connection string 'GenAI'");
        _logger = logger;
        _cache = cache;
        _dbContext = dbContext;
        _cacheInvalidator = cacheInvalidator;
        _iconStorage = iconStorage;
    }

    public async Task<Dictionary<string, object>> GetInitialDataAsync(string empId)
    {
        var dbData = new Dictionary<string, object>();

        // Helper 函數：將 EF Core 實體轉型為 List<Dictionary<string, object>>
        // ⭐️ O2 優化：移除雙重序列化 (JsonSerializer.Serialize -> Deserialize) 
        //             改以 Reflection 直接讀取 Property，大幅降低 CPU 與 GC 記憶體回收壓力。
        List<Dictionary<string, object>> ConvertToList<T>(IEnumerable<T> data)
        {
            var list = new List<Dictionary<string, object>>();
            var props = typeof(T).GetProperties(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance);
            foreach (var item in data)
            {
                var dict = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
                foreach (var prop in props)
                {
                    dict[prop.Name] = prop.GetValue(item)!;
                }
                list.Add(dict);
            }
            return list;
        }

        // ⭐️ O1 優化：快取分流 - 將全域快取(60秒)與個人頻繁異動快取(10秒)分離
        // 1. 取得全域資料 (Menus, Fabs, Roles, Apps, 等等不常變動的配置)
        if (!_cache.TryGetValue(InitialDataCacheKey_Global, out Dictionary<string, object>? globalData))
        {
            await _semaphore.WaitAsync();
            try
            {
                if (!_cache.TryGetValue(InitialDataCacheKey_Global, out globalData))
                {
                    globalData = new Dictionary<string, object>();
                    try
                    {
                        globalData["Menus"] = ConvertToList(await _dbContext.Menus.AsNoTracking().ToListAsync());
                        globalData["Fabs"] = ConvertToList(await _dbContext.Fabs.AsNoTracking().ToListAsync());
                        globalData["Roles"] = ConvertToList(await _dbContext.Roles.AsNoTracking().ToListAsync());
                        globalData["Apps"] = ConvertToList(await _dbContext.Apps.AsNoTracking().ToListAsync());
                        globalData["Map_Fab_Role"] = ConvertToList(await _dbContext.MapFabRoles.AsNoTracking().ToListAsync());
                        globalData["Map_Role_Menu"] = ConvertToList(await _dbContext.MapRoleMenus.AsNoTracking().ToListAsync());
                        globalData["Map_Menu_Structure"] = ConvertToList(await _dbContext.MapMenuStructures.AsNoTracking().ToListAsync());
                        globalData["Map_Menu_AllowAccount"] = ConvertToList(await _dbContext.MapMenuAllowAccounts.AsNoTracking().ToListAsync());
                        globalData["Map_Menu_DenyAccount"] = ConvertToList(await _dbContext.MapMenuDenyAccounts.AsNoTracking().ToListAsync());

                        _cache.Set(InitialDataCacheKey_Global, globalData, TimeSpan.FromSeconds(60));
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Failed to load global data via EF Core.");
                    }
                }
            }
            finally
            {
                _semaphore.Release();
            }
        }

        // 2. 取得「共享」易變動資料 (10 秒快取) —— ⭐️ P1 後僅剩 Requests。
        //    Requests 不隨「帳號數」成長（隨申請筆數），admin 需全量、非 admin 由 Controller 過濾自己，
        //    故仍以跨使用者共享快取持有。
        //    ⚠️ P1：原本一起被整包載入此共享快取的 Accounts / PersonalSettings / 5 張 Map_Account_*，
        //         皆「隨帳號數成長」—— 10 萬帳號時整包常駐 6GB Sariel 會脹爆；且它們在回應中（admin 與
        //         非 admin 皆然）只需「呼叫者自己這列」。故已移出共享快取，改為下方步驟 3 的 per-caller
        //         點查（EmpId 為各表 PK 前導欄 → index seek）。徹底解 CLAUDE.md §8 的 P1 剩餘項。
        if (!_cache.TryGetValue(InitialDataCacheKey_Volatile, out Dictionary<string, object>? volatileData))
        {
            await _semaphore.WaitAsync();
            try
            {
                if (!_cache.TryGetValue(InitialDataCacheKey_Volatile, out volatileData))
                {
                    volatileData = new Dictionary<string, object>();
                    try
                    {
                        volatileData["Requests"] = ConvertToList(await _dbContext.Requests.AsNoTracking().ToListAsync());

                        _cache.Set(InitialDataCacheKey_Volatile, volatileData, TimeSpan.FromSeconds(10));
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Failed to load volatile (shared) data via EF Core.");
                    }
                }
            }
            finally
            {
                _semaphore.Release();
            }
        }

        if (globalData != null) foreach (var kvp in globalData) dbData[kvp.Key] = kvp.Value;
        if (volatileData != null) foreach (var kvp in volatileData) dbData[kvp.Key] = kvp.Value;

        // 3. ⭐️ P1：呼叫者「自己這列」的帳號相關表 —— per-caller 點查、不快取（always-fresh）。
        //    EmpId 為 Accounts(PK) / PersonalSettings(PK 前導) / 各 Map_Account_*(複合 PK 前導) 的索引前導欄
        //    → 全為 index seek、不全表掃描。取代「整包載入共享快取再由 Controller 過濾成自身列」。
        //    無 10 秒過時窗；個人版面/登入計數更新後仍靠 InvalidateVolatile() 的 ETag bump 觸發客戶端重抓。
        //    empId 為空字串（理論上不會，class-level [Authorize] 擋住）時各點查回空集合，安全。
        //    回應對 admin/非 admin 皆「只含自己這列」，與 P1 前的行為（Controller 收斂後）逐位元相同。
        dbData["Accounts"] = ConvertToList(await _dbContext.Accounts.AsNoTracking().Where(a => a.EmpId == empId).ToListAsync());
        dbData["PersonalSettings"] = ConvertToList(await _dbContext.PersonalSettings.AsNoTracking().Where(p => p.EmpId == empId).ToListAsync());
        dbData["Map_Account_Role"] = ConvertToList(await _dbContext.MapAccountRoles.AsNoTracking().Where(m => m.EmpId == empId).ToListAsync());
        dbData["Map_Account_ManageMenu"] = ConvertToList(await _dbContext.MapAccountManageMenus.AsNoTracking().Where(m => m.EmpId == empId).ToListAsync());
        dbData["Map_Account_DefaultPage"] = ConvertToList(await _dbContext.MapAccountDefaultPages.AsNoTracking().Where(m => m.EmpId == empId).ToListAsync());
        dbData["Map_Account_ExtraMenu"] = ConvertToList(await _dbContext.MapAccountExtraMenus.AsNoTracking().Where(m => m.EmpId == empId).ToListAsync());
        dbData["Map_Account_DenyMenu"] = ConvertToList(await _dbContext.MapAccountDenyMenus.AsNoTracking().Where(m => m.EmpId == empId).ToListAsync());

        // 若載入不全 (某部分 DB 斷線)，直接丟出例外，避免前端拿到殘缺快取。
        //   9 (global 共享快取) + 1 (Requests 共享快取) + 7 (per-caller 帳號相關表) = 17。
        if (dbData.Count < 17)
        {
            throw new Exception("部分資料表載入失敗，無法回傳完整的 InitialData");
        }

        return dbData;
    }

    public async Task<(bool success, string message)> SaveDataAsync(
        Dictionary<string, List<Dictionary<string, JsonElement>>> payload)
    {
        int successCount = 0;
        var errorLogs = new List<string>();

        // 全量覆寫 17 張表跨 DELETE+BULKINSERT，預設 30 秒對遠端 SQL Server 太短，
        //   實測 Sariel 遠端 + Excel 大資料量會在 DELETE FROM Menus / BULK INSERT 階段 timeout。
        //   一律放寬到 5 分鐘；本路徑只給 admin 手動觸發，不會造成 thread starvation 風險。
        const int CommandTimeoutSec = 300;

        // ⏱️ 效能量測：逐階段記錄耗時，匯入若變慢可從 log 直接看出卡在哪個階段 / 哪張表。
        var sw = System.Diagnostics.Stopwatch.StartNew();

        using var conn = new SqlConnection(_connStr);
        await conn.OpenAsync();
        _logger.LogInformation("[SaveData] 連線開啟 {Ms} ms", sw.ElapsedMilliseconds);
        using var trans = conn.BeginTransaction();

        // ⏱️ 設定鎖定逾時 (防禦性安全網)：若本交易要對某張表取得鎖、但該表被外部連線長期持鎖，
        //    預設會「無限等待」。改為最多等 20 秒、逾時丟 SqlException 1222，避免靜默卡死。
        //    註：2026-06-06 實測已排除「鎖等待」是匯入變慢的主因 —— EQDashboardV2 已開
        //    READ_COMMITTED_SNAPSHOT (讀不擋寫)，且實測 40 條併發讀 + 寫入仍 <1 秒。
        //    匯入若仍慢，請看下方逐表 Bulk 計時 log，並於慢的當下用 SSMS 查該 session 的 wait_type。
        try
        {
            using var lockTimeoutCmd = new SqlCommand("SET LOCK_TIMEOUT 20000;", conn, trans);
            await lockTimeoutCmd.ExecuteNonQueryAsync();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to set LOCK_TIMEOUT");
        }

        // 暫時停用所有相關資料表的 FK 限制，方便進行無順序的 DELETE/INSERT。
        //   ⚡ 原本每張表一個 round-trip (17 趟)，遠端 DB 光來回延遲就吃掉好幾秒；
        //      改成「一條 SQL 批次處理 17 張表」只需 1 趟 (TableNames 為硬編碼常數、無注入風險)。
        try
        {
            var disableSql = string.Join("\n", TableNames.Select(t => $"ALTER TABLE [{t}] NOCHECK CONSTRAINT ALL;"));
            using var disableFkCmd = new SqlCommand(disableSql, conn, trans);
            disableFkCmd.CommandTimeout = CommandTimeoutSec;
            await disableFkCmd.ExecuteNonQueryAsync();
        }
        catch (Exception ex)
        {
            // 第一個取鎖點：若這裡就 1222(取鎖逾時)，代表某張表正被外部連線鎖住，
            //   再往下做 DELETE/Bulk 也只會一直撞鎖，直接收手回報、不要傻等。
            var sqlEx = ex as Microsoft.Data.SqlClient.SqlException
                        ?? ex.InnerException as Microsoft.Data.SqlClient.SqlException;
            if (sqlEx != null && sqlEx.Number == 1222)
            {
                try { trans.Rollback(); } catch { }
                _logger.LogError(ex, "[SaveData] 停用 FK 約束時取鎖逾時(1222)：資料表正被其他連線鎖住");
                return (false, "資料表正被其他連線鎖定，等待 20 秒仍無法取得鎖，已取消匯入。" +
                               "請檢查是否有其他人開著 SSMS 未 commit 的交易、或長時間佔用的查詢，放掉後再匯入一次即可。");
            }
            _logger.LogWarning(ex, "Failed to disable FK constraints (batch)");
        }
        _logger.LogInformation("[SaveData] 停用 FK 約束 {Ms} ms", sw.ElapsedMilliseconds);

        var allMaxLengths = new Dictionary<string, Dictionary<string, int>>(StringComparer.OrdinalIgnoreCase);
        var allColumnTypes = new Dictionary<string, Dictionary<string, string>>(StringComparer.OrdinalIgnoreCase);
        var tableHasIdentity = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);

        // 一次性取得所有 Schema 資訊 (解決 N+1 Query 問題)
        try
        {
            var tableList = string.Join(",", TableNames.Select(t => $"'{t}'"));
            
            using var idCmd = new SqlCommand($@"
                SELECT t.name 
                FROM sys.columns c 
                JOIN sys.tables t ON c.object_id = t.object_id 
                WHERE c.is_identity = 1 AND t.name IN ({tableList})", conn, trans);
            idCmd.CommandTimeout = CommandTimeoutSec;
            using var idReader = await idCmd.ExecuteReaderAsync();
            while (await idReader.ReadAsync())
            {
                tableHasIdentity[idReader.GetString(0)] = true;
            }
            await idReader.CloseAsync();

            using var schemaCmd = new SqlCommand($@"
                SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_NAME IN ({tableList})", conn, trans);
            schemaCmd.CommandTimeout = CommandTimeoutSec;
            using var schemaReader = await schemaCmd.ExecuteReaderAsync();
            while (await schemaReader.ReadAsync())
            {
                string tName = schemaReader.GetString(0);
                string colName = schemaReader.GetString(1);
                string dataType = schemaReader.GetString(2).ToLower();
                int maxLen = schemaReader.IsDBNull(3) ? 0 : Convert.ToInt32(schemaReader.GetValue(3));

                if (!allMaxLengths.ContainsKey(tName)) allMaxLengths[tName] = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                if (!allColumnTypes.ContainsKey(tName)) allColumnTypes[tName] = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

                allMaxLengths[tName][colName] = maxLen;
                allColumnTypes[tName][colName] = dataType;
            }
            await schemaReader.CloseAsync();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to load bulk schema information");
        }
        _logger.LogInformation("[SaveData] 載入 Schema {Ms} ms", sw.ElapsedMilliseconds);

        // ⚡ 一次撈所有表的舊筆數 (UNION ALL)，取代原本「每張表一個 COUNT」的 17 趟 round-trip。
        var oldCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        try
        {
            var countSql = string.Join("\nUNION ALL\n",
                TableNames.Select(t => $"SELECT '{t}' AS T, COUNT(*) AS C FROM [{t}]"));
            using var countCmd = new SqlCommand(countSql, conn, trans);
            countCmd.CommandTimeout = CommandTimeoutSec;
            using var cReader = await countCmd.ExecuteReaderAsync();
            while (await cReader.ReadAsync())
                oldCounts[cReader.GetString(0)] = Convert.ToInt32(cReader.GetValue(1));
            await cReader.CloseAsync();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to load bulk row counts");
        }
        _logger.LogInformation("[SaveData] 統計舊筆數 {Ms} ms", sw.ElapsedMilliseconds);

        foreach (var tableName in TableNames)
        {
            if (!payload.ContainsKey(tableName) || payload[tableName] == null) continue;
            var tableData = payload[tableName];

            // 檢查是否有真實有效的資料
            bool hasAnyValidData = tableData.Any(row =>
                row != null && row.Count > 0 && row.Any(p =>
                    p.Value.ValueKind != JsonValueKind.Null &&
                    p.Value.ValueKind != JsonValueKind.Undefined &&
                    !string.IsNullOrWhiteSpace(p.Value.ToString())));

            if (!hasAnyValidData) continue;

            // 確認資料表是否存在 (直接判斷 schema 是否有抓到該表)
            if (!allColumnTypes.ContainsKey(tableName)) continue;

            // 防呆：比對舊筆數 vs 新筆數（舊筆數已於上方一次批次撈好）
            int oldCount = oldCounts.TryGetValue(tableName, out var oc) ? oc : 0;

            int newCount = tableData.Count(row => row != null && row.Any(p =>
                p.Value.ValueKind != JsonValueKind.Null &&
                p.Value.ValueKind != JsonValueKind.Undefined &&
                !string.IsNullOrWhiteSpace(p.Value.ToString())));

            if (oldCount >= 5 && newCount < oldCount * 0.2)
            {
                errorLogs.Add($"[{tableName}] 拒絕覆寫：原 {oldCount} 筆，新資料僅 {newCount} 筆（縮減超過 80%），本表略過。");
                continue;
            }

            // 清空舊資料
            long tBeforeDelete = sw.ElapsedMilliseconds;
            using (var cmd = new SqlCommand($"DELETE FROM [{tableName}]", conn, trans))
            {
                cmd.CommandTimeout = CommandTimeoutSec;
                await cmd.ExecuteNonQueryAsync();
            }
            long tAfterDelete = sw.ElapsedMilliseconds;
            if (tAfterDelete - tBeforeDelete > 500)
                _logger.LogWarning("[SaveData] ⚠️ 表 {Table} DELETE 耗時 {Ms} ms (可能遭外部連線鎖定阻塞)", tableName, tAfterDelete - tBeforeDelete);

            // 獲取 Schema 資訊 (由外部批次抓取的快取直接給予)
            bool hasIdentity = tableHasIdentity.ContainsKey(tableName);
            var columnMaxLengths = allMaxLengths.ContainsKey(tableName) ? allMaxLengths[tableName] : new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            var columnTypes = allColumnTypes.ContainsKey(tableName) ? allColumnTypes[tableName] : new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

            if (hasIdentity)
            {
                try
                {
                    using var cmdOn = new SqlCommand($"SET IDENTITY_INSERT [{tableName}] ON", conn, trans);
                    cmdOn.CommandTimeout = CommandTimeoutSec;
                    await cmdOn.ExecuteNonQueryAsync();
                }
                catch { }
            }

            try
            {
                var dt = new DataTable(tableName);
                foreach (var kvp in columnTypes)
                {
                    Type type = typeof(string);
                    string dbType = kvp.Value;
                    if (dbType.Contains("int")) type = typeof(long);
                    else if (dbType.Contains("float") || dbType.Contains("decimal") || dbType.Contains("numeric")) type = typeof(double);
                    else if (dbType.Contains("bit")) type = typeof(bool);
                    else if (dbType.Contains("date") || dbType.Contains("time")) type = typeof(DateTime);
                    
                    dt.Columns.Add(kvp.Key, Nullable.GetUnderlyingType(type) ?? type);
                }

                foreach (var row in tableData)
                {
                    bool hasActualRowData = row.Any(p =>
                        p.Value.ValueKind != JsonValueKind.Null &&
                        p.Value.ValueKind != JsonValueKind.Undefined &&
                        !string.IsNullOrWhiteSpace(p.Value.ToString()));
                    if (!hasActualRowData) continue;

                    var newRow = dt.NewRow();
                    foreach (var prop in row)
                    {
                        string colName = prop.Key;
                        var actualCol = dt.Columns.Cast<DataColumn>().FirstOrDefault(c => c.ColumnName.Equals(colName, StringComparison.OrdinalIgnoreCase));
                        if (actualCol == null) continue;

                        JsonElement val = prop.Value;
                        if (val.ValueKind == JsonValueKind.Null || val.ValueKind == JsonValueKind.Undefined)
                        {
                            if (newRow[actualCol] == DBNull.Value) newRow[actualCol] = DBNull.Value;
                            continue;
                        }

                        string strVal = val.ToString();
                        if (string.IsNullOrEmpty(strVal))
                        {
                            if (newRow[actualCol] == DBNull.Value) newRow[actualCol] = DBNull.Value;
                            continue;
                        }

                        // ⭐️ 大小寫重複欄位保護（例如 JSON 中同時有 IconBase64 實體路徑與 iconBase64 空字串），若已有有效值則不上蓋空字串
                        if (newRow[actualCol] != DBNull.Value && !string.IsNullOrEmpty(newRow[actualCol]?.ToString()))
                        {
                            continue;
                        }

                        // ⭐️ 若為 Apps 或 Menus 的圖標欄位且帶有 data: base64，立即轉存為 /images/icons/*.jpg 實體圖檔
                        if (strVal.StartsWith("data:", StringComparison.OrdinalIgnoreCase) && _iconStorage != null)
                        {
                            if ((tableName.Equals("Apps", StringComparison.OrdinalIgnoreCase) && actualCol.ColumnName.Equals("IconBase64", StringComparison.OrdinalIgnoreCase)) ||
                                (tableName.Equals("Menus", StringComparison.OrdinalIgnoreCase) && actualCol.ColumnName.Equals("Icon", StringComparison.OrdinalIgnoreCase)))
                            {
                                var savedUrl = await _iconStorage.SaveAsync(strVal);
                                if (!string.IsNullOrEmpty(savedUrl)) strVal = savedUrl;
                            }
                        }

                        string dbType = columnTypes.ContainsKey(actualCol.ColumnName) ? columnTypes[actualCol.ColumnName] : "";
                        if (dbType.Contains("char") || dbType.Contains("text"))
                        {
                            int maxLen = columnMaxLengths.ContainsKey(actualCol.ColumnName) ? columnMaxLengths[actualCol.ColumnName] : 0;
                            if (maxLen > 0 && maxLen < 10000000 && strVal.Length > maxLen)
                                strVal = strVal[..maxLen];
                            newRow[actualCol] = strVal;
                        }
                        else if (dbType.Contains("bit"))
                        {
                            newRow[actualCol] = (val.ValueKind == JsonValueKind.True || strVal.Equals("true", StringComparison.OrdinalIgnoreCase) || strVal == "1");
                        }
                        else if (dbType.Contains("int"))
                        {
                            if (long.TryParse(strVal, out long parsedLong)) newRow[actualCol] = parsedLong;
                            else newRow[actualCol] = DBNull.Value;
                        }
                        else if (dbType.Contains("float") || dbType.Contains("decimal") || dbType.Contains("numeric"))
                        {
                            if (double.TryParse(strVal, out double parsedDouble)) newRow[actualCol] = parsedDouble;
                            else newRow[actualCol] = DBNull.Value;
                        }
                        else if (dbType.Contains("date") || dbType.Contains("time"))
                        {
                            if (DateTime.TryParse(strVal, out DateTime parsedDate)) newRow[actualCol] = parsedDate;
                            else newRow[actualCol] = DBNull.Value;
                        }
                        else
                        {
                            newRow[actualCol] = strVal;
                        }
                    }
                    dt.Rows.Add(newRow);
                }

                // 改用「批次多列參數化 INSERT」取代 SqlBulkCopy。
                // 根因(2026-06-06 同主機實測)：Sariel 僅 6GB RAM，SQL Server Target Memory 被壓到 ~1.4GB，
                //   記憶體吃緊。SqlBulkCopy 的「大量載入(bulk load)」需向 RESOURCE_SEMAPHORE 申請 workspace
                //   memory grant；記憶體壓力下該 grant 會排隊等待(cumulative wait avg ~49 秒、forced_grant=5)，
                //   造成匯入卡 2~3 分鐘。一般 INSERT...VALUES 不需要 workspace memory grant，完全繞過
                //   RESOURCE_SEMAPHORE。本系統資料量極小(全表合計約 111 筆)，批次 INSERT 反而更快更穩。
                long tBeforeBulk = sw.ElapsedMilliseconds;
                if (dt.Rows.Count > 0)
                {
                    var colNames = dt.Columns.Cast<DataColumn>().Select(c => c.ColumnName).ToList();
                    int colCount = colNames.Count;
                    string colList = string.Join(", ", colNames.Select(c => $"[{c}]"));
                    // SQL Server 限制：單一命令參數上限 2100、單一 INSERT...VALUES 上限 1000 列；取較保守者分批
                    int batchSize = Math.Max(1, Math.Min(1000, 2000 / Math.Max(1, colCount)));

                    for (int start = 0; start < dt.Rows.Count; start += batchSize)
                    {
                        int count = Math.Min(batchSize, dt.Rows.Count - start);
                        var valueClauses = new List<string>(count);
                        using var insertCmd = new SqlCommand { Connection = conn, Transaction = trans, CommandTimeout = CommandTimeoutSec };
                        int pIdx = 0;
                        for (int r = 0; r < count; r++)
                        {
                            var srcRow = dt.Rows[start + r];
                            var placeholders = new string[colCount];
                            for (int c = 0; c < colCount; c++)
                            {
                                string pn = "@p" + pIdx++;
                                placeholders[c] = pn;
                                insertCmd.Parameters.AddWithValue(pn, srcRow[colNames[c]] ?? DBNull.Value);
                            }
                            valueClauses.Add("(" + string.Join(", ", placeholders) + ")");
                        }
                        insertCmd.CommandText = $"INSERT INTO [{tableName}] ({colList}) VALUES {string.Join(", ", valueClauses)}";
                        await insertCmd.ExecuteNonQueryAsync();
                    }
                }
                long tAfterBulk = sw.ElapsedMilliseconds;

                // 還原 IDENTITY_INSERT (一個 session 同時只能有一張表 ON；不關掉會害下一張 identity 表 SET ON 失敗)
                if (hasIdentity)
                {
                    try
                    {
                        using var cmdOff = new SqlCommand($"SET IDENTITY_INSERT [{tableName}] OFF", conn, trans);
                        cmdOff.CommandTimeout = CommandTimeoutSec;
                        await cmdOff.ExecuteNonQueryAsync();
                    }
                    catch { }
                }

                successCount += dt.Rows.Count;
                _logger.LogInformation("[SaveData] 表 {Table} 寫入 {Rows} 筆 (DELETE後→INSERT {BulkMs} ms，累計 {Ms} ms)", tableName, dt.Rows.Count, tAfterBulk - tBeforeBulk, sw.ElapsedMilliseconds);
            }
            catch (Exception ex)
            {
                try { trans.Rollback(); } catch { } // 安全的 Rollback，避免因交易已失敗而拋出例外導致 Request 卡死

                // SQL 1222 = Lock request time out：代表這張表正被「其他連線」鎖住放不掉，
                //   不是程式慢，也不是資料有問題。回一個 admin 看得懂的訊息直接點名兇手。
                var sqlEx = ex as Microsoft.Data.SqlClient.SqlException
                            ?? ex.InnerException as Microsoft.Data.SqlClient.SqlException;
                if (sqlEx != null && sqlEx.Number == 1222)
                {
                    _logger.LogError(ex, "[{TableName}] 取得鎖逾時(1222)：該表正被其他連線鎖住", tableName);
                    return (false, $"[{tableName}] 資料表正被其他連線鎖定，等待 20 秒仍無法取得鎖，已取消全部異動。" +
                                   "請檢查是否有其他人開著 SSMS 未 commit 的交易、或長時間佔用的查詢，放掉後再匯入一次即可。");
                }

                _logger.LogError(ex, "[{TableName}] 批次匯入失敗，已退回所有變更", tableName);
                // SaveData 是 admin-only，把實際 SQL 訊息回給 admin 才能定位是哪個欄位/型別問題
                //   (Round-7：之前怕洩漏所以隱藏，但 admin 看不到等於要去翻 server log，太不友善)
                var detail = ex.Message;
                if (ex.InnerException != null) detail += " | " + ex.InnerException.Message;
                return (false, $"[{tableName}] 資料寫入失敗，已取消全部異動。錯誤詳情：{detail}");
            }
        }

        // 重新啟用 FK 限制並「重新驗證既有資料」(1.1)。
        //   原本用 WITH NOCHECK CHECK：constraint 雖被啟用，但 SQL Server 標記為「not trusted」，
        //   既有列不重驗。後果：① 全量匯入若混入孤兒 FK，靜默殘留資料完整性破口；
        //   ② 查詢最佳化器不信任 not-trusted constraint，無法做 join elimination 等優化。
        //   改成 WITH CHECK CHECK：commit 前在交易內重新驗證全部 FK；若有孤兒列會在此拋錯 → 整批 rollback，
        //   寧可整批失敗也不要寫進不完整資料 (此端點為 admin-only 全量覆寫，正確性 > 速度)。
        try
        {
            var enableSql = string.Join("\n", TableNames.Select(t => $"ALTER TABLE [{t}] WITH CHECK CHECK CONSTRAINT ALL;"));
            using var enableFkCmd = new SqlCommand(enableSql, conn, trans);
            enableFkCmd.CommandTimeout = CommandTimeoutSec;
            await enableFkCmd.ExecuteNonQueryAsync();
        }
        catch (Exception ex)
        {
            // ⚠️ 改用 WITH CHECK 後，這裡失敗代表「匯入的資料違反 FK 完整性」(或重驗時取鎖逾時)。
            //   絕不可像舊版那樣吞掉後繼續 commit — 那會寫進孤兒資料。一律 rollback 整批並回報 admin。
            _logger.LogError(ex, "[SaveData] FK 重新驗證失敗，已退回所有變更");
            try { trans.Rollback(); } catch (Exception rbEx) { _logger.LogWarning(rbEx, "[SaveData] FK 驗證失敗後 rollback 也失敗"); }
            var fkDetail = ex.Message;
            if (ex.InnerException != null) fkDetail += " | " + ex.InnerException.Message;
            return (false, $"資料外鍵完整性驗證失敗，已取消全部異動（可能有對應不到的關聯 Id）。錯誤詳情：{fkDetail}");
        }
        _logger.LogInformation("[SaveData] 重新啟用 FK {Ms} ms", sw.ElapsedMilliseconds);

        trans.Commit();
        _logger.LogInformation("[SaveData] ✅ 全部完成，總耗時 {Ms} ms (成功寫入 {Count} 筆)", sw.ElapsedMilliseconds, successCount);

        // 寫入成功後，清除快取
        InvalidateInitialDataCache();

        if (errorLogs.Count > 0)
        {
            string htmlMsg = $"<b>匯入完畢，成功: {successCount} 筆，略過異常: {errorLogs.Count} 筆。</b><br>" +
                "<div style='max-height:250px; overflow-y:auto; text-align:left; font-size:0.8rem; margin-top:10px; padding:10px; background:#f8d7da; color:#721c24; border-radius:5px;'>" +
                string.Join("<br>", errorLogs.Select(e => $"• {e}")) +
                "</div><div style='margin-top:10px; font-size:0.8rem; color:#666;'>請檢查上述資料是否包含不合法的空值或是文字塞入數字欄位。正常的資料已順利寫入資料庫。</div>";
            return (true, htmlMsg);
        }

        return (true, $"全部資料 ({successCount} 筆) 已成功同步至資料庫！");
    }

    // 委派給 Singleton invalidator（與 EF SaveChanges 攔截器共用同一份快取 key/ETag）。
    //   raw ADO 的 SaveDataAsync 不經 EF SaveChanges，故仍須在此顯式呼叫（攔截器不會替它作廢）。
    public void InvalidateInitialDataCache() => _cacheInvalidator.Invalidate();

    public void InvalidateVolatileDataCache() => _cacheInvalidator.InvalidateVolatile();

    public async Task<(bool success, int loginCount, string? lastLoginTime, string? errorMessage)> UpdateLoginStatsAsync(string empId)
    {
        if (string.IsNullOrWhiteSpace(empId))
            return (false, 0, null, "EmpId 為必填欄位");

        using var conn = new SqlConnection(_connStr);
        await conn.OpenAsync();

        // O4：LoginCount / LastLoginTime 欄位已由 SchemaBootstrap.EnsureAccountStatsColumnsAsync 在啟動時補齊，
        //     此處不再每次登入跑一次 IF COL_LENGTH ... ALTER 探測（DDL 探測對每次登入是多餘負擔）。

        // ⭐️ P4：UPDATE 累計 +1 與「取回最新值」合併為「單一語句 + OUTPUT」一次往返
        //     （原本 UPDATE 之後再 SELECT＝兩次 round trip）。
        //     OUTPUT INSERTED.* 回傳 SET 之後的新值；單語句天然原子 —— 消除「UPDATE 成功後、SELECT 前
        //     被其他並行登入再加一」而讀到非自己這次寫入值的窗（雖罕見、語意上更正確）。
        //     reader 無列 ⟹ WHERE 未命中任何帳號 ⟹ 帳號不存在。
        using var cmd = new SqlCommand(@"
            UPDATE Accounts
            SET LoginCount = ISNULL(LoginCount, 0) + 1,
                LastLoginTime = GETDATE()
            OUTPUT ISNULL(INSERTED.LoginCount, 0), INSERTED.LastLoginTime
            WHERE EmpId = @EmpId;", conn);
        cmd.Parameters.AddWithValue("@EmpId", empId);

        using var r = await cmd.ExecuteReaderAsync();
        if (await r.ReadAsync())
        {
            int loginCount = Convert.ToInt32(r.GetValue(0));
            DateTime? lastLogin = r.IsDBNull(1) ? null : Convert.ToDateTime(r.GetValue(1));
            return (true, loginCount,
                lastLogin?.ToString("yyyy-MM-dd HH:mm:ss"), null);
        }

        return (false, 0, null, "找不到帳號 " + empId);
    }
}
