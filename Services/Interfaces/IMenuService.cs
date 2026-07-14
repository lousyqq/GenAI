using GenAI.Controllers; // MenuDto 定義於 MenusController.cs（與 AccountFullDto 留在 AccountsController 同慣例）

namespace GenAI.Services.Interfaces;

/// <summary>
/// 選單（看板）CRUD 服務 —— 從 MenusController 抽出的業務邏輯（授權閘門、結構/ACL 重建、圖示孤兒清理、交易）。
/// Controller 僅負責：取 claims（empId/isAdmin）、把 <see cref="MenuOperationResult"/> 映射成 HTTP 狀態碼、寫稽核 log。
/// 授權判定（CanEditOrDeleteMenu / CanManageStructure / IsDelegatedAdmin）仍委由 IMenuAuthService。
/// </summary>
public interface IMenuService
{
    /// <summary>取得目前使用者可見的選單投影清單（非 admin 已做列級過濾、ACL 欄位遮蔽）。</summary>
    Task<List<object>> GetMenusAsync(string empId, bool isAdmin);

    /// <summary>新建選單（含父節點掛載權限檢查、ACL 跨界防護、圖示存檔）。</summary>
    Task<MenuOperationResult> CreateMenuAsync(MenuDto dto, string empId, bool isAdmin);

    /// <summary>更新選單（path id 為事實來源、編輯權閘門、結構/ACL 全刪重建、舊圖示孤兒清理）。</summary>
    Task<MenuOperationResult> UpdateMenuAsync(string id, MenuDto dto, string empId, bool isAdmin);

    /// <summary>刪除單一選單（清 FK 關聯、回傳 backupJson 供 Controller 寫稽核還原備份）。</summary>
    Task<MenuOperationResult> DeleteMenuAsync(string id, string empId, bool isAdmin);

    /// <summary>批次更新（拖曳排序/掛載）：單一交易內全刪重建受影響選單的結構與 ACL。</summary>
    Task<MenuOperationResult> BatchUpdateMenusAsync(List<MenuDto> dtos, string empId, bool isAdmin);

    /// <summary>批次刪除：清 FK 關聯後整批移除，回傳 backupJson 供 Controller 寫稽核還原備份。</summary>
    Task<MenuOperationResult> BatchDeleteMenusAsync(List<string> ids, string empId, bool isAdmin);
}

/// <summary>選單操作結果。以 <see cref="MenuOpStatus"/> 區分 200/400/403/404，讓 Controller 精準映射 HTTP（授權測試依賴 403）。</summary>
public enum MenuOpStatus
{
    Success,
    Forbidden,
    NotFound,
    BadRequest
}

/// <summary>
/// 選單寫入操作的結果載體。<see cref="BackupJson"/> 僅在刪除類操作成功時帶值（供 Controller 寫入稽核還原備份）。
/// </summary>
public sealed class MenuOperationResult
{
    public MenuOpStatus Status { get; init; }
    public string? Message { get; init; }
    public string? BackupJson { get; init; }

    public bool IsSuccess => Status == MenuOpStatus.Success;

    public static MenuOperationResult Ok(string? backupJson = null)
        => new() { Status = MenuOpStatus.Success, BackupJson = backupJson };
    public static MenuOperationResult Forbidden()
        => new() { Status = MenuOpStatus.Forbidden };
    public static MenuOperationResult NotFound(string? message = null)
        => new() { Status = MenuOpStatus.NotFound, Message = message };
    public static MenuOperationResult BadRequest(string message)
        => new() { Status = MenuOpStatus.BadRequest, Message = message };
}
