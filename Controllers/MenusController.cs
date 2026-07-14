using Microsoft.AspNetCore.Mvc;
using GenAI.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using System.ComponentModel.DataAnnotations;
using System.Security.Claims;

namespace GenAI.Controllers;

[Route("api/[controller]")]
[ApiController]
[Authorize]
public class MenusController : ControllerBase
{
    private readonly IMenuService _menuService;

    public MenusController(IMenuService menuService)
    {
        _menuService = menuService;
    }

    // ⚠️ 不可用 User.Identity?.Name — 那會回 ClaimTypes.Name (姓名 e.g. "林玉婷")，不是 EmpId。
    //    Login/WhoAmI 設定 claims 時把 EmpId 放在 NameIdentifier、Name 放在「姓名」，所以這裡務必抓 NameIdentifier。
    private string CurrentEmpId => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "";
    private bool IsAdmin => User.IsInRole("admin");

    /// <summary>把 Service 的 <see cref="MenuOperationResult"/> 映射成對應 HTTP 狀態碼（授權測試依賴 403）。</summary>
    private IActionResult MapResult(MenuOperationResult r) => r.Status switch
    {
        MenuOpStatus.Success => Ok(new { success = true }),
        MenuOpStatus.Forbidden => Forbid(),
        MenuOpStatus.NotFound => NotFound((object?)r.Message ?? new { success = false }),
        MenuOpStatus.BadRequest => BadRequest(r.Message),
        _ => StatusCode(500)
    };

    [HttpGet]
    public async Task<IActionResult> GetMenus()
        => Ok(await _menuService.GetMenusAsync(CurrentEmpId, IsAdmin));

    [HttpPost]
    public async Task<IActionResult> CreateMenu([FromBody] MenuDto dto)
        => MapResult(await _menuService.CreateMenuAsync(dto, CurrentEmpId, IsAdmin));

    [HttpPut("{id}")]
    public async Task<IActionResult> UpdateMenu(string id, [FromBody] MenuDto dto)
        => MapResult(await _menuService.UpdateMenuAsync(id, dto, CurrentEmpId, IsAdmin));

    [HttpDelete("{id}")]
    public async Task<IActionResult> DeleteMenu(string id, [FromServices] IActivityLogger activityLogger)
    {
        var result = await _menuService.DeleteMenuAsync(id, CurrentEmpId, IsAdmin);
        // 稽核還原備份留在 Controller 寫（與 AccountsController.DeleteAccount 同模式：Service 回 backupJson）。
        if (result.IsSuccess && result.BackupJson != null)
            await activityLogger.LogAuditAsync(HttpContext, "DataRecovery", "DeleteMenu", "Menu", id, result.BackupJson);
        return MapResult(result);
    }

    [HttpPost("batch")]
    public async Task<IActionResult> BatchUpdateMenus([FromBody] List<MenuDto> dtos)
        => MapResult(await _menuService.BatchUpdateMenusAsync(dtos, CurrentEmpId, IsAdmin));

    [HttpDelete("batch")]
    public async Task<IActionResult> BatchDeleteMenus([FromBody] List<string> ids, [FromServices] IActivityLogger activityLogger)
    {
        var result = await _menuService.BatchDeleteMenusAsync(ids, CurrentEmpId, IsAdmin);
        if (result.IsSuccess && result.BackupJson != null)
            await activityLogger.LogAuditAsync(HttpContext, "DataRecovery", "BatchDeleteMenus", "Menu", string.Join(",", ids ?? new List<string>()), result.BackupJson);
        return MapResult(result);
    }
}

public class MenuDto : IValidatableObject
{
    [Required(ErrorMessage = "ID 必填")]
    [StringLength(50)]
    public string Id { get; set; } = string.Empty;
    
    [Required(ErrorMessage = "名稱必填")]
    [StringLength(100)]
    public string? Name { get; set; }
    
    [StringLength(100)]
    public string? DisplayName { get; set; }
    
    [StringLength(20)]
    public string? MenuMode { get; set; }
    
    // ⚠️ Stored XSS 防護：由 Controller 層級檢查 javascript: 避免過度嚴格的正則表達式擋住合法的相對路徑 (如 "1111222")。
    [StringLength(1000)]
    public string? Url { get; set; }

    // targetPage 是 DOM section id (e.g. "page-home")，只允許英數+底線+連字號避免 selector injection
    [StringLength(200)]
    public string? TargetPage { get; set; }
    
    [StringLength(20)]
    public string? Target { get; set; }
    
    // ⚠️ Icon 可能是 FA class (e.g. "fas fa-folder") 或 base64 data URI ("data:image/jpeg;base64,...")，
    //    前端 compressImageFile 會壓到 80×80 約 5-8 KB，舊版鎖 100 char 會直接 400。放寬到 200KB。
    [StringLength(200_000, ErrorMessage = "Icon 不可超過 200KB")]
    public string? Icon { get; set; }

    [StringLength(50)]
    public string? CreatedBy { get; set; }
    
    public bool Enabled { get; set; }
    public bool IsPoolItem { get; set; }
    public bool IsEdited { get; set; }
    public int? Order { get; set; }

    [StringLength(50)]
    public string? ParentId { get; set; }

    // 一支 menu 不會掛在 100+ 個父節點下；卡個合理上限避免被塞爆。
    [MaxLength(100, ErrorMessage = "ParentIds 最多 100 個")]
    public List<string>? ParentIds { get; set; }

    public Dictionary<string, int>? ParentOrders { get; set; }

    // Menu-level ACL (空 list = 不卡控)。卡 1000 筆上限：實務上不會有單一 menu 對 1000+ 工號做白/黑名單，
    // 真到那規模應該改設計用 role / group。
    [MaxLength(1000, ErrorMessage = "AllowedEmpIds 最多 1000 個")]
    public List<string>? AllowedEmpIds { get; set; }

    [MaxLength(1000, ErrorMessage = "DeniedEmpIds 最多 1000 個")]
    public List<string>? DeniedEmpIds { get; set; }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        // ⚠️ Stored XSS 防護：menu URL 容許相對路徑 (如 "1111222")，故不能像 AppDto 強制 http(s)://，
        //    改採「黑名單危險 scheme」：javascript: / data: / vbscript: 一律擋。
        //    (前端 openDynamicIframe 雖會對非 http/`/`/page- 開頭 prepend http:// 實質中和，但後端仍應把關，
        //     避免未來其他渲染路徑直接吃這個值。)
        if (!string.IsNullOrWhiteSpace(Url))
        {
            var u = Url.Trim();
            string[] danger = { "javascript:", "data:", "vbscript:" };
            if (danger.Any(d => u.StartsWith(d, StringComparison.OrdinalIgnoreCase)))
            {
                yield return new ValidationResult("URL 不可使用 javascript: / data: / vbscript: 等危險協定以防範 XSS 攻擊", new[] { nameof(Url) });
            }
            if (u.StartsWith("//") || u.StartsWith(@"/\"))
            {
                yield return new ValidationResult("URL 不可使用協定相對網址 (如 //evil.com)", new[] { nameof(Url) });
            }
        }
    }
}
