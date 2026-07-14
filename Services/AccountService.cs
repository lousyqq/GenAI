using GenAI.Controllers;
using GenAI.Data;
using GenAI.Models;
using GenAI.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace GenAI.Services;

public class AccountService : IAccountService
{
    private readonly AppDbContext _context;
    private readonly ISettingsService _settingsService;

    public AccountService(AppDbContext context, ISettingsService settingsService)
    {
        _context = context;
        _settingsService = settingsService;
    }

    public async Task<(List<object> items, int total)> GetAccountsPagedAsync(int page, int pageSize, string? q)
    {
        // 分頁/搜尋一律下推 DB（WHERE + Skip/Take），不再把全表撈進記憶體再過濾。
        if (page < 1) page = 1;
        if (pageSize < 1) pageSize = 10;
        if (pageSize > 100) pageSize = 100; // 上限保護：避免惡意 pageSize 把全表一次撈出

        var query = _context.Accounts.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = q.Trim();
            // 搜尋字串長度上限保護：被比對的欄位最長為 Name/Department=nvarchar(100)，
            //   超過 100 字的 term 不可能是任何欄位的子字串（搜不到東西），故截斷無功能損失；
            //   同時避免過長 term 讓 EF 的 LIKE '%'+@p+'%' 參數超過 nvarchar(4000) → SqlException 8152「字串會被截斷」(500)。
            if (term.Length > 100) term = term.Substring(0, 100);
            // EF 會參數化（無 SQL 注入風險）；EmpId/Name/Department 模糊比對。
            // ⭐️ P2 效能註記：子字串 `Contains` → `LIKE '%term%'`（前置萬用字元）本質 non-sargable，
            //     無法用 B-tree seek、只能掃描（O(N)）。維持子字串 UX 的前提下，已在 SchemaBootstrap
            //     建窄覆蓋索引 IX_Accounts_Search(Name, Department)（葉層自動含 clustered key EmpId）：
            //     不可避免的掃描改讀這條瘦索引而非整個寬 Accounts 表，COUNT(*) 的三欄 OR-of-LIKE 全被涵蓋、免回主表。
            //     若改成 StartsWith/前綴比對才能 index seek（會改變子字串搜尋語意）；真正子線性需 full-text（過度設計、不在範圍）。
            query = query.Where(a =>
                a.EmpId.Contains(term) ||
                (a.Name != null && a.Name.Contains(term)) ||
                (a.Department != null && a.Department.Contains(term)));
        }

        var total = await query.CountAsync();

        // 先用穩定排序 + Skip/Take 取「本頁的 root 帳號」，再 Include 兩個一對多 collection。
        //   2 個 collection-Include → AsSplitQuery 避免 cartesian 相乘（對齊 §6.2 規範）。
        var pageAccounts = await query
            .OrderBy(a => a.EmpId)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Include(a => a.MapAccountRoles)
            .Include(a => a.MapAccountDefaultPages)
            .AsSplitQuery()
            .ToListAsync();

        var items = pageAccounts.Select(a => new
        {
            empId = a.EmpId,
            name = a.Name,
            department = a.Department,
            roleLevel = a.RoleLevel,
            assignedRoles = a.MapAccountRoles?.Select(m => m.RoleId).ToList() ?? new List<string>(),
            // 帳號管理列表只顯示「登入預設首頁」與「可視群組版面」→ 需 defaultPages + assignedRoles 即可
            defaultPages = a.MapAccountDefaultPages?.ToDictionary(m => m.FabId, m => m.MenuId ?? "") ?? new Dictionary<string, string>()
        }).Cast<object>().ToList();

