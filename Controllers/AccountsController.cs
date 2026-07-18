using Microsoft.AspNetCore.Mvc;
using GenAI.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using System.ComponentModel.DataAnnotations;

namespace GenAI.Controllers;

[Route("api/[controller]")]
[ApiController]
[Authorize(Roles = "admin")]
public class AccountsController : ControllerBase
{
    private readonly IAccountService _accountService;
    private readonly IActivityLogger _activityLogger;

    private readonly IAuthService _authService;

    public AccountsController(IAccountService accountService, IActivityLogger activityLogger, IAuthService authService)
    {
        _accountService = accountService;
        _activityLogger = activityLogger;
        _authService = authService;
    }

    // 帳號清單 server-side 分頁端點：帳號管理表格按需向這裡取「單頁」基本資料，
    //   不再隨 GetInitialData 把全部帳號一次塞給 admin（10 萬帳號也只回一頁，前端不致崩潰）。
    [HttpGet]
    public async Task<IActionResult> GetAccounts([FromQuery] int page = 1, [FromQuery] int pageSize = 10, [FromQuery] string? q = null)
    {
        var (items, total) = await _accountService.GetAccountsPagedAsync(page, pageSize, q);
        return Ok(new { items, total, page, pageSize });
    }

    // Excel 匯出備份：一次性回全部帳號的完整明細（admin 明確觸發、非熱路徑）。
    //   ⚠️ 路由 literal "export" 在 ASP.NET 路由優先序高於 "{id}"，不會被當成 id。
    [HttpGet("export")]
    public async Task<IActionResult> GetAccountsForExport()
    {
        var result = await _accountService.GetAccountsForExportAsync();
        return Ok(result);
    }

    // 查詢 [WEB].[dbo].[notes_person] 自動解析姓名與部門（供前端設定帳號表單自動填入用）
    [HttpGet("LookupPerson")]
    public async Task<IActionResult> LookupPerson([FromQuery] string empId)
    {
        var (found, name, department) = await _authService.ResolvePersonInfoAsync(empId);
        return Ok(new { success = true, found, empId, name, department });
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetAccountDetails(string id)
    {
        var result = await _accountService.GetAccountDetailsAsync(id);
        if (result == null) return NotFound();
        return Ok(result);
    }

    [HttpPost]
    public async Task<IActionResult> CreateAccount([FromBody] AccountFullDto dto)
    {
        var (success, errorMessage) = await _accountService.CreateAccountAsync(dto);
        if (!success) return BadRequest(errorMessage);
        return Ok(new { success = true });
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> UpdateAccount(string id, [FromBody] AccountFullDto dto)
    {
        var (success, errorMessage, notFound) = await _accountService.UpdateAccountAsync(id, dto);
        // notFound=true（帳號真的不存在）才回 404；策略/驗證拒絕（super-admin 防降級、stale mapping id）回 400
        //   ——對齊 DeleteAccount「NotFound 只適用真的找不到」的語意。
        if (!success) return notFound ? NotFound(errorMessage) : BadRequest(errorMessage);
        return Ok(new { success = true });
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> DeleteAccount(string id)
    {
        // 取 cookie claim 中的 EmpId 傳給 service，用於擋「刪自己」
        var currentEmpId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var (success, errorMessage, backupJson) = await _accountService.DeleteAccountAsync(id, currentEmpId);
        if (!success) return BadRequest(errorMessage);  // 改回 400 — 拒絕原因應該明確（NotFound 只適用「真的找不到」）
        
        if (backupJson != null)
        {
            await _activityLogger.LogAuditAsync(HttpContext, "Accounts", "Delete", id, "Soft Delete Backup", backupJson);
        }
        
        return Ok(new { success = true });
    }
}

public class AccountFullDto
{
    [Required(ErrorMessage = "工號必填")]
    [StringLength(50)]
    public string EmpId { get; set; } = string.Empty;

    [StringLength(100)]
    public string? Name { get; set; }

    [StringLength(100)]
    public string? Department { get; set; }

    // 必須限定枚舉：否則可建出 RoleLevel='superuser' 等奇怪字串，混亂 sidebar/權限判定。
    // 系統只認 'admin' 與 'user'（不分大小寫，AuthController 會 .ToLower() 寫入 claim）。
    [Required(ErrorMessage = "RoleLevel 必填")]
    [RegularExpression("^(admin|user|ADMIN|USER|Admin|User)$", ErrorMessage = "RoleLevel 只能是 admin 或 user")]
    [StringLength(20)]
    public string? RoleLevel { get; set; }

    public bool CanEditOthers { get; set; }
    public List<string>? AssignedRoles { get; set; }
    public List<string>? ManageableMenus { get; set; }
    // per-fab 個別覆寫：key = FabId、value = 該廠區的 MenuId 清單。
    // （與 DefaultPages 同樣以「廠區為 key」的字典形狀傳遞。）
    public Dictionary<string, List<string>>? ExtraMenus { get; set; }
    public Dictionary<string, List<string>>? DenyMenus { get; set; }
    public Dictionary<string, string>? DefaultPages { get; set; }
}
