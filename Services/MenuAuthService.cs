using GenAI.Data;
using GenAI.Services.Interfaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace GenAI.Services;

/// <summary>
/// 後端委派授權檢查，**必須與 wwwroot/js/render/sidebar.js 的 getMenuPermissions 對齊**。
/// 不對齊就會出現「前端讓 user 看到編輯按鈕、後端 403 拒絕」的鬼故事 — 已踩過一次。
///
/// 一個 menu 可被 empId 寫入的條件：
///   1. empId 是 admin
///   2. empId == menu.CreatedBy  (自己建的一律可寫，不需 CanEditOthers)
///   3. menu 自己就在 Map_Account_ManageMenu 委派列表中 (直接委派)
///   4. menu 的任一祖先在委派列表中、且帳號 CanEditOthers=true
///      (委派 folder 等於委派整個子樹；但只有 CanEditOthers=true 才能動別人建的東西)
/// </summary>
public class MenuAuthService : IMenuAuthService
{
    private readonly AppDbContext _context;
    private readonly IMemoryCache _cache;
    private readonly ISettingsService _settingsService;

    // === 跨請求快取：可見看板集合（E2 優化）===
    // GetVisibleMenuIdsAsync 在每個「非 admin」的 GetInitialData / GetMenus / PersonalSettings 請求都會跑，
    //   要打 ~8 條 DB 查詢 + 全表展開子樹。把結果以 (ETag, empId) 為 key 快取在 Singleton IMemoryCache。
    //   ⚠️ 安全性關鍵：key 內含 _settingsService.GetCurrentETag()，而**所有**權限相關寫入路徑
    //      (Menus / Roles / Fabs / AccountService / 全量 SaveData / PersonalSettings) 都會呼叫
    //      Invalidate*DataCache() → 換新 ETag → 舊 key 自然作廢、下次重算。故權限變更立即生效，
    //      不會發生「改了權限卻沿用舊可見集合」的越權/漏看。60 秒 TTL 僅作為記憶體回收的保險絲。
    private static readonly TimeSpan VisibleSetTtl = TimeSpan.FromSeconds(60);

    // === 每請求快取（MenuAuthService 為 Scoped，一個 HTTP 請求一個實例）===
    // O1 優化：BatchUpdateMenus 會對同一 empId 連續呼叫 CanEditOrDeleteMenuAsync / CanManageStructureAsync N 次；
    //   無快取時每次都整張 Map_Menu_Structure ToListAsync() + 查 account/manageSet，O(N) round-trip。
    //   ⚠️ 安全性：所有權限檢查都發生在「結構異動之前」(見 MenusController 的 Create/Update/Batch 流程，
    //      先全部檢查、後才動 DB)，故請求內快取不會讀到「同一請求中途被自己改掉」的過期結構。
    private Dictionary<string, List<string>>? _childToParents;                                    // child → 父節點清單
    private readonly Dictionary<string, bool> _canEditOthersCache = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, List<string>> _manageSetCache = new(StringComparer.OrdinalIgnoreCase);

    public MenuAuthService(AppDbContext context, IMemoryCache cache, ISettingsService settingsService)
    {
        _context = context;
        _cache = cache;
        _settingsService = settingsService;
    }

    /// <summary>整張 Map_Menu_Structure 的 child→parents 反向索引（每請求載入一次）</summary>
    private async Task<Dictionary<string, List<string>>> GetChildToParentsAsync()
    {
        if (_childToParents == null)
        {
            var edges = await _context.MapMenuStructures.AsNoTracking()
                .Select(s => new { s.ParentMenuId, s.ChildMenuId }).ToListAsync();
            _childToParents = edges
                .GroupBy(e => e.ChildMenuId, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.Select(e => e.ParentMenuId).ToList(), StringComparer.OrdinalIgnoreCase);
        }
        return _childToParents;
    }

    private async Task<bool> GetCanEditOthersAsync(string empId)
    {
        if (!_canEditOthersCache.TryGetValue(empId, out var v))
        {
            var account = await _context.Accounts.AsNoTracking().FirstOrDefaultAsync(a => a.EmpId == empId);
            v = account?.CanEditOthers == true;
            _canEditOthersCache[empId] = v;
        }
        return v;
    }

    private async Task<List<string>> GetManageSetAsync(string empId)
    {
        if (!_manageSetCache.TryGetValue(empId, out var set))
        {
            set = await _context.MapAccountManageMenus.AsNoTracking()
                .Where(m => m.EmpId == empId).Select(m => m.MenuId).ToListAsync();
            _manageSetCache[empId] = set;
        }
        return set;
    }

