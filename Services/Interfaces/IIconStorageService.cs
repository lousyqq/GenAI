namespace GenAI.Services.Interfaces;

/// <summary>
/// 圖示儲存統一服務 —— Menu.Icon 與 App.IconBase64 共用同一套策略。
///
/// 歷史背景（為什麼存在）：
///   舊版 Menu icon 直接把 base64 data URI 塞進 DB 欄位、App icon 則寫實體檔到 wwwroot/images/icons，
///   兩套策略不一致；且 base64 進 DB 會撐肥 GetInitialData 的 10s 快取、拖慢全網載入。
///   現在一律「base64 → 實體檔，DB 只存路徑 /images/icons/xxx」。
///
/// 安全性：
///   - 副檔名取自 MIME 白名單（png/jpg/jpeg/gif/webp/svg/bmp/ico），非白名單的 data URI 直接丟棄（防 data:text/html 之類）。
///   - 刪檔一律 Path.GetFileName 取檔名（擋 ../ path traversal），且只刪 /images/icons 底下的檔。
/// </summary>
public interface IIconStorageService
{
    /// <summary>
    /// 將傳入的 icon 值正規化為「可存進 DB 的最終值」：
    ///   - data:image/...;base64,... （白名單 MIME）→ 寫成實體檔，回傳 "/images/icons/{guid}.{ext}"
    ///   - 非白名單的 data: URI → 回傳 ""（丟棄，不存危險內容）
    ///   - 既有的本站 icon 路徑（相對 "/images/icons/x" 或自我參照的絕對 URL "http://host/images/icons/x"）→ 正規化成相對路徑
    ///   - 其餘（FontAwesome class "fas fa-folder"、null/空字串、外部 URL）→ 原值回傳
    /// </summary>
    Task<string?> SaveAsync(string? icon);

    /// <summary>
    /// 若 oldIcon 是本站 /images/icons 檔、且更新/刪除後已無任何 Menu.Icon 或 App.IconBase64 參照它，
    /// 就把實體檔刪掉（避免磁碟孤兒慢漏）。非本站檔 / 仍被參照 → 不動作。
    /// ⚠️ 必須在 DB 變更已 SaveChanges 之後呼叫，參照檢查才會反映最新狀態。
    /// </summary>
    Task DeleteIfLocalUnreferencedAsync(string? oldIcon);

    /// <summary>
    /// 一次性資料遷移：把 DB 中既有以 base64 (data:) 儲存的 Menu.Icon / App.IconBase64 轉成實體檔。
    /// 啟動時呼叫，idempotent（轉完後就沒有 data: 列、再跑為 no-op）。回傳轉換筆數。
    /// </summary>
    Task<int> MigrateBase64IconsAsync();
}
