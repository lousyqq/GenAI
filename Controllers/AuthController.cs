using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Negotiate;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using GenAI.Services.Interfaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using GenAI.Models.Settings;

namespace GenAI.Controllers;

[Route("api/[controller]")]
[ApiController]
public class AuthController : ControllerBase
{
    private readonly IAuthService _authService;
    private readonly AuthSettings _authSettings;
    private readonly ILogger<AuthController> _logger;
    private readonly GenAI.Data.AppDbContext _context;
    private readonly IActivityLogger _activityLogger;

    public AuthController(
        IAuthService authService,
        IOptionsSnapshot<AuthSettings> authOptions,
        ILogger<AuthController> logger,
        GenAI.Data.AppDbContext context,
        IActivityLogger activityLogger)
    {
        _authService = authService;
        _authSettings = authOptions.Value;
        _logger = logger;
        _context = context;
        _activityLogger = activityLogger;
    }

    /// <summary>
    /// 給前端進入點：回前端「現在這個環境允許哪些登入方式」。允許匿名 — 因為登入頁本身要先知道才知道要不要藏掉手動 tab。
    /// </summary>
    [HttpGet("Config")]
    [AllowAnonymous]
    public IActionResult GetConfig()
    {
        var allowManual = _authSettings.AllowManualLogin;
        return Ok(new
        {
            allowManualLogin = allowManual,
            // 之後若要再加「強制 Windows 自動 / 開啟測試帳號提示」之類也都掛在這
        });
    }