    private async Task<(bool isMyOwn, bool isDelegatedNode, bool isUnder, bool canEditOthers)> GetNodePermissionsAsync(string empId, string menuId)
    {
        bool canEditOthers = await GetCanEditOthersAsync(empId);

        var menu = await _context.Menus.AsNoTracking().FirstOrDefaultAsync(m => m.MenuId == menuId);
        bool isMyOwn = menu != null && string.Equals(menu.CreatedBy, empId, StringComparison.OrdinalIgnoreCase);

        var manageSet = await GetManageSetAsync(empId);
        if (manageSet.Count == 0) return (isMyOwn, false, false, canEditOthers);

        var manageLookup = new HashSet<string>(manageSet, StringComparer.OrdinalIgnoreCase);
        bool isDelegatedNode = manageLookup.Contains(menuId);

        bool isUnder = false;
        if (!isDelegatedNode)
        {
            // 從 menuId 往上爬 parent chain，撞到任一個被委派的節點 = 在委派子樹內
            var childToParents = await GetChildToParentsAsync();
            var q = new Queue<string>();
            var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            q.Enqueue(menuId);
            while (q.Count > 0)
            {
                var curr = q.Dequeue();
                if (manageLookup.Contains(curr)) { isUnder = true; break; }
                if (!visited.Add(curr)) continue;
                if (childToParents.TryGetValue(curr, out var parents))
                    foreach (var p in parents) q.Enqueue(p);
            }
        }

        // 註：原本另有一段「isAncestor」BFS（從 manageSet 往上找 menuId），
        //     但 CanManageStructureAsync / CanEditOrDeleteMenuAsync 從未使用該值 = 死碼，已移除 (O3)。
        return (isMyOwn, isDelegatedNode, isUnder, canEditOthers);
    }

    public async Task<bool> CanManageStructureAsync(string empId, string menuId, bool isAdmin)
    {
        if (isAdmin) return true;
        if (string.IsNullOrWhiteSpace(empId) || string.IsNullOrWhiteSpace(menuId)) return false;

        var perms = await GetNodePermissionsAsync(empId, menuId);
        if (perms.isMyOwn) return true;
        if (perms.isDelegatedNode || perms.isUnder) return true;

        return false;
    }

    public async Task<bool> CanEditOrDeleteMenuAsync(string empId, string menuId, bool isAdmin)
    {
        if (isAdmin) return true;
        if (string.IsNullOrWhiteSpace(empId) || string.IsNullOrWhiteSpace(menuId)) return false;

        var perms = await GetNodePermissionsAsync(empId, menuId);
        if (perms.isMyOwn) return true;
        if ((perms.isDelegatedNode || perms.isUnder) && perms.canEditOthers) return true;

        return false;
    }

    public async Task<bool> IsDelegatedAdminAsync(string empId, bool isAdmin)
    {
        if (isAdmin) return true;
        if (string.IsNullOrWhiteSpace(empId)) return false;

        var account = await _context.Accounts.AsNoTracking().FirstOrDefaultAsync(a => a.EmpId == empId);
        if (account?.CanEditOthers != true) return false;

        var hasManagedMenus = await _context.MapAccountManageMenus
            .AsNoTracking()
            .AnyAsync(m => m.EmpId == empId);

        return hasManagedMenus;
    }

