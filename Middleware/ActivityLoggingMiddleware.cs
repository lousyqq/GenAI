using System.Diagnostics;
using System.Security.Claims;
using GenAI.Helpers;
using GenAI.Models;
using GenAI.Services.Interfaces;

namespace GenAI.Middleware;

/// <summary>
/// 全域 HTTP 請求紀錄 middleware。自動寫入 UserActivityLogs。
/// 跳過：靜態檔、appbase.js、與雜訊極高的 /api/Auth/Config (前端每頁載入打一次)。
/// 顯式紀錄：登入/登出/Forbid 等由 AuthController + 各 controller 用 IActivityLogger 直接呼叫，
///          其精細度高於本 middleware 的自動紀錄。
/// </summary>
public class ActivityLoggingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ActivityLoggingMiddleware> _logger;

    private static readonly string[] SkipPathPrefixes =
    {
        "/css/", "/js/", "/partials/", "/icon/", "/lib/", "/favicon.ico",
        "/appbase.js", "/api/ActivityLogs"  // ActivityLogs 自己的查詢也不要再進紀錄（會無限放大）
    };

    private static readonly string[] SkipExactPaths =
    {
        "/api/Auth/Config"  // 太雜訊
    };



    public ActivityLoggingMiddleware(RequestDelegate next, ILogger<ActivityLoggingMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext ctx, IActivityLogger activityLogger)
    {
        var path = ctx.Request.Path.Value ?? "";

        bool skip = SkipExactPaths.Any(p => string.Equals(path, p, StringComparison.OrdinalIgnoreCase))
            || SkipPathPrefixes.Any(p => path.StartsWith(p, StringComparison.OrdinalIgnoreCase));

        if (skip)
        {
            await _next(ctx);
            return;
        }

        var sw = Stopwatch.StartNew();
        Exception? caught = null;
        try
        {
            await _next(ctx);
        }
        catch (Exception ex)
        {
            caught = ex;
            throw;
        }
        finally
        {
            sw.Stop();

            // 不阻塞回應；fire-and-forget 但仍 await 以保證 scope 內 DbContext 有效
            try
            {
                var (category, action) = Categorize(ctx.Request.Method, path);

                var statusCode = ctx.Response.StatusCode;
                bool success = caught == null && statusCode is >= 200 and < 400;

                // 自動紀錄不重複登入/登出（那些有更精細的明確紀錄），
                // 依照企業標準：忽略所有「成功」的 GET 請求，大幅減少 DB 膨脹與寫放大。
                // 失敗的 GET (401/403/5xx) 仍會記錄。
                if (category != "Login" && category != "Logout"
                    && !(success && ctx.Request.Method == HttpMethods.Get))
                {
                    await activityLogger.LogAsync(new UserActivityLog
                    {
                        EmpId = ctx.User.FindFirstValue(ClaimTypes.NameIdentifier),
                        EmpName = ctx.User.FindFirstValue(ClaimTypes.Name),
                        LoginSource = ctx.User.FindFirst("LoginSource")?.Value,
                        IpAddress = ClientIpHelper.GetClientIp(ctx),
                        UserAgent = ctx.Request.Headers.UserAgent.ToString(),
                        HttpMethod = ctx.Request.Method,
                        Path = path,
                        QueryString = ctx.Request.QueryString.Value,
                        StatusCode = statusCode,
                        DurationMs = (int)sw.ElapsedMilliseconds,
                        Category = category,
                        Action = action,
                        IsSuccess = success,
                        ErrorMessage = caught?.Message
                    });
                }
            }
            catch (Exception logEx)
            {
                _logger.LogWarning(logEx, "ActivityLoggingMiddleware 紀錄失敗");
            }
        }
    }

    private static (string category, string action) Categorize(string method, string path)
    {
        var p = path.ToLowerInvariant();
        string category;
        string action;

        if (p.Contains("/api/auth/login")) { category = "Login"; action = "LoginAttempt"; }
        else if (p.Contains("/api/auth/logout")) { category = "Logout"; action = "Logout"; }
        else if (p.Contains("/api/auth/whoami")) { category = "Auth"; action = "WhoAmI"; }
        else if (p.Contains("/api/auth/myprofile")) { category = "Auth"; action = "MyProfile"; }
        else if (p.Contains("/api/menus/batch")) { category = "Menu"; action = $"BatchMenu({method})"; }
        else if (p.Contains("/api/menus")) { category = "Menu"; action = $"{method} Menu"; }
        else if (p.Contains("/api/accounts")) { category = "Account"; action = $"{method} Account"; }
        else if (p.Contains("/api/roles")) { category = "Role"; action = $"{method} Role"; }
        else if (p.Contains("/api/fabs")) { category = "Fab"; action = $"{method} Fab"; }
        else if (p.Contains("/api/apps")) { category = "App"; action = $"{method} App"; }
        else if (p.Contains("/api/requests")) { category = "Request"; action = $"{method} Request"; }
        else if (p.Contains("/api/personalsettings")) { category = "PersonalSettings"; action = $"{method} PersonalSetting"; }
        else if (p.Contains("/settings/getinitialdata")) { category = "Settings"; action = "GetInitialData"; }
        else if (p.Contains("/settings/savedata")) { category = "Settings"; action = "SaveData (全量覆寫)"; }
        else if (p.Contains("/settings/updateloginstats")) { category = "Settings"; action = "UpdateLoginStats"; }
        else if (p.Contains("/settings/")) { category = "Settings"; action = $"{method} {path}"; }
        else if (p == "/" || p.EndsWith("/index.html")) { category = "Page"; action = "OpenHomePage"; }
        else { category = "Other"; action = $"{method} {path}"; }

        return (category, action);
    }

}
