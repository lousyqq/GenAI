using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using GenAI.Data;
using GenAI.Models;
using GenAI.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using System.ComponentModel.DataAnnotations;
using System.Security.Claims;

namespace GenAI.Controllers;

[Route("api/[controller]")]
[ApiController]
[Authorize]
public class AppsController : ControllerBase
{
    private readonly AppDbContext _context;
    private readonly ISettingsService _settingsService;
    private readonly IMenuAuthService _menuAuthService;
    private readonly IIconStorageService _iconStorage;

    public AppsController(AppDbContext context, ISettingsService settingsService, IMenuAuthService menuAuthService, IIconStorageService iconStorage)
    {
        _context = context;
        _settingsService = settingsService;
        _menuAuthService = menuAuthService;
        _iconStorage = iconStorage;
    }

    [HttpPost]
    public async Task<IActionResult> CreateApp([FromBody] AppDto dto)
    {
        var isAdmin = User.IsInRole("admin");
        var empId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "";
        
        // 必須擁有該 App 所在 Menu 的管理權限
        if (!await _menuAuthService.CanEditOrDeleteMenuAsync(empId, dto.MenuId, isAdmin))
            return Forbid();

        if (await _context.Apps.AnyAsync(a => a.AppId == dto.Id))
            return BadRequest("App ID 已存在");

        var appItem = new AppItem
        {
            AppId = dto.Id,
            MenuId = dto.MenuId,
            AppName = dto.Name,
            Url = dto.Url,
            IconBase64 = await _iconStorage.SaveAsync(dto.IconBase64),
            Target = dto.Target
        };

        _context.Apps.Add(appItem);
        await _context.SaveChangesAsync();
        
        _settingsService.InvalidateInitialDataCache();
        return Ok(new { success = true });
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> UpdateApp(string id, [FromBody] AppDto dto)
    {
        var isAdmin = User.IsInRole("admin");
        var empId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "";

        // 必須擁有該 App 所在 Menu 的管理權限
        if (!await _menuAuthService.CanEditOrDeleteMenuAsync(empId, dto.MenuId, isAdmin))
            return Forbid();

        var appItem = await _context.Apps.FirstOrDefaultAsync(a => a.AppId == id);
        if (appItem == null) return NotFound();

        // 若轉移了 MenuId，也要確認對原來的 Menu 也有權限 (一般不會轉移，但以防萬一)
        if (appItem.MenuId != dto.MenuId)
        {
            if (!await _menuAuthService.CanEditOrDeleteMenuAsync(empId, appItem.MenuId ?? "", isAdmin))
                return Forbid();
        }

        var oldIcon = appItem.IconBase64; // 換圖後若舊檔不再被參照就清掉，避免磁碟孤兒

        appItem.MenuId = dto.MenuId;
        appItem.AppName = dto.Name;
        appItem.Url = dto.Url;
        appItem.IconBase64 = await _iconStorage.SaveAsync(dto.IconBase64);
        appItem.Target = dto.Target;

        await _context.SaveChangesAsync();
        await _iconStorage.DeleteIfLocalUnreferencedAsync(oldIcon);
        _settingsService.InvalidateInitialDataCache();
        return Ok(new { success = true });
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> DeleteApp(string id, [FromServices] IActivityLogger activityLogger)
    {
        var appItem = await _context.Apps.FirstOrDefaultAsync(a => a.AppId == id);
        if (appItem == null) return NotFound();

        var isAdmin = User.IsInRole("admin");
        var empId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "";

        if (!await _menuAuthService.CanEditOrDeleteMenuAsync(empId, appItem.MenuId ?? "", isAdmin))
            return Forbid();

        var backupJson = System.Text.Json.JsonSerializer.Serialize(appItem);
        var oldIcon = appItem.IconBase64;

        _context.Apps.Remove(appItem);
        await _context.SaveChangesAsync();
        await _iconStorage.DeleteIfLocalUnreferencedAsync(oldIcon);

        await activityLogger.LogAuditAsync(HttpContext, "DataRecovery", "DeleteApp", "AppItem", id, backupJson);

        _settingsService.InvalidateInitialDataCache();
        return Ok(new { success = true });
    }
}

public class AppDto
{
    [Required(ErrorMessage = "ID 必填")]
    [StringLength(50)]
    public string Id { get; set; } = string.Empty;

    [Required(ErrorMessage = "MenuId 必填")]
    [StringLength(50)]
    public string MenuId { get; set; } = string.Empty;

    [Required(ErrorMessage = "名稱必填")]
    [StringLength(100)]
    public string Name { get; set; } = string.Empty;

    // ⚠️ Stored XSS / Open-Redirect 防護：URL 必須是 http(s):// 或 單一 / 開頭的站內絕對路徑，
    //   禁止 javascript:/data:text/html 等危險 scheme，並擋掉「協定相對網址」(//evil.com、/\evil.com)
    //   —— 這類會被瀏覽器當成 https://evil.com 載入，造成 open-redirect / 載入外部惡意內容。
    //   (前端 sidebar.js / tables.js 把 App URL 渲染成 href 與 window.open 目標，無 scheme 驗證就會被 XSS)
    [StringLength(1000)]
    [RegularExpression(@"^(https?://|/(?![/\\])).+$", ErrorMessage = "URL 必須以 http(s):// 開頭或 / 開頭的站內絕對路徑 (不可為 //外部網址)")]
    public string? Url { get; set; }

    // 限制 Icon 大小避免有人塞 MB 級的 base64 把 InitialData cache 撐肥、拖慢全網。
    // 200 KB 以 base64 換算大約等於 150 KB 原始圖檔，icon 用綽綽有餘。
    [StringLength(200_000, ErrorMessage = "Icon 不可超過 200KB")]
    public string? IconBase64 { get; set; }

    [StringLength(20)]
    public string? Target { get; set; }
}
