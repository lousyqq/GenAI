using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using GenAI.Services.Interfaces;

namespace GenAI.Controllers;

/// <summary>
/// 操作紀錄查詢 — admin only。
/// </summary>
[Route("api/[controller]")]
[ApiController]
[Authorize(Roles = "admin")]
public class ActivityLogsController : ControllerBase
{
    private readonly IActivityLogger _activityLogger;

    public ActivityLogsController(IActivityLogger activityLogger)
    {
        _activityLogger = activityLogger;
    }

    /// <summary>
    /// 查詢操作紀錄。
    /// 範例：GET /api/ActivityLogs?empId=00058897&amp;category=Login&amp;page=1&amp;pageSize=50
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> Query(
        [FromQuery] string? empId = null,
        [FromQuery] string? category = null,
        [FromQuery] string? from = null,         // yyyy-MM-dd or yyyy-MM-ddTHH:mm:ss (local time)
        [FromQuery] string? to = null,
        [FromQuery] bool? successOnly = null,
        [FromQuery] string? keyword = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50)
    {
        DateTime? fromUtc = ParseLocalToUtc(from);
        DateTime? toUtc = ParseLocalToUtc(to);

        var (rows, total) = await _activityLogger.QueryAsync(empId, category, fromUtc, toUtc, successOnly, keyword, page, pageSize);

        return Ok(new
        {
            total,
            page,
            pageSize,
            rows = rows.Select(r => new
            {
                logId = r.LogId,
                timestampUtc = r.Timestamp,
                empId = r.EmpId,
                empName = r.EmpName,
                loginSource = r.LoginSource,
                ipAddress = r.IpAddress,
                userAgent = r.UserAgent,
                httpMethod = r.HttpMethod,
                path = r.Path,
                queryString = r.QueryString,
                statusCode = r.StatusCode,
                durationMs = r.DurationMs,
                category = r.Category,
                action = r.Action,
                targetType = r.TargetType,
                targetId = r.TargetId,
                detail = r.Detail,
                isSuccess = r.IsSuccess,
                errorMessage = r.ErrorMessage
            })
        });
    }

    /// <summary>
    /// 清掉指定天數以前的紀錄 (預設保留 90 天，避免資料庫越長越大)。
    /// </summary>
    [HttpDelete("Purge")]
    public async Task<IActionResult> Purge([FromQuery] int days = 90)
    {
        var deleted = await _activityLogger.PurgeOlderThanAsync(days);
        return Ok(new { success = true, deleted, days });
    }

    private static DateTime? ParseLocalToUtc(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        if (!DateTime.TryParse(s, out var local)) return null;
        // 視為本地時間 → 轉 UTC
        return DateTime.SpecifyKind(local, DateTimeKind.Local).ToUniversalTime();
    }
}
