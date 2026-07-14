namespace GenAI.Services.Interfaces;

/// <summary>
/// InitialData 快取 / ETag 的單一事實來源 (Singleton)。
///
/// 同時被 <c>SettingsService</c>（讀寫快取、提供 ETag）與 <c>CacheInvalidationInterceptor</c>
/// （EF Core 寫入後自動作廢）依賴。抽成獨立 singleton 是為了打破
/// SettingsService(Scoped) ↔ AppDbContext ↔ Interceptor 之間的 DI 循環
/// （Interceptor 需在 AddDbContext 註冊時取得，不能再回頭依賴 Scoped 的 SettingsService）。
///
/// ETag 的用途：餵給 <c>MenuAuthService</c> 的 <c>visibleMenus:{ETag}:{empId}</c> 跨請求快取，
/// 任一權限相關寫入 bump ETag 即自動作廢該可見集合快取（見 CLAUDE.md §6.2 "double load-bearing"）。
/// </summary>
public interface IInitialDataCacheInvalidator
{
    /// <summary>全域快取 key（不常變動的配置：Menus/Fabs/Roles/Apps + 結構/ACL 關聯）。</summary>
    string GlobalCacheKey { get; }

    /// <summary>易變動快取 key（Accounts/Requests/PersonalSettings + Account 層級關聯）。</summary>
    string VolatileCacheKey { get; }

    /// <summary>目前 ETag（HEX Guid）。供 SettingsController 回 ETag 標頭與 MenuAuthService 快取 key 用。</summary>
    string CurrentETag { get; }

    /// <summary>清除全域 + 易變動快取並 bump ETag。任何會動到權限相關表的寫入後必做。</summary>
    void Invalidate();

    /// <summary>僅清除易變動快取並 bump ETag。適用單一使用者更新自己的版面 / 登入次數。</summary>
    void InvalidateVolatile();
}
