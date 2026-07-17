using System.Text.RegularExpressions;
using GenAI.Data;
using GenAI.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace GenAI.Services;

/// <inheritdoc cref="IIconStorageService"/>
public class IconStorageService : IIconStorageService
{
    private readonly AppDbContext _context;
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<IconStorageService> _logger;

    // 本站 icon 路徑的共同前綴（同時用於辨識、正規化、刪檔）
    private const string IconUrlPrefix = "/images/icons/";

    // MIME → 副檔名白名單。非白名單的 data: URI 一律丟棄（防 data:text/html 等怪內容寫進磁碟/DB）。
    private static readonly Dictionary<string, string> MimeToExt = new(StringComparer.OrdinalIgnoreCase)
    {
        ["image/jpeg"] = "jpg",
        ["image/jpg"] = "jpg",
        ["image/png"] = "png",
        ["image/gif"] = "gif",
        ["image/webp"] = "webp",
        ["image/svg+xml"] = "svg",
        ["image/bmp"] = "bmp",
        ["image/x-icon"] = "ico",
        ["image/vnd.microsoft.icon"] = "ico",
    };

    private static readonly Regex DataUriRegex =
        new(@"^data:(?<mime>[^;,]+);base64,(?<data>.+)$", RegexOptions.Singleline | RegexOptions.Compiled);

    public IconStorageService(AppDbContext context, IWebHostEnvironment env, ILogger<IconStorageService> logger)
    {
        _context = context;
        _env = env;
        _logger = logger;
    }

    public async Task<string?> SaveAsync(string? icon)
    {
        if (string.IsNullOrWhiteSpace(icon)) return icon;
        var trimmed = icon.Trim();

        // 1) data: URI —— base64 圖片寫實體檔；非白名單 / 解析失敗 → 丟棄（回空字串，不存危險內容）
        if (trimmed.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
        {
            return await ConvertDataUriToFileAsync(trimmed) ?? "";
        }

        // 2) 既有本站 icon 路徑（相對或自我參照的絕對 URL）→ 正規化成相對路徑
        var normalized = TryNormalizeLocalPath(trimmed);
        if (normalized != null) return normalized;

        // 3) 其餘（FontAwesome class、外部 URL 等）→ 原值回傳
        return icon;
    }

    public async Task DeleteIfLocalUnreferencedAsync(string? oldIcon)
    {
        if (string.IsNullOrWhiteSpace(oldIcon)) return;

        var normalized = TryNormalizeLocalPath(oldIcon.Trim());
        if (normalized == null) return; // 非本站 icon 檔（FA class / data: / 外部 URL）→ 沒有實體檔可刪

        var fileName = Path.GetFileName(normalized); // path traversal 防護
        if (string.IsNullOrWhiteSpace(fileName)) return;

        // 參照檢查：DB 中是否仍有任何 Menu.Icon / App.IconBase64 指向同一個檔名（含 update 後 old==new 的情況）
        var stillUsed =
            await _context.Menus.AsNoTracking().AnyAsync(m => m.Icon != null && m.Icon.Contains(fileName))
            || await _context.Apps.AsNoTracking().AnyAsync(a => a.IconBase64 != null && a.IconBase64.Contains(fileName));
        if (stillUsed) return;

        try
        {
            var path = Path.Combine(GetSafeWebRootPath(), "images", "icons", fileName);
            if (File.Exists(path)) File.Delete(path);
        }
        catch (Exception ex)
        {
            // 刪檔失敗不該影響主流程（DB 已正確），只記 warning
            _logger.LogWarning(ex, "刪除孤兒 icon 檔 {File} 失敗（DB 已更新，僅磁碟未清）", fileName);
        }
    }

    private string GetSafeWebRootPath()
    {
        var path = _env.WebRootPath;
        if (string.IsNullOrWhiteSpace(path))
        {
            path = Path.Combine(_env.ContentRootPath, "wwwroot");
        }
        return path;
    }

    public async Task<int> MigrateBase64IconsAsync()
    {
        int converted = 0;

        var menus = await _context.Menus
            .Where(m => m.Icon != null && m.Icon.StartsWith("data:"))
            .ToListAsync();
        foreach (var m in menus)
        {
            var saved = await SaveAsync(m.Icon);
            if (saved != m.Icon) { m.Icon = saved; converted++; }
        }

        var apps = await _context.Apps
            .Where(a => a.IconBase64 != null && a.IconBase64.StartsWith("data:"))
            .ToListAsync();
        foreach (var a in apps)
        {
            var saved = await SaveAsync(a.IconBase64);
            if (saved != a.IconBase64) { a.IconBase64 = saved; converted++; }
        }

        if (converted > 0)
        {
            await _context.SaveChangesAsync();
            _logger.LogInformation("✅ IconStorage 一次性遷移：{Count} 筆 base64 icon 已轉為實體檔", converted);
        }
        return converted;
    }

    /// <summary>把 base64 data URI 寫成實體檔，回傳 "/images/icons/{guid}.{ext}"；非白名單/解析失敗或寫檔無權限時自動降級回傳原始 base64。</summary>
    private async Task<string?> ConvertDataUriToFileAsync(string dataUri)
    {
        var match = DataUriRegex.Match(dataUri);
        if (!match.Success) return null;

        var mime = match.Groups["mime"].Value.Trim();
        if (!MimeToExt.TryGetValue(mime, out var ext)) return null; // 白名單之外一律拒絕

        byte[] data;
        try
        {
            data = Convert.FromBase64String(match.Groups["data"].Value);
        }
        catch
        {
            return null; // base64 壞掉
        }
        if (data.Length == 0) return null;

        var folder = Path.Combine(GetSafeWebRootPath(), "images", "icons");
        try
        {
            Directory.CreateDirectory(folder);
            var fileName = $"{Guid.NewGuid():N}.{ext}";
            await File.WriteAllBytesAsync(Path.Combine(folder, fileName), data);
            return IconUrlPrefix + fileName;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "⚠️ 實體圖片寫檔失敗 ({Folder})：可能為 IIS 目錄寫入權限不足或路徑錯誤。系統已降級直接以 Base64 儲存至 DB，確保功能正常", folder);
            return dataUri;
        }
    }

    /// <summary>
    /// 若 value 是本站 icon（相對 "/images/icons/x" 或絕對 "http://host/images/icons/x"），
    /// 取出檔名（擋掉 query/hash 與 ../）並回傳正規化的相對路徑 "/images/icons/{file}"；否則回 null。
    /// </summary>
    private static string? TryNormalizeLocalPath(string value)
    {
        var idx = value.IndexOf(IconUrlPrefix, StringComparison.OrdinalIgnoreCase);
        if (idx < 0) return null;

        var fileName = value.Substring(idx + IconUrlPrefix.Length);

        // 砍掉 query / hash
        var cut = fileName.IndexOfAny(new[] { '?', '#' });
        if (cut >= 0) fileName = fileName.Substring(0, cut);

        fileName = Path.GetFileName(fileName); // path traversal 防護（去掉任何路徑片段）
        if (string.IsNullOrWhiteSpace(fileName)) return null;

        return IconUrlPrefix + fileName;
    }
}
