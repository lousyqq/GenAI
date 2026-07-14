using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using GenAI.Data;
using GenAI.Models;
using GenAI.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using System.ComponentModel.DataAnnotations;

namespace GenAI.Controllers;

[Route("api/[controller]")]
[ApiController]
[Authorize(Roles = "admin")]
public class FabsController : ControllerBase
{
    private readonly AppDbContext _context;
    private readonly ISettingsService _settingsService;

    public FabsController(AppDbContext context, ISettingsService settingsService)
    {
        _context = context;
        _settingsService = settingsService;
    }

    [HttpGet]
    public async Task<IActionResult> GetFabs()
    {
        var fabs = await _context.Fabs
            .AsNoTracking()
            .Include(f => f.MapFabRoles)
            .ToListAsync();

        var result = fabs.Select(f => new
        {
            id = f.FabId,
            fabName = f.FabName,
            displayName = f.DisplayName,
            defaultLang = f.DefaultLang,
            assignedRoles = f.MapFabRoles?.Select(m => m.RoleId).ToList() ?? new List<string>()
        });

        return Ok(result);
    }

    [HttpPost]
    public async Task<IActionResult> CreateFab([FromBody] FabDto dto)
    {
        // 先查 PK（FabId）再查業務鍵（FabName）— 重複 FabId 若不先擋會直接撞 PK violation 500。
        if (await _context.Fabs.AnyAsync(f => f.FabId == dto.Id))
            return BadRequest("廠區 ID 已存在");
        if (await _context.Fabs.AnyAsync(f => f.FabName == dto.FabName))
            return BadRequest("廠區已存在");

        var fab = new Fab
        {
            FabId = dto.Id,
            FabName = dto.FabName,
            DisplayName = dto.DisplayName,
            DefaultLang = dto.DefaultLang
        };

        _context.Fabs.Add(fab);

        // 1.3：先驗證 RoleId 都存在再插入 Map_Fab_Role，避免撞 FK 直接 500（回 400 + 明確訊息給前端）。
        //   順帶 Distinct 去重，否則重複 RoleId 會踩 Map_Fab_Role 的複合 PK。
        var roleIds = dto.AssignedRoles?.Where(r => !string.IsNullOrWhiteSpace(r)).Distinct().ToList() ?? new List<string>();
        if (roleIds.Count > 0)
        {
            var existingSet = (await _context.Roles.Where(r => roleIds.Contains(r.RoleId)).Select(r => r.RoleId).ToListAsync())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            var missing = roleIds.Where(r => !existingSet.Contains(r)).ToList();
            if (missing.Count > 0)
                return BadRequest($"下列角色不存在，無法指派：{string.Join(", ", missing)}");

            foreach (var roleId in roleIds)
                _context.MapFabRoles.Add(new MapFabRole { FabId = fab.FabId, RoleId = roleId });
        }

        await _context.SaveChangesAsync();
        _settingsService.InvalidateInitialDataCache();
        return Ok(new { success = true });
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> UpdateFab(string id, [FromBody] FabDto dto)
    {
        var fab = await _context.Fabs.Include(f => f.MapFabRoles).FirstOrDefaultAsync(f => f.FabId == id);
        if (fab == null) return NotFound();

        // 1.3：在動 DB 之前先驗證新指派的 RoleId 都存在，stale id 直接回 400（避免刪舊後才撞 FK 500）。
        var roleIds = dto.AssignedRoles?.Where(r => !string.IsNullOrWhiteSpace(r)).Distinct().ToList() ?? new List<string>();
        if (roleIds.Count > 0)
        {
            var existingSet = (await _context.Roles.Where(r => roleIds.Contains(r.RoleId)).Select(r => r.RoleId).ToListAsync())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            var missing = roleIds.Where(r => !existingSet.Contains(r)).ToList();
            if (missing.Count > 0)
                return BadRequest($"下列角色不存在，無法指派：{string.Join(", ", missing)}");
        }

        fab.DisplayName = dto.DisplayName;
        fab.DefaultLang = dto.DefaultLang;

        // §6.2：「刪舊 mappings → 寫新 mappings」跨兩次 SaveChanges，必須整批原子 —
        //   無交易時第二段失敗會留下被清空的 Map_Fab_Role（廠區對所有人隱藏）。
        //   DbContext 啟用 EnableRetryOnFailure → 手動交易一律包在 ExecutionStrategy 內
        //   （直接 BeginTransactionAsync 會拋「不支援 user-initiated transactions」）。
        var strategy = _context.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var trans = await _context.Database.BeginTransactionAsync();

            if (fab.MapFabRoles != null && fab.MapFabRoles.Count > 0)
            {
                _context.MapFabRoles.RemoveRange(fab.MapFabRoles);
                await _context.SaveChangesAsync(); // 先執行刪除以避免複合 PK tracking 衝突
            }

            foreach (var roleId in roleIds)
                _context.MapFabRoles.Add(new MapFabRole { FabId = id, RoleId = roleId });

            await _context.SaveChangesAsync();
            await trans.CommitAsync();
        });
        _settingsService.InvalidateInitialDataCache();
        return Ok(new { success = true });
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> DeleteFab(string id, [FromServices] IActivityLogger activityLogger)
    {
        var fab = await _context.Fabs
            .Include(f => f.MapFabRoles)
            .FirstOrDefaultAsync(f => f.FabId == id);
        if (fab == null) return NotFound();

        // 先清掉關聯，避免 FK 限制阻擋刪除
        if (fab.MapFabRoles != null && fab.MapFabRoles.Count > 0)
            _context.MapFabRoles.RemoveRange(fab.MapFabRoles);

        // 同時清掉 Map_Account_DefaultPage 中以該廠區為 key 的設定
        var defaultPages = await _context.MapAccountDefaultPages
            .Where(p => p.FabId == id).ToListAsync();
        if (defaultPages.Count > 0)
            _context.MapAccountDefaultPages.RemoveRange(defaultPages);

        var backupJson = System.Text.Json.JsonSerializer.Serialize(fab, new System.Text.Json.JsonSerializerOptions { ReferenceHandler = System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles });

        _context.Fabs.Remove(fab);
        await _context.SaveChangesAsync();
        
        await activityLogger.LogAuditAsync(HttpContext, "DataRecovery", "DeleteFab", "Fab", id, backupJson);
        
        _settingsService.InvalidateInitialDataCache();
        return Ok(new { success = true });
    }
}

public class FabDto
{
    [Required(ErrorMessage = "廠區 ID 必填")]
    [StringLength(50)]
    public string Id { get; set; } = string.Empty;
    
    [Required(ErrorMessage = "廠區代碼必填")]
    [StringLength(50)]
    public string FabName { get; set; } = string.Empty;
    
    [StringLength(100)]
    public string? DisplayName { get; set; }
    
    [StringLength(20)]
    public string? DefaultLang { get; set; }
    
    public List<string>? AssignedRoles { get; set; }
}
