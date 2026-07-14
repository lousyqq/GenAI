namespace GenAI.Helpers;

/// <summary>
/// 取請求來源 client IP 的共用工具（原本在 ActivityLogger 與 ActivityLoggingMiddleware 各有一份、已收斂於此）。
/// </summary>
public static class ClientIpHelper
{
    /// <summary>
    /// 取真實 client IP。in-proc IIS 下 RemoteIpAddress 通常就是真實 IP；
    /// 若前面有反向代理 (ARR/Nginx)，會帶 X-Forwarded-For，這裡優先用第一個非空值。
    /// ⚠️ X-Forwarded-For 可被 client 偽造，僅用於稽核 log 紀錄，<b>不可用於權限/安全判定</b>。
    /// </summary>
    public static string? GetClientIp(HttpContext ctx)
    {
        var xff = ctx.Request.Headers["X-Forwarded-For"].ToString();
        if (!string.IsNullOrWhiteSpace(xff))
        {
            var first = xff.Split(',')[0].Trim();
            if (!string.IsNullOrEmpty(first)) return first;
        }
        return ctx.Connection.RemoteIpAddress?.ToString();
    }
}
