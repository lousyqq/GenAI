using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using GenAI.Data;
using GenAI.Models;
using GenAI.Services.Interfaces;
using System.Security.Claims;

namespace GenAI.Controllers;

[Route("api/[controller]")]
[ApiController]
[Authorize]
public class PersonalSettingsController : ControllerBase
{
    private readonly AppDbContext _context;
    private readonly ISettingsService _settingsService;
    private readonly IMenuAuthService _menuAuthService;

    public PersonalSettingsController(AppDbContext context, ISettingsService settingsService, IMenuAuthService menuAuthService)
    {
        _context = context;
        _settingsService = settingsService;
        _menuAuthService = menuAuthService;
    }

    /// <summary>
    /// 儲存當前登入使用者的個人選單設定
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> SavePersonalSettings([FromBody] List<PersonalSettingDto> settings)
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrEmpty(currentUserId))
        {
            return Unauthorized();
        }

        // 🛡️ MenuId 必須屬於 user 可見集合，否則：
        //   1. user 可塞「不存在的 MenuId」或「無權看的 MenuId」累積 DB 垃圾
        //   2. 雖然 sidebar 過濾後不會真的顯示，但會在 PersonalSettings 表留下不可信的 row
        //   admin 沒限制 (GetVisibleMenuIdsAsync(_, true) 回 null 跳過過濾)
        var isAdmin = User.IsInRole("admin");
        var visibleSet = await _menuAuthService.GetVisibleMenuIdsAsync(currentUserId, isAdmin);

        // 1. 先把通過可見性檢查的新列在記憶體中備妥（尚未 Add 進 context、不佔 tracking）。
        //    同步以 HashSet 去重：payload 內重複 MenuId 會在 Add 階段撞「Added 同鍵」追蹤衝突。
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var toInsert = new List<PersonalSetting>();
        foreach (var dto in settings)
        {
            if (string.IsNullOrEmpty(dto.MenuId)) continue;
            // 🛡️ 跳過不可見的 MenuId — admin (visibleSet==null) 全放行
            if (visibleSet != null && !visibleSet.Contains(dto.MenuId)) continue;
            if (!seen.Add(dto.MenuId)) continue; // 同一批重複 MenuId 只留第一筆

            toInsert.Add(new PersonalSetting
            {
                EmpId = currentUserId, // 🛡️ 強制綁定，不信任前端傳來的 EmpId
                MenuId = dto.MenuId,
                IsHidden = dto.IsHidden,
                OpenTarget = dto.OpenTarget,
                Icon = dto.Icon,
                SortOrder = dto.SortOrder
            });
        }

        var existingSettings = await _context.PersonalSettings
            .Where(p => p.EmpId == currentUserId)
            .ToListAsync();

        // 2. 「刪舊→寫新」：PersonalSetting 為複合 PK (EmpId+MenuId)，與 Map_Role_Menu 同類。
        //    若在單次 SaveChanges 內 RemoveRange 既有(tracking) 後又 Add 同鍵新列，EF identity map
        //    會丟「another instance with the same key value is already being tracked」(reorder/隱藏
        //    切換因 MenuId 不變必中)。故先 SaveChanges 落實刪除清掉 tracking，再寫新列 → 跨兩次
        //    SaveChanges 須整批原子，包進 ExecutionStrategy 交易（EnableRetryOnFailure 下不可直接
        //    BeginTransaction）。對齊 RolesController.UpdateRole / FabsController.UpdateFab。
        var strategy = _context.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var trans = await _context.Database.BeginTransactionAsync();

            if (existingSettings.Count > 0)
            {
                _context.PersonalSettings.RemoveRange(existingSettings);
                await _context.SaveChangesAsync(); // 先執行刪除以清掉 tracking，避免複合 PK 衝突
            }

            if (toInsert.Count > 0)
                _context.PersonalSettings.AddRange(toInsert);

            await _context.SaveChangesAsync();
            await trans.CommitAsync();
        });

        // ⚠️ 呼叫 InvalidateVolatileDataCache 僅清除個人相關快取，不影響全域設定快取，降低 DB 負載
        _settingsService.InvalidateVolatileDataCache();
        return Ok(new { success = true, message = "個人設定已儲存" });
    }
}

public class PersonalSettingDto
{
    [StringLength(50)]
    public string? MenuId { get; set; }
    public bool? IsHidden { get; set; }
    
    [StringLength(20)]
    public string? OpenTarget { get; set; }
    
    // H3 修復：圖示存的是路徑 /images/icons/{guid}.{ext}（約 50+ 字），50 會被擋掉；放寬到 200。
    [StringLength(200)]
    public string? Icon { get; set; }
    
    public int? SortOrder { get; set; }
}
