using System.Security.Claims;
using System.Text.Json;
using GenAI.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GenAI.Controllers;

/// <summary>
/// 設定 Controller - 薄化版，業務邏輯已抽到 SettingsService
///
/// ⚠️ class-level [Authorize] 是最寬鬆的 baseline (只要登入就好)。
///    需要 admin 的 action 自己加 [Authorize(Roles="admin")]。
///    千萬不要把 class-level 設成 [Authorize(Roles="admin")] 再去 action level 想用 [Authorize] override —
///    ASP.NET Core 的 [Authorize] 是**累加要求**而非 override，會讓所有非 admin user 無法載入 appState、
///    整個 app 對非 admin 完全壞掉 (歷史教訓)。
/// </summary>
[Authorize]
public class SettingsController : Controller
{
    private readonly ISettingsService _settingsService;
    private readonly IMenuAuthService _menuAuthService;
    private readonly ILogger<SettingsController> _logger;

    public SettingsController(ISettingsService settingsService, IMenuAuthService menuAuthService, ILogger<SettingsController> logger)
    {
        _settingsService = settingsService;
        _menuAuthService = menuAuthService;
        _logger = logger;
    }

    [HttpGet]
    public async Task<IActionResult> GetInitialData()
    {
        // ⚠️ ETag 必須摻入「身分」（empId + isAdmin），不可只用全域版本號：
        //    本端點的回應 body 對非 admin 做列級過濾＝同一 URL 不同使用者拿到不同內容。
        //    若 ETag 只含全域值，共用瀏覽器 profile 的機台換帳號登入時，瀏覽器會自動帶上
        //    「前一位使用者」的 If-None-Match → 伺服器只比字串 → 304 → 瀏覽器把前一位
        //    使用者的快取 body 端給現任使用者（admin 全量資料外洩給非 admin、或反向拿到殘缺資料）。
        //    摻入身分後跨使用者必不相符（強制重抓 200），同一使用者的 304 優化照常生效。
        var isAdmin = User.IsInRole("admin");
        var callerEmpId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "";
        var empIdForETag = callerEmpId.Replace("\"", "");
        var eTag = $"\"{_settingsService.GetCurrentETag()}:{empIdForETag}:{(isAdmin ? 1 : 0)}\"";

        if (Request.Headers.TryGetValue("If-None-Match", out var incomingETag))
        {
            if (incomingETag == eTag)
            {
                Response.Headers["ETag"] = eTag; // HTTP 規範：304 也須帶 ETag
                return StatusCode(StatusCodes.Status304NotModified);
            }
        }

        Response.Headers["ETag"] = eTag;
        // 確保瀏覽器每次都會來詢問，避免卡在舊快取
        Response.Headers["Cache-Control"] = "no-cache, must-revalidate";

        try
        {
            // ⭐️ P1：帳號相關表 (Accounts/PersonalSettings/Map_Account_*) 已由 service 以 callerEmpId 點查、
            //    只回呼叫者自己這列（不再整包載入共享快取）。下方 admin 收斂 / 非 admin FilterTable 對這些表
            //    因此已是 no-op（仍保留作為防禦縱深、且全域表的真正過濾仍需 FilterTable）。
            var data = await _settingsService.GetInitialDataAsync(callerEmpId);

            if (!isAdmin)
            {
                var empId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "";
                var visibleMenuIds = await _menuAuthService.GetVisibleMenuIdsAsync(empId, false)
                    ?? new HashSet<string>();
                // 算 user 的 assigned roles，過濾 Roles / Map_Role_Menu / Map_Fab_Role 用
                var myRoleIds = data.TryGetValue("Map_Account_Role", out var mar) && mar is List<Dictionary<string, object>> marList
                    ? marList.Where(r =>
                        {
                            var ek = r.Keys.FirstOrDefault(k => string.Equals(k, "EmpId", StringComparison.OrdinalIgnoreCase));
                            return ek != null && string.Equals(r[ek]?.ToString(), empId, StringComparison.OrdinalIgnoreCase);
                        })
                        .Select(r =>
                        {
                            var rk = r.Keys.FirstOrDefault(k => string.Equals(k, "RoleId", StringComparison.OrdinalIgnoreCase));
                            return rk != null ? r[rk]?.ToString() ?? "" : "";
                        })
                        .Where(s => !string.IsNullOrEmpty(s))
                        .ToHashSet(StringComparer.OrdinalIgnoreCase)
                    : new HashSet<string>(StringComparer.OrdinalIgnoreCase);

                var mapFabRole = data.TryGetValue("Map_Fab_Role", out var mfr) && mfr is List<Dictionary<string, object>> mfrList
                    ? mfrList : new List<Dictionary<string, object>>();

                var filteredData = new Dictionary<string, object>();
                foreach (var kvp in data)
                {
                    if (kvp.Value is List<Dictionary<string, object>> list)
                    {
                        filteredData[kvp.Key] = FilterTable(kvp.Key, list, empId, visibleMenuIds, myRoleIds, mapFabRole);
                    }
                    else
                    {
                        filteredData[kvp.Key] = kvp.Value;
                    }
                }
                return Json(filteredData);
            }

            // admin：全域表（Menus/Fabs/Roles/Apps/Map_Menu_*/Map_Role_Menu/Map_Fab_Role）仍回全量，
            //   但「隨帳號數成長」的帳號權限表只回自己這一列 —— 帳號清單改由 GET /api/Accounts 分頁端點按需提供。
            //   目的：admin 每次 GetInitialData 的回應不再夾帶全部帳號（10 萬帳號時前端不致崩潰），
            //         同時保留自己這一列供登入者解析（restoreLoginFromStorage 找不到自己會誤判帳號被刪）與 MyProfile 覆寫。
            //   Requests 刻意「不」收斂（admin 需在「撤回申請」頁看到所有人的申請）。
            var adminEmpId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "";
            var adminScoped = new Dictionary<string, object>();
            foreach (var kvp in data)
            {
                if (kvp.Value is List<Dictionary<string, object>> list && IsOwnAccountScopedTable(kvp.Key))
                    adminScoped[kvp.Key] = list.Where(r => RowMatchesEmpId(r, adminEmpId)).ToList();
                else
                    adminScoped[kvp.Key] = kvp.Value;
            }
            return Json(adminScoped);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "GetInitialData 錯誤");
            // D3：改回正確的 HTTP 5xx（原本回 200 + {error:true} 是反模式，靠前端自檢旗標）。
            //   前端 fetchInitialDataFromDB 已用 `if (!response.ok)` 處理非 2xx，故安全；
            //   保留 body 的 {error,message} 供除錯，但狀態碼語意正確 → 監控/代理也看得懂。
            Response.StatusCode = StatusCodes.Status500InternalServerError;
            return Json(new { error = true, message = "讀取初始資料時發生錯誤，請聯繫系統管理員。" });
        }
    }

    [HttpPost("/Settings/RefreshCache")]
    [Authorize(Roles = "admin")]
    // 當 admin 從 SSMS 直接改 DB (繞過 RESTful endpoints) 時，可呼叫此端點立刻清空 InitialData 快取，
    //   不需等 60 秒 TTL 自然過期。網頁端按「重新整理權限」按鈕會打這支。
    public JsonResult RefreshCache()
    {
        _settingsService.InvalidateInitialDataCache();
        return Json(new { success = true, message = "已清空快取，下次讀取資料會直接打 DB。請重新整理網頁。" });
    }

    [HttpPost]
    [Authorize(Roles = "admin")] // legacy 全量覆寫，極危險 → 鎖死 admin
    public async Task<JsonResult> SaveData()
    {
        try
        {
            using var reader = new StreamReader(Request.Body);
            string json = await reader.ReadToEndAsync();
            var payload = JsonSerializer.Deserialize<Dictionary<string, List<Dictionary<string, JsonElement>>>>(json);

            if (payload == null)
                return Json(new { success = false, message = "無效的 JSON 資料" });

            var (success, message) = await _settingsService.SaveDataAsync(payload);
            return Json(new { success, message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "SaveData 錯誤");
            return Json(new { success = false, message = "伺服器寫入發生錯誤，請聯繫系統管理員。" });
        }
    }

    [HttpPost]
    // 繼承 class-level [Authorize] (登入即可)；EmpId 從 cookie claim 取、不信 body。
    // 千萬不要回到 [AllowAnonymous] — 那會讓任何人匿名灌任意工號的 LoginCount。
    public async Task<JsonResult> UpdateLoginStats()
    {
        try
        {
            // EmpId 從 Cookie 的 NameIdentifier claim 取，不信前端 body — 否則登入後仍可冒名灌別人的計數
            var empId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "";
            if (string.IsNullOrWhiteSpace(empId))
                return Json(new { success = false, message = "未登入" });

            // Drain body 即可 (不再使用其內容)
            using var reader = new StreamReader(Request.Body);
            _ = await reader.ReadToEndAsync();

            var (success, loginCount, lastLoginTime, errorMessage) =
                await _settingsService.UpdateLoginStatsAsync(empId);

            if (success)
                return Json(new { success, loginCount, lastLoginTime });
            else
                return Json(new { success, message = errorMessage });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "UpdateLoginStats 錯誤");
            return Json(new { success = false, message = "更新登入紀錄失敗，請聯繫系統管理員。" });
        }
    }

    // ===== admin 帳號權限表收斂判定 =====
    // 「隨帳號數成長」且 admin 不需在 GetInitialData 拿全量的表：Accounts、PersonalSettings、所有 Map_Account_*。
    //   （帳號清單→分頁端點；自己的權限→MyProfile；個人版面→只快取自己。Requests 不在此列，admin 需看全部。）
    private static bool IsOwnAccountScopedTable(string tableName)
        => string.Equals(tableName, "Accounts", StringComparison.OrdinalIgnoreCase)
        || string.Equals(tableName, "PersonalSettings", StringComparison.OrdinalIgnoreCase)
        || tableName.StartsWith("Map_Account_", StringComparison.OrdinalIgnoreCase);

    private static bool RowMatchesEmpId(Dictionary<string, object> row, string empId)
    {
        var k = row.Keys.FirstOrDefault(x => string.Equals(x, "EmpId", StringComparison.OrdinalIgnoreCase));
        return k != null && string.Equals(row[k]?.ToString(), empId, StringComparison.OrdinalIgnoreCase);
    }

    // ===== 非 admin 過濾邏輯 =====
    // 對每個表決定過濾規則：用 EmpId / MenuId / RoleId 三類欄位裁切，避免洩漏其他人/其他 menu 的資料
    private static List<Dictionary<string, object>> FilterTable(
        string tableName,
        List<Dictionary<string, object>> list,
        string empId,
        HashSet<string> visibleMenuIds,
        HashSet<string> myRoleIds,
        List<Dictionary<string, object>> mapFabRole)
    {
        bool MatchEmpId(Dictionary<string, object> row)
        {
            var k = row.Keys.FirstOrDefault(x => string.Equals(x, "EmpId", StringComparison.OrdinalIgnoreCase));
            return k != null && string.Equals(row[k]?.ToString(), empId, StringComparison.OrdinalIgnoreCase);
        }
        bool MatchMenuId(Dictionary<string, object> row, string colName)
        {
            var k = row.Keys.FirstOrDefault(x => string.Equals(x, colName, StringComparison.OrdinalIgnoreCase));
            return k != null && visibleMenuIds.Contains(row[k]?.ToString() ?? "");
        }
        bool MatchRoleId(Dictionary<string, object> row)
        {
            var k = row.Keys.FirstOrDefault(x => string.Equals(x, "RoleId", StringComparison.OrdinalIgnoreCase));
            return k != null && myRoleIds.Contains(row[k]?.ToString() ?? "");
        }

        return tableName switch
        {
            // 個人資料表 — 只留自己
            "Accounts" or "Requests" or "PersonalSettings" => list.Where(MatchEmpId).ToList(),
            var s when s.StartsWith("Map_Account_", StringComparison.OrdinalIgnoreCase) => list.Where(MatchEmpId).ToList(),

            // 看板本體 — 只留可見的
            "Menus" => list.Where(r => MatchMenuId(r, "MenuId")).ToList(),
            "Apps" => list.Where(r => MatchMenuId(r, "MenuId")).ToList(),
            "Map_Menu_Structure" => list.Where(r => MatchMenuId(r, "ChildMenuId") || MatchMenuId(r, "ParentMenuId")).ToList(),
            // Menu ACL：只回跟我相關的 (admin 才看全部)
            "Map_Menu_AllowAccount" or "Map_Menu_DenyAccount" => list.Where(MatchEmpId).ToList(),

            // 角色相關 — 只留我有的 role
            "Roles" => list.Where(r =>
                {
                    var k = r.Keys.FirstOrDefault(x => string.Equals(x, "RoleId", StringComparison.OrdinalIgnoreCase));
                    return k != null && myRoleIds.Contains(r[k]?.ToString() ?? "");
                }).ToList(),
            "Map_Role_Menu" => list.Where(MatchRoleId).ToList(),
            "Map_Fab_Role" => list.Where(MatchRoleId).ToList(),

            // 廠區本體 — 只留跟我 role 有交集的
            "Fabs" => FilterFabs(list, myRoleIds, mapFabRole),

            // 其他表 (理論上不會有) — 整張藏起來、空陣列安全
            _ => new List<Dictionary<string, object>>(),
        };
    }

    private static List<Dictionary<string, object>> FilterFabs(
        List<Dictionary<string, object>> fabsList,
        HashSet<string> myRoleIds,
        List<Dictionary<string, object>> mapFabRole)
    {
        var visibleFabIds = mapFabRole
            .Where(m =>
            {
                var rk = m.Keys.FirstOrDefault(k => string.Equals(k, "RoleId", StringComparison.OrdinalIgnoreCase));
                return rk != null && myRoleIds.Contains(m[rk]?.ToString() ?? "");
            })
            .Select(m =>
            {
                var fk = m.Keys.FirstOrDefault(k => string.Equals(k, "FabId", StringComparison.OrdinalIgnoreCase));
                return fk != null ? m[fk]?.ToString() ?? "" : "";
            })
            .Where(s => !string.IsNullOrEmpty(s))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        return fabsList.Where(f =>
        {
            var k = f.Keys.FirstOrDefault(x => string.Equals(x, "FabId", StringComparison.OrdinalIgnoreCase));
            return k != null && visibleFabIds.Contains(f[k]?.ToString() ?? "");
        }).ToList();
    }
}
