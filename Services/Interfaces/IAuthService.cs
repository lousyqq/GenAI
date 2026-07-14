namespace GenAI.Services.Interfaces;

/// <summary>
/// 認證服務介面 - 統合 Windows 自動身份識別 + LDAP 手動驗證 + Accounts 表查詢
/// </summary>
public interface IAuthService
{
    /// <summary>
    /// 從 Windows 身份字串 (例如 "UMC\41856" 或 "41856@umc.com") 萃取出工號。
    /// 失敗回 null。
    /// </summary>
    string? ExtractEmpIdFromWindowsIdentity(string? identityName);

    /// <summary>
    /// 對 AD LDAP 進行 bind 驗證。
    /// 若 appsettings.Auth.Ldap.Enabled = false，會直接回 (false, "LDAP 未啟用")。
    /// </summary>
    Task<(bool success, string? errorMessage)> VerifyLdapPasswordAsync(string empId, string password);

    /// <summary>
    /// 確認該工號是否存在於 Accounts 表，並回傳 Account（不存在則回 null）。
    /// </summary>
    Task<Models.Account?> FindAccountAsync(string empId);

    /// <summary>
    /// 比對 appsettings.Auth.TestAccounts 白名單。
    /// 若該工號是白名單成員且密碼正確 → 回 (true, 對應的 fake Account skeleton)。
    /// fake Account 僅在 DB Accounts 表沒有這個工號時，作為 fallback 使用。
    /// </summary>
    (bool matched, Models.Account? fallbackAccount) VerifyTestAccount(string empId, string password);
}