    /// <summary>
    /// 取得桌機目前 Windows 登入者的工號。
    ///
    /// 與舊版差別：改成 [Authorize(AuthenticationSchemes = Negotiate)] — 沒帶 Windows 認證票證的請求
    /// 會收到 401 + WWW-Authenticate: Negotiate，瀏覽器若在網域、會自動補上認證；非網域機則直接 401，
    /// 前端 catch 401 就改顯示手動登入框。
    ///
    /// 萃取工號用使用者測試過可行的最簡 pattern：
    ///     var empId = (User?.Identity?.Name ?? "").Replace("UMC\\", "");
    /// 但 "UMC" 改用 appsettings.Auth.WindowsDomainStripPrefix 控制，部署到不同網域時不必改 code。
    /// </summary>
    [HttpGet("WhoAmI")]
    [Authorize(AuthenticationSchemes = NegotiateDefaults.AuthenticationScheme)]
    public async Task<IActionResult> WhoAmI()
    {
        var rawName = User?.Identity?.Name ?? "";

        // 剝掉任意網域前綴（UMC\00058897 → 00058897、SARIEL\yu-tinglin → yu-tinglin），
        // 再剝 @domain.com (Kerberos UPN 形態的保險)。不再依賴固定的 WindowsDomainStripPrefix，
        // 部署機與開發機網域不同也能取到工號。
        var empId = rawName.Trim();
        var slashIdx = empId.LastIndexOf('\\');
        if (slashIdx >= 0) empId = empId[(slashIdx + 1)..];
        var atIdx = empId.IndexOf('@');
        if (atIdx > 0) empId = empId[..atIdx];

        if (string.IsNullOrWhiteSpace(empId))
        {
            await _activityLogger.LogLoginAsync(HttpContext, "(unknown)", null, "windows", false,
                errorMessage: "未偵測到 Windows 登入身份", detail: $"{{\"rawName\":\"{rawName}\"}}");
            return Ok(new
            {
                success = false,
                authenticated = false,
                empId = (string?)null,
                rawName,
                message = "未偵測到 Windows 登入帳號"
            });
        }

        // 查 Accounts 表；查無帳號時預設「人人可瀏覽」— 自動建立 user 帳號並指派預設權限群組。
        var account = await _authService.FindAccountAsync(empId);
        if (account == null)
        {
            if (!_authSettings.AutoProvisionWindowsAccounts)
            {
                _logger.LogWarning("WhoAmI: Windows 帳號 {EmpId} 不存在於 Accounts 表", empId);
                await _activityLogger.LogLoginAsync(HttpContext, empId, null, "windows", false,
                    errorMessage: "工號不存在於 Accounts 表", detail: $"{{\"rawName\":\"{rawName}\"}}");
                return Ok(new
                {
                    success = false,
                    authenticated = true,
                    empId,
                    rawName,
                    source = "windows",
                    message = $"[{empId}] 無瀏覽此網頁的權限"
                });
            }

            account = new Models.Account
            {
                EmpId = empId,
                Name = empId,
                Department = "",
                RoleLevel = "user",
                CanEditOthers = false,
                LoginCount = 0
            };
            _context.Accounts.Add(account);
            foreach (var roleId in _authSettings.DefaultRoleIds.Where(r => !string.IsNullOrWhiteSpace(r)))
            {
                _context.MapAccountRoles.Add(new Models.MapAccountRole { EmpId = empId, RoleId = roleId });
            }
            await _context.SaveChangesAsync();
            _logger.LogInformation("WhoAmI: 自動建立 Windows 帳號 {EmpId}（預設群組: {Roles}）",
                empId, string.Join(",", _authSettings.DefaultRoleIds));
        }

        // 帳號權限覆寫（appsettings Auth:AccountOverrides）：每次登入都強制套用，
        // 讓特定工號（例如測試期的 yu-tinglin）可直接由設定檔卡控 admin / user+委派管理。
        var ovr = _authSettings.AccountOverrides
            .FirstOrDefault(o => string.Equals(o.EmpId, empId, StringComparison.OrdinalIgnoreCase));
        if (ovr != null)
        {
            var newRole = string.IsNullOrWhiteSpace(ovr.RoleLevel) ? "user" : ovr.RoleLevel.ToLower();
            if (!string.Equals(account.RoleLevel, newRole, StringComparison.OrdinalIgnoreCase)
                || account.CanEditOthers != ovr.CanEditOthers)
            {
                var tracked = await _context.Accounts.FirstOrDefaultAsync(a => a.EmpId == account.EmpId);
                if (tracked != null)
                {
                    tracked.RoleLevel = newRole;
                    tracked.CanEditOthers = ovr.CanEditOthers;
                    await _context.SaveChangesAsync();
                    account = tracked;
                    _logger.LogInformation("WhoAmI: 套用帳號覆寫 {EmpId} → RoleLevel={Role}, CanEditOthers={CanEdit}",
                        empId, newRole, ovr.CanEditOthers);
                }
            }
        }

        // 找到帳號 — 也順手發一張 Cookie，這樣 [Authorize] 的 API (例如 PersonalSettings) 後續才能用
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, account.EmpId),
            new(ClaimTypes.Name, account.Name ?? account.EmpId),
            new(ClaimTypes.Role, (account.RoleLevel ?? "user").ToLower()),
            new("LoginSource", "windows")
        };
        var claimsIdentity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
        await HttpContext.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            new ClaimsPrincipal(claimsIdentity),
            new AuthenticationProperties
            {
                IsPersistent = true,
                ExpiresUtc = DateTimeOffset.UtcNow.AddHours(12)
            });

        // 紀錄 Windows 自動登入成功 — middleware 預設不記 Login 類別，這裡明確補
        await _activityLogger.LogLoginAsync(HttpContext, account.EmpId, account.Name, "windows", true,
            detail: $"{{\"rawName\":\"{rawName}\"}}");

        return Ok(new
        {
            success = true,
            authenticated = true,
            empId = account.EmpId,
            rawName,
            source = "windows",
            roleLevel = account.RoleLevel,
            account = new
            {
                empId = account.EmpId,
                name = account.Name ?? account.EmpId,
                department = account.Department ?? "",
                roleLevel = account.RoleLevel ?? "user",
                canEditOthers = account.CanEditOthers,
                assignedRoles = Array.Empty<string>(),
                manageableMenus = Array.Empty<string>(),
                defaultPages = new Dictionary<string, string>()
            }
        });
    }

    [HttpGet("MyProfile")]
    [Authorize]
    public async Task<IActionResult> MyProfile()
    {
        // ⚠️ User.Identity?.Name 在我們的 Cookie scheme 下會回「姓名」(ClaimTypes.Name)；EmpId 放在 NameIdentifier。
        var empId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrEmpty(empId)) return Unauthorized();

        var a = await _context.Accounts
            .AsNoTracking()
            .Include(x => x.MapAccountRoles)
            .Include(x => x.MapAccountManageMenus)
            .Include(x => x.MapAccountDefaultPages)
            .Include(x => x.MapAccountExtraMenus)
            .Include(x => x.MapAccountDenyMenus)
            .AsSplitQuery() // 5 個 collection-Include 避免 cartesian 相乘
            .FirstOrDefaultAsync(x => x.EmpId == empId);

        if (a == null) return NotFound();

        return Ok(new
        {
            empId = a.EmpId,
            // 自身的 roleLevel / canEditOthers：讓 MyProfile 成為「登入者權限」的自足來源，
            // 前端 delegated-admin UI 判定不再隱性依賴 GetInitialData 的自身列或 Login 回應（皆為自己的值，無資訊外洩）。
            roleLevel = a.RoleLevel ?? "user",
            canEditOthers = a.CanEditOthers,
            assignedRoles = a.MapAccountRoles?.Select(m => m.RoleId).ToList() ?? new List<string>(),
            manageableMenus = a.MapAccountManageMenus?.Select(m => m.MenuId).ToList() ?? new List<string>(),
            // per-fab：以 FabId 分組成 { fabId: [menuId,...] }
            extraMenus = GroupOverridesByFab(a.MapAccountExtraMenus?.Select(m => (m.FabId, m.MenuId))),
            denyMenus = GroupOverridesByFab(a.MapAccountDenyMenus?.Select(m => (m.FabId, m.MenuId))),
            defaultPages = a.MapAccountDefaultPages?.ToDictionary(m => m.FabId, m => m.MenuId ?? "") ?? new Dictionary<string, string>()
        });
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

    /// <summary>
    /// 手動登入：以工號 + 密碼向 AD LDAP 進行 bind 驗證，成功後寫入 Cookie。
    /// </summary>
    [HttpPost("Login")]
    [AllowAnonymous]
    [EnableRateLimiting("login-ip")]  // Round-3 P1 #4：每 IP 60 秒最多 10 次嘗試，擋暴力破解
    public async Task<IActionResult> Login([FromBody] LoginRequest req)
    {
        // 部署到正式環境後可把 appsettings.Auth.AllowManualLogin 設為 false，整個手動登入入口會被擋住、
        // 強制所有人走 Windows 自動偵測；前端 tab 也會藏起來。
        if (!_authSettings.AllowManualLogin)
        {
            await _activityLogger.LogLoginAsync(HttpContext, req.EmpId ?? "(empty)", null, "manual", false,
                errorMessage: "本環境已停用手動登入");
            return Unauthorized(new
            {
                success = false,
                message = "本環境已停用手動登入，請改用桌機 Windows 帳號自動登入。"
            });
        }

        if (string.IsNullOrWhiteSpace(req.EmpId))
        {
            await _activityLogger.LogLoginAsync(HttpContext, "(empty)", null, "manual", false,
                errorMessage: "工號為空");
            return BadRequest(new { success = false, message = "工號不得為空" });
        }

        var empId = req.EmpId.Trim();
        var password = req.Password ?? "";

        // 驗證優先序：
        //   1. TestAccounts 白名單（外部開發/測試帳號，appsettings 控制；密碼會比對）
        //   2. EnableEmergencyAdmin (admin 不檢密碼，純救援通道)
        //   3. AD LDAP bind
        var (testMatched, testFallback) = _authService.VerifyTestAccount(empId, password);

        var enableEmergency = _authSettings.EnableEmergencyAdmin;
        var isEmergencyAdmin = !testMatched
            && enableEmergency
            && string.Equals(empId, "admin", StringComparison.OrdinalIgnoreCase);

        string loginSource;
        if (testMatched)
        {
            loginSource = "test";
        }
        else if (isEmergencyAdmin)
        {
            loginSource = "emergency";
        }
        else
        {
            // 走 LDAP 驗證
            var (ok, errMsg) = await _authService.VerifyLdapPasswordAsync(empId, password);
            if (!ok)
            {
                await _activityLogger.LogLoginAsync(HttpContext, empId, null, "manual", false,
                    errorMessage: errMsg ?? "LDAP 驗證失敗");
                return Unauthorized(new { success = false, message = errMsg ?? "驗證失敗" });
            }
            loginSource = "manual";
        }

        // 取得帳號資訊：優先 DB Accounts，沒有就用 TestAccount/Emergency 的 fallback skeleton
        var account = await _authService.FindAccountAsync(empId);
        if (account == null)
        {
            if (testMatched && testFallback != null)
            {
                account = testFallback;
            }
            else if (isEmergencyAdmin)
            {
                account = new Models.Account
                {
                    EmpId = "admin",
                    Name = "系統管理員(臨時)",
                    Department = "系統救援",
                    RoleLevel = "admin",
                    CanEditOthers = true
                };
            }
            else
            {
                await _activityLogger.LogLoginAsync(HttpContext, empId, null, loginSource, false,
                    errorMessage: "工號通過密碼驗證但 Accounts 表內無此帳號");
                return Unauthorized(new
                {
                    success = false,
                    message = $"工號 [{empId}] 尚未建立帳號，請聯絡管理員。"
                });
            }
        }

        // 寫入 Cookie
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, account.EmpId),
            new(ClaimTypes.Name, account.Name ?? account.EmpId),
            new(ClaimTypes.Role, (account.RoleLevel ?? "user").ToLower()),
            new("LoginSource", loginSource)
        };

        var claimsIdentity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);

        await HttpContext.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            new ClaimsPrincipal(claimsIdentity),
            new AuthenticationProperties
            {
                IsPersistent = true,
                ExpiresUtc = DateTimeOffset.UtcNow.AddHours(12)
            });

        await _activityLogger.LogLoginAsync(HttpContext, account.EmpId, account.Name, loginSource, true);

        return Ok(new
        {
            success = true,
            empId = account.EmpId,
            roleLevel = account.RoleLevel,
            source = loginSource,
            // 完整 account 物件作為 fallback：當 TestAccounts 用的 admin/user 沒有寫入 DB Accounts 表時，
            // 前端可以直接用這個物件，不必再回頭查 getAccounts()。
            account = new
            {
                empId = account.EmpId,
                name = account.Name ?? account.EmpId,
                department = account.Department ?? "",
                roleLevel = account.RoleLevel ?? "user",
                canEditOthers = account.CanEditOthers,
                assignedRoles = Array.Empty<string>(),
                manageableMenus = Array.Empty<string>(),
                defaultPages = new Dictionary<string, string>()
            }
        });
    }

    [HttpPost("Logout")]
    [AllowAnonymous]
    public async Task<IActionResult> Logout()
    {
        // 紀錄登出 — 先記再 SignOut，否則 ctx.User 會清空抓不到 EmpId
        var empId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var name = User.FindFirstValue(ClaimTypes.Name);
        if (!string.IsNullOrWhiteSpace(empId))
        {
            await _activityLogger.LogLogoutAsync(HttpContext, empId, name);
        }

        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return Ok(new { success = true });
    }
}

public class LoginRequest
{
    [Required(ErrorMessage = "工號不得為空")]
    [StringLength(50)]
    public string EmpId { get; set; } = string.Empty;

    [StringLength(100)]
    public string? Password { get; set; }
}
