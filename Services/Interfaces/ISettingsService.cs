using System.Text.Json;

namespace GenAI.Services.Interfaces;

/// <summary>
/// 設定資料服務介面 - 負責讀取/寫入/同步所有設定資料表
/// </summary>
public interface ISettingsService
{
    /// <summary>取得目前的 ETag 值</summary>
    string GetCurrentETag();

    /// <summary>
    /// 讀取所有資料表並回傳為字典結構。
    /// 全域表（不隨帳號數成長）走共享快取；「帳號相關表」(Accounts / PersonalSettings / Map_Account_*)
    /// 改以 <paramref name="empId"/> 做 per-caller 點查（只回呼叫者自己這列、不快取），避免 10 萬帳號時整包常駐記憶體 (P1)。
    /// </summary>
    /// <param name="empId">呼叫者工號（取自 ClaimTypes.NameIdentifier）；帳號相關表只回此工號的列。</param>
    Task<Dictionary<string, object>> GetInitialDataAsync(string empId);

    /// <summary>將前端傳來的 JSON payload 寫入資料庫（含批次防呆）</summary>
    Task<(bool success, string message)> SaveDataAsync(Dictionary<string, List<Dictionary<string, JsonElement>>> payload);

    /// <summary>更新登入統計（LoginCount + 1、LastLoginTime）</summary>
    Task<(bool success, int loginCount, string? lastLoginTime, string? errorMessage)> UpdateLoginStatsAsync(string empId);

    /// <summary>
    /// 清除 GetInitialDataAsync 的快取 (全域與個人快取)。
    /// 任何 RESTful Controller（Fabs/Roles/Menus...）寫入後必須呼叫。
    /// </summary>
    void InvalidateInitialDataCache();

    /// <summary>
    /// 僅清除容易變動的個人資料快取 (PersonalSettings, Accounts, Requests 等)。
    /// 適用於單一使用者更新自己的版面或登入次數時。
    /// </summary>
    void InvalidateVolatileDataCache();
}