        return (items, total);
    }

    public async Task<List<object>> GetAccountsForExportAsync()
    {
        // Excel 匯出（全量備份）：admin 明確觸發、非熱路徑，故可一次撈全部帳號的完整明細。
        //   3 個 collection-Include → AsSplitQuery 避免 cartesian 相乘。
        var accounts = await _context.Accounts.AsNoTracking()
            .Include(a => a.MapAccountRoles)
            .Include(a => a.MapAccountManageMenus)
            .Include(a => a.MapAccountDefaultPages)
            .AsSplitQuery()
            .OrderBy(a => a.EmpId)
            .ToListAsync();

        return accounts.Select(a => new
        {
            empId = a.EmpId,
            name = a.Name,
            department = a.Department,
            roleLevel = a.RoleLevel,
            canEditOthers = a.CanEditOthers,
            assignedRoles = a.MapAccountRoles?.Select(m => m.RoleId).ToList() ?? new List<string>(),
            manageableMenus = a.MapAccountManageMenus?.Select(m => m.MenuId).ToList() ?? new List<string>(),
            defaultPages = a.MapAccountDefaultPages?.ToDictionary(m => m.FabId, m => m.MenuId ?? "") ?? new Dictionary<string, string>()
        }).Cast<object>().ToList();
    }

    public async Task<object?> GetAccountDetailsAsync(string empId)
    {
        var a = await _context.Accounts
            .AsNoTracking()
            .Include(x => x.MapAccountRoles)
            .Include(x => x.MapAccountManageMenus)
            .Include(x => x.MapAccountDefaultPages)
            .Include(x => x.MapAccountExtraMenus)
            .Include(x => x.MapAccountDenyMenus)
            .AsSplitQuery() // 5 個 collection-Include 避免 cartesian 相乘
            .FirstOrDefaultAsync(x => x.EmpId == empId);

        if (a == null) return null;

        return new
        {
            empId = a.EmpId,
            name = a.Name,
            department = a.Department,
            roleLevel = a.RoleLevel,
            canEditOthers = a.CanEditOthers,
            assignedRoles = a.MapAccountRoles?.Select(m => m.RoleId).ToList() ?? new List<string>(),
            manageableMenus = a.MapAccountManageMenus?.Select(m => m.MenuId).ToList() ?? new List<string>(),
            // per-fab：以 FabId 分組成 { fabId: [menuId,...] }
            extraMenus = GroupOverridesByFab(a.MapAccountExtraMenus?.Select(m => (m.FabId, m.MenuId))),
            denyMenus = GroupOverridesByFab(a.MapAccountDenyMenus?.Select(m => (m.FabId, m.MenuId))),
            defaultPages = a.MapAccountDefaultPages?.ToDictionary(m => m.FabId, m => m.MenuId ?? "") ?? new Dictionary<string, string>()
        };
    }

    /// <summary>把 per-fab 覆寫關聯列 [(FabId, MenuId)] 分組成 { fabId: [menuId,...] }（前端字典形狀）。</summary>
    private static Dictionary<string, List<string>> GroupOverridesByFab(IEnumerable<(string FabId, string MenuId)>? rows)
    {
        var dict = new Dictionary<string, List<string>>();
        if (rows == null) return dict;
        foreach (var (fabId, menuId) in rows)
        {
            var key = fabId ?? string.Empty;
            if (!dict.TryGetValue(key, out var list)) { list = new List<string>(); dict[key] = list; }
            if (!list.Contains(menuId)) list.Add(menuId);
        }
        return dict;
    }

    public async Task<(bool success, string errorMessage)> CreateAccountAsync(AccountFullDto dto)
    {
        if (await _context.Accounts.AnyAsync(a => a.EmpId == dto.EmpId))
            return (false, "帳號工號已存在");

        // ⚠️ 資料完整性：先驗證所有要寫入的 RoleId / MenuId 都存在（對齊 Roles/Fabs controller 的 1.3 預檢），
        //   stale id 直接回 400 + 明確訊息，避免撞 FK 拋 500。
        var (refsOk, refsErr) = await ValidateMappingRefsAsync(dto);
        if (!refsOk) return (false, refsErr);

        var account = new Account
        {
            EmpId = dto.EmpId,
            Name = dto.Name,
            Department = dto.Department,
            RoleLevel = dto.RoleLevel,
            CanEditOthers = dto.CanEditOthers
        };

        _context.Accounts.Add(account);
        UpdateAccountMappings(dto);

        // Create 為單一 SaveChanges（本身即原子）；mappings 與 account 同一交易寫入。
        await _context.SaveChangesAsync();
        _settingsService.InvalidateInitialDataCache();
        return (true, string.Empty);
    }

    /// <summary>
    /// 資料完整性預檢：驗證 DTO 內所有 RoleId / MenuId 參照都存在於 DB。
    ///   Map_Account_Role.RoleId、Map_Account_ManageMenu/DefaultPage/ExtraMenu/DenyMenu.MenuId 皆有 FK，
    ///   stale id 會在寫入時撞 FK。先在這裡查出來回 400，避免到 SaveChanges 才 500。
    ///   （DefaultPages 的 FabId 故意不驗——Extra/Deny 的 FabId 無 FK；DefaultPage 的 FabId 雖有 FK，
    ///     但交給下方 UpdateAccountAsync 的交易保護即可，stale FabId 也只會整批 rollback、不丟資料。）
    /// </summary>
    private async Task<(bool ok, string error)> ValidateMappingRefsAsync(AccountFullDto dto)
    {
        var roleIds = (dto.AssignedRoles ?? new List<string>())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();

        var menuIds = new List<string>();
        if (dto.ManageableMenus != null) menuIds.AddRange(dto.ManageableMenus);
        if (dto.DefaultPages != null) menuIds.AddRange(dto.DefaultPages.Values);
        if (dto.ExtraMenus != null)
            foreach (var v in dto.ExtraMenus.Values) if (v != null) menuIds.AddRange(v);
        if (dto.DenyMenus != null)
            foreach (var v in dto.DenyMenus.Values) if (v != null) menuIds.AddRange(v);
        menuIds = menuIds.Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();

        if (roleIds.Count > 0)
        {
            var existing = (await _context.Roles.Where(r => roleIds.Contains(r.RoleId)).Select(r => r.RoleId).ToListAsync())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            var missing = roleIds.Where(r => !existing.Contains(r)).ToList();
            if (missing.Count > 0) return (false, $"下列角色不存在，無法指派：{string.Join(", ", missing)}");
        }
        if (menuIds.Count > 0)
        {
            var existing = (await _context.Menus.Where(m => menuIds.Contains(m.MenuId)).Select(m => m.MenuId).ToListAsync())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            var missing = menuIds.Where(m => !existing.Contains(m)).ToList();
            if (missing.Count > 0) return (false, $"下列看板不存在，無法指派：{string.Join(", ", missing)}");
        }
        return (true, string.Empty);
    }

    public async Task<(bool success, string errorMessage, bool notFound)> UpdateAccountAsync(string empId, AccountFullDto dto)
    {
        // ⚠️ 強制 dto.EmpId = path 的 empId。
        //   原本 bug：UpdateAccountMappings 用 dto.EmpId 寫到 Map_Account_*，但找 account 用 path 的 empId。
        //   兩者不一致時 (admin 改錯欄位/惡意提交)：
        //     - 找到的 account = path 的 (e.g., user)，刪掉它的 mappings
        //     - 寫新 mappings 用 dto.EmpId (e.g., 00058897)
        //     - 結果：user 的 mappings 全沒了、00058897 多了不該有的 mappings
        //   修法：永遠以 path 為事實來源，body 的 EmpId 忽略。
        dto.EmpId = empId;

        var account = await _context.Accounts
            .Include(a => a.MapAccountRoles)
            .Include(a => a.MapAccountManageMenus)
            .Include(a => a.MapAccountDefaultPages)
            .Include(a => a.MapAccountExtraMenus)
            .Include(a => a.MapAccountDenyMenus)
            .AsSplitQuery() // 5 個 collection-Include 避免 cartesian 相乘
            .FirstOrDefaultAsync(a => a.EmpId == empId);

        if (account == null) return (false, "找不到指定的帳號", true); // 真的不存在 → 404

        if (string.Equals(empId, "admin", StringComparison.OrdinalIgnoreCase))
        {
            if (!string.Equals(dto.RoleLevel, "admin", StringComparison.OrdinalIgnoreCase))
                return (false, "系統預設管理員 (admin) 不可被降級", false); // 策略拒絕、帳號存在 → 400
        }

        // ⚠️ 資料完整性：先驗證所有 RoleId / MenuId 都存在（對齊 Roles/Fabs controller 的 1.3 預檢）。
        //   下方「刪舊 mappings → 寫新 mappings」必須整批原子，否則 stale id 撞 FK 會在刪除已 commit 後失敗 →
        //   帳號 mappings 被清空、權限全失且無法回復。先預檢可把常見 stale id 擋成清楚的 400。
        var (refsOk, refsErr) = await ValidateMappingRefsAsync(dto);
        if (!refsOk) return (false, refsErr, false); // 驗證失敗（stale id）、帳號存在 → 400

        account.Name = dto.Name;
        account.Department = dto.Department;
        account.RoleLevel = dto.RoleLevel;
        account.CanEditOthers = dto.CanEditOthers;

        // ⚠️ 原子性：原本「刪 mappings→SaveChanges→寫 mappings→SaveChanges」無交易，第二段失敗會留下被清空的帳號。
        //   改包單一交易：任一步失敗整批 rollback、舊 mappings 完整保留。
        //   ⚠️ DbContext 已啟用 EnableRetryOnFailure → 手動交易必須透過 ExecutionStrategy 執行
        //     （同 MenusController.BatchUpdateMenus；否則拋 "does not support user-initiated transactions"）。
        var strategy = _context.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                if (account.MapAccountRoles != null) _context.MapAccountRoles.RemoveRange(account.MapAccountRoles);
                if (account.MapAccountManageMenus != null) _context.MapAccountManageMenus.RemoveRange(account.MapAccountManageMenus);
                if (account.MapAccountDefaultPages != null) _context.MapAccountDefaultPages.RemoveRange(account.MapAccountDefaultPages);
                if (account.MapAccountExtraMenus != null) _context.MapAccountExtraMenus.RemoveRange(account.MapAccountExtraMenus);
                if (account.MapAccountDenyMenus != null) _context.MapAccountDenyMenus.RemoveRange(account.MapAccountDenyMenus);

                await _context.SaveChangesAsync(); // flush DELETE，避免同 PK 的 DELETE+INSERT tracking 衝突

                UpdateAccountMappings(dto);

                await _context.SaveChangesAsync();
                await transaction.CommitAsync();
            }
            catch
            {
                await transaction.RollbackAsync();
                throw;
            }
        });

        _settingsService.InvalidateInitialDataCache();
        return (true, string.Empty, false);
    }

    public async Task<(bool success, string errorMessage, string? backupJson)> DeleteAccountAsync(string empId, string? currentEmpId = null)
    {
        var account = await _context.Accounts
            .Include(a => a.MapAccountRoles)
            .Include(a => a.MapAccountManageMenus)
            .Include(a => a.MapAccountDefaultPages)
            .Include(a => a.MapAccountExtraMenus)
            .Include(a => a.MapAccountDenyMenus)
            .AsSplitQuery() // 5 個 collection-Include 避免 cartesian 相乘
            .FirstOrDefaultAsync(a => a.EmpId == empId);

        if (account == null) return (false, "找不到該帳號", null);

        if (string.Equals(empId, "admin", StringComparison.OrdinalIgnoreCase))
            return (false, "系統預設管理員 (admin) 不可被刪除", null);

        // 🛡️ 擋自刪：避免 admin 把自己刪了之後 cookie 還在但 DB 已查無，後續所有 [Authorize] 查 DB 都會踩 NotFound
        if (!string.IsNullOrEmpty(currentEmpId) && string.Equals(empId, currentEmpId, StringComparison.OrdinalIgnoreCase))
            return (false, "不可刪除目前登入中的帳號", null);

        // 🛡️ 擋最後一個 admin：刪掉後若整個系統剩 0 個 RoleLevel='admin' 帳號 → 永久失去管理員、需改 DB 救援
        if (string.Equals(account.RoleLevel, "admin", StringComparison.OrdinalIgnoreCase))
        {
            var remainingAdmins = await _context.Accounts
                .Where(a => a.EmpId != empId && a.RoleLevel != null && a.RoleLevel.ToLower() == "admin")
                .CountAsync();
            if (remainingAdmins == 0)
                return (false, "不可刪除系統中唯一的管理員帳號", null);
        }

        if (account.MapAccountRoles != null && account.MapAccountRoles.Count > 0)
            _context.MapAccountRoles.RemoveRange(account.MapAccountRoles);
        if (account.MapAccountManageMenus != null && account.MapAccountManageMenus.Count > 0)
            _context.MapAccountManageMenus.RemoveRange(account.MapAccountManageMenus);
        if (account.MapAccountDefaultPages != null && account.MapAccountDefaultPages.Count > 0)
            _context.MapAccountDefaultPages.RemoveRange(account.MapAccountDefaultPages);
        if (account.MapAccountExtraMenus != null && account.MapAccountExtraMenus.Count > 0)
            _context.MapAccountExtraMenus.RemoveRange(account.MapAccountExtraMenus);
        if (account.MapAccountDenyMenus != null && account.MapAccountDenyMenus.Count > 0)
            _context.MapAccountDenyMenus.RemoveRange(account.MapAccountDenyMenus);

        var pSettings = await _context.PersonalSettings.Where(p => p.EmpId == empId).ToListAsync();
        if (pSettings.Count > 0) _context.PersonalSettings.RemoveRange(pSettings);

        var backupJson = System.Text.Json.JsonSerializer.Serialize(account, new System.Text.Json.JsonSerializerOptions { ReferenceHandler = System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles });

        _context.Accounts.Remove(account);
        await _context.SaveChangesAsync();
        _settingsService.InvalidateInitialDataCache();
        return (true, string.Empty, backupJson);
    }

    private void UpdateAccountMappings(AccountFullDto dto)
    {
        if (dto.AssignedRoles != null)
        {
            // 複合 PK (EmpId+RoleId)：payload 內重複 roleId 會撞 EF identity map「same key already tracked」→ 500。
            foreach (var rId in dto.AssignedRoles.Distinct())
            {
                _context.MapAccountRoles.Add(new MapAccountRole { EmpId = dto.EmpId, RoleId = rId });
            }
        }

        if (dto.ManageableMenus != null)
        {
            // 複合 PK (EmpId+MenuId)：同上，Add 前去重。
            foreach (var mId in dto.ManageableMenus.Distinct())
            {
                _context.MapAccountManageMenus.Add(new MapAccountManageMenu { EmpId = dto.EmpId, MenuId = mId });
            }
        }

        if (dto.DefaultPages != null)
        {
            foreach (var kvp in dto.DefaultPages)
            {
                _context.MapAccountDefaultPages.Add(new MapAccountDefaultPage { EmpId = dto.EmpId, FabId = kvp.Key, MenuId = kvp.Value });
            }
        }

        // per-fab：ExtraMenus/DenyMenus 為 { fabId: [menuId,...] }，逐廠區寫入並帶 FabId。
        //   略過空 fabId（避免寫出沒有廠區歸屬、永遠失效的孤兒列）。
        if (dto.ExtraMenus != null)
        {
            foreach (var kvp in dto.ExtraMenus)
            {
                if (string.IsNullOrWhiteSpace(kvp.Key) || kvp.Value == null) continue;
                foreach (var mId in kvp.Value.Distinct())
                {
                    _context.MapAccountExtraMenus.Add(new MapAccountExtraMenu { EmpId = dto.EmpId, FabId = kvp.Key, MenuId = mId });
                }
            }
        }

        if (dto.DenyMenus != null)
        {
            foreach (var kvp in dto.DenyMenus)
            {
                if (string.IsNullOrWhiteSpace(kvp.Key) || kvp.Value == null) continue;
                foreach (var mId in kvp.Value.Distinct())
                {
                    _context.MapAccountDenyMenus.Add(new MapAccountDenyMenu { EmpId = dto.EmpId, FabId = kvp.Key, MenuId = mId });
                }
            }
        }
    }
}
