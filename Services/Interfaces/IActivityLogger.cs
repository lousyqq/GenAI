using GenAI.Models;

namespace GenAI.Services.Interfaces;

public interface IActivityLogger
{
    /// <summary>原始寫入。一般情境用下面的 helper。</summary>
    Task LogAsync(UserActivityLog log);

    /// <summary>登入相關（成功或失敗都呼叫這個，由 success/errorMessage 區分）。</summary>
    Task LogLoginAsync(
        HttpContext ctx,
        string empId,
        string? empName,
        string loginSource,
        bool success,
        string? errorMessage = null,
        string? detail = null);

    /// <summary>登出。</summary>
    Task LogLogoutAsync(HttpContext ctx, string? empId, string? empName);

    /// <summary>權限被拒 (Forbid / 403)，由 controller 在 return Forbid() 前手動補。</summary>
    Task LogAuthDeniedAsync(HttpContext ctx, string action, string? targetType = null, string? targetId = null, string? reason = null);

    /// <summary>業務動作 (CRUD 等)，由 controller 在成功完成後呼叫。</summary>
    Task LogAuditAsync(
        HttpContext ctx,
        string category,
        string action,
        string? targetType = null,
        string? targetId = null,
        string? detail = null,
        bool success = true,
        string? errorMessage = null);

    /// <summary>查詢 (admin only)。</summary>
    Task<(List<UserActivityLog> rows, int total)> QueryAsync(
        string? empId = null,
        string? category = null,
        DateTime? fromUtc = null,
        DateTime? toUtc = null,
        bool? successOnly = null,
        string? keyword = null,
        int page = 1,
        int pageSize = 50);

    /// <summary>清掉指定天數以前的紀錄，admin 才呼叫得到。</summary>
    Task<int> PurgeOlderThanAsync(int days);
}