    public async Task<HashSet<string>?> GetVisibleMenuIdsAsync(string empId, bool isAdmin)
    {
        if (isAdmin) return null;                              // admin 不限
        if (string.IsNullOrWhiteSpace(empId)) return new HashSet<string>();  // 匿名 / 無效 → 空集合

        // E2：先查跨請求快取。key 綁 ETag → 任一權限寫入換 ETag 即作廢，故不會讀到過期權限。
        var cacheKey = $"visibleMenus:{_settingsService.GetCurrentETag()}:{empId.ToLowerInvariant()}";
        if (_cache.TryGetValue(cacheKey, out HashSet<string>? cachedSet) && cachedSet != null)
        {
            // 回傳防禦性副本：快取物件由多個並行請求共享，呼叫端若就地改動會污染快取。
            return new HashSet<string>(cachedSet, StringComparer.OrdinalIgnoreCase);
        }

        // ① 抓 user 的 roles → 對應 allowedMenuIds
        var roleIds = await _context.MapAccountRoles.AsNoTracking()
            .Where(m => m.EmpId == empId).Select(m => m.RoleId).ToListAsync();
        var roleAllowed = roleIds.Count == 0
            ? new List<string>()
            : await _context.MapRoleMenus.AsNoTracking()
                .Where(m => roleIds.Contains(m.RoleId)).Select(m => m.MenuId).ToListAsync();

        // ② 帳號層級 per-fab extra / deny（綁定廠區）
        //    ⚠️ 本方法回傳的是「跨所有可存取廠區的可見聯集」，僅用來過濾 GetInitialData / GetMenus
        //       要送給前端的『資料列』。必須維持 permissive：
        //         - extra：任一可存取廠區開放 → 該看板資料就要送（前端再依當前廠區收斂）。
        //         - deny ：只有當該看板在「所有可存取廠區」都被 deny 時，才從聯集移除；
        //                  否則它在某廠區仍看得到，藏掉資料會讓那個廠區的看板整個消失。
        var extraRows = await _context.MapAccountExtraMenus.AsNoTracking()
            .Where(m => m.EmpId == empId).Select(m => new { m.FabId, m.MenuId }).ToListAsync();
        var denyRows = await _context.MapAccountDenyMenus.AsNoTracking()
            .Where(m => m.EmpId == empId).Select(m => new { m.FabId, m.MenuId }).ToListAsync();

        // 此帳號「可存取的廠區」= 其角色 ∩ 各廠區綁定角色 ≠ ∅
        var accessibleFabs = (await _context.MapFabRoles.AsNoTracking()
                .Where(fr => roleIds.Contains(fr.RoleId)).Select(fr => fr.FabId).Distinct().ToListAsync())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        // extra 聯集：只取「可存取廠區」內的 extra menu
        var extras = extraRows
            .Where(r => accessibleFabs.Contains(r.FabId))
            .Select(r => r.MenuId)
            .ToList();

        // ③ Menu 層級 ACL — 取「會影響 user」的兩種規則
        var menuDeny = await _context.MapMenuDenyAccounts.AsNoTracking()
            .Where(m => m.EmpId == empId).Select(m => m.MenuId).ToListAsync();
        // 白名單：原本整張 Map_Menu_AllowAccount 撈進記憶體再分組 = 全表掃描 (E6)。
        //   拆成兩條「DB 端就過濾好」的窄查詢，回傳列數大幅減少：
        //   (1) 哪些 menu 有白名單 → DISTINCT MenuId（走 PK 前導欄 MenuId 的 stream aggregate）
        //   (2) 我自己被白名單放行的 menu → WHERE EmpId（靠 IX_Map_Menu_AllowAccount_EmpId 走 index seek）
        var menusWithWhitelist = (await _context.MapMenuAllowAccounts.AsNoTracking()
            .Select(m => m.MenuId).Distinct().ToListAsync())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var menuForceAllow = (await _context.MapMenuAllowAccounts.AsNoTracking()
            .Where(m => m.EmpId == empId).Select(m => m.MenuId).ToListAsync())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        // 白名單存在但 user 不在 → 視同 deny
        var aclDeny = new HashSet<string>(menuDeny, StringComparer.OrdinalIgnoreCase);
        foreach (var mid in menusWithWhitelist)
            if (!menuForceAllow.Contains(mid)) aclDeny.Add(mid);

        // per-fab deny → 只在「該 menu 於所有可存取廠區皆被 deny」時才視為全域不可見 (fullyDenied)。
        //   (menu ACL force-allow 蓋過帳號 deny，故 force-allow 的 menu 一律不列入 fullyDenied。)
        var denyFabsByMenu = denyRows
            .Where(r => accessibleFabs.Contains(r.FabId))
            .GroupBy(r => r.MenuId, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.Select(x => x.FabId).ToHashSet(StringComparer.OrdinalIgnoreCase), StringComparer.OrdinalIgnoreCase);
        var fullyDenied = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (accessibleFabs.Count > 0)
        {
            foreach (var kv in denyFabsByMenu)
            {
                if (menuForceAllow.Contains(kv.Key)) continue;
                if (accessibleFabs.All(f => kv.Value.Contains(f))) fullyDenied.Add(kv.Key);
            }
        }

        // ④ 計算 base set
        var allowed = new HashSet<string>(roleAllowed, StringComparer.OrdinalIgnoreCase);
        foreach (var x in extras) allowed.Add(x);
        // per-fab deny：僅扣除「所有可存取廠區都 deny」者
        foreach (var x in fullyDenied) allowed.Remove(x);
        // menu ACL — force-allow 強加
        foreach (var x in menuForceAllow) allowed.Add(x);
        // menu ACL — deny 強拿
        foreach (var x in aclDeny) allowed.Remove(x);

        // ⑤ 展開子節點 (沿 Map_Menu_Structure 走 children)，遇 aclDeny 不展開
        var allStructures = await _context.MapMenuStructures.AsNoTracking()
            .Select(s => new { s.ParentMenuId, s.ChildMenuId }).ToListAsync();
        var childrenOf = allStructures
            .GroupBy(s => s.ParentMenuId, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.Select(x => x.ChildMenuId).ToList(), StringComparer.OrdinalIgnoreCase);

        bool added = true;
        while (added)
        {
            added = false;
            foreach (var parent in allowed.ToList())
            {
                if (!childrenOf.TryGetValue(parent, out var kids)) continue;
                foreach (var kid in kids)
                {
                    if (aclDeny.Contains(kid)) continue;
                    // per-fab：僅當「所有可存取廠區都 deny」(fullyDenied，已排除 force-allow) 才不展開子節點
                    if (fullyDenied.Contains(kid)) continue;
                    if (allowed.Add(kid)) added = true;
                }
            }
        }

        // E2：存入快取（原件），對外一律回傳副本，避免呼叫端就地改動污染共享快取物件。
        _cache.Set(cacheKey, allowed, VisibleSetTtl);
        return new HashSet<string>(allowed, StringComparer.OrdinalIgnoreCase);
    }
}
