using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using GenAI.Data;
using GenAI.Models;
using System.Security.Claims;
using GenAI.Services.Interfaces;

namespace GenAI.Controllers;

[Route("api/[controller]")]
[ApiController]
[Authorize]
public class RequestsController : ControllerBase
{
    private readonly AppDbContext _context;
    private readonly ISettingsService _settingsService;
    private readonly IActivityLogger _activityLogger;

    public RequestsController(AppDbContext context, ISettingsService settingsService, IActivityLogger activityLogger)
    {
        _context = context;
        _settingsService = settingsService;
        _activityLogger = activityLogger;
    }

    [HttpGet]
    public async Task<IActionResult> Get()
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var isAdmin = User.IsInRole("admin");

        // 🛡️ 權限隔離：Admin 可以看全部，一般 User 只能看自己的
        var query = _context.Requests.AsNoTracking().AsQueryable();
        if (!isAdmin)
        {
            query = query.Where(r => r.EmpId == currentUserId);
        }

        return Ok(await query.ToListAsync());
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateRequestDto dto)
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrEmpty(currentUserId)) return Unauthorized();

        var existingReq = await _context.Requests.FindAsync(dto.RequestId);
        if (existingReq != null)
        {
            // 🛡️ IDOR 防護：只能重新送出自己的申請
            if (existingReq.EmpId != currentUserId) return Forbid();
            existingReq.ReqType = dto.ReqType;
            existingReq.Fab = dto.Fab;
            existingReq.Reason = dto.Reason;
            existingReq.Status = "pending";
            existingReq.Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            _context.Requests.Update(existingReq);
        }
        else
        {
            var req = new Request
            {
                RequestId = string.IsNullOrWhiteSpace(dto.RequestId) ? ("req_" + Guid.NewGuid().ToString("N")) : dto.RequestId,
                ReqType = dto.ReqType,
                Fab = dto.Fab,
                Reason = dto.Reason,
                EmpId = currentUserId,
                EmpName = User.FindFirstValue(ClaimTypes.Name) ?? currentUserId,
                Status = "pending",
                Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            };
            _context.Requests.Add(req);
        }

        await _context.SaveChangesAsync();
        // Requests 表只在 Volatile(10s) bucket → 用 volatile 失效即可，不必連帶清掉 Global(60s) 9 張權限表快取。
        // (兩變體都會 bump ETag，故 visibleMenus 與 HTTP-304 正確性不受影響。)
        _settingsService.InvalidateVolatileDataCache();

        return Ok(new { success = true, message = "申請已送出" });
    }

    [HttpPut("{id}/Withdraw")]
    public async Task<IActionResult> Withdraw(string id, [FromBody] WithdrawDto dto)
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrEmpty(currentUserId)) return Unauthorized();

        var req = await _context.Requests.FindAsync(id);
        if (req == null) return NotFound();

        // 🛡️ IDOR 防護：只能撤回自己的申請
        if (req.EmpId != currentUserId) return Forbid();

        req.Status = "withdrawn";
        req.WithdrawReason = dto.Reason;
        // Timestamp 保留原始時間或更新皆可，原邏輯未改 Timestamp

        await _context.SaveChangesAsync();
        _settingsService.InvalidateVolatileDataCache(); // Requests 僅在 Volatile bucket，免清 Global 權限快取

        return Ok(new { success = true, message = "申請已撤回" });
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id)
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrEmpty(currentUserId)) return Unauthorized();

        var req = await _context.Requests.FindAsync(id);
        if (req == null) return Ok(new { success = true });

        // 🛡️ IDOR 防護：只能刪除自己的申請（原版邏輯是撤回後可以刪除）
        if (req.EmpId != currentUserId) return Forbid();

        var backupJson = System.Text.Json.JsonSerializer.Serialize(req, new System.Text.Json.JsonSerializerOptions { ReferenceHandler = System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles });

        _context.Requests.Remove(req);
        await _context.SaveChangesAsync();
        
        await _activityLogger.LogAuditAsync(HttpContext, "Requests", "Delete", id, "Soft Delete Backup", backupJson);

        _settingsService.InvalidateVolatileDataCache(); // Requests 僅在 Volatile bucket，免清 Global 權限快取

        return Ok(new { success = true, message = "紀錄已刪除" });
    }

    [HttpPut("{id}/Audit")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> Audit(string id, [FromBody] AuditDto dto)
    {
        var req = await _context.Requests.FindAsync(id);
        if (req == null) return NotFound();

        // 🛡️ 只有 Admin 可以審核回覆
        req.Status = dto.Status;
        req.Reply = dto.Reply;

        await _context.SaveChangesAsync();
        _settingsService.InvalidateVolatileDataCache(); // Requests 僅在 Volatile bucket，免清 Global 權限快取

        return Ok(new { success = true, message = "審核已儲存" });
    }
}

public class CreateRequestDto
{
    [StringLength(50)]
    public string? RequestId { get; set; }

    [Required(ErrorMessage = "申請類別必填")]
    [StringLength(50)]
    public string? ReqType { get; set; }

    [Required(ErrorMessage = "廠區必填")]
    [StringLength(50)]
    public string? Fab { get; set; }

    [Required(ErrorMessage = "需求說明必填")]
    [StringLength(1000)]
    public string? Reason { get; set; }
}

public class WithdrawDto
{
    [StringLength(1000)]
    public string? Reason { get; set; }
}

public class AuditDto
{
    // ⚠️ 必須對齊前端 tables.js 的 statusMap 與 admin/user 流程實際送的值，
    //    否則 admin 從 UI 按「已完成」(resolved) 等會被 400 擋掉、審核功能斷掉。
    [Required]
    [RegularExpression("^(pending|processing|resolved|rejected|withdrawn)$", ErrorMessage = "無效的審核狀態")]
    [StringLength(20)]
    public string? Status { get; set; }

    [StringLength(1000)]
    public string? Reply { get; set; }
}
