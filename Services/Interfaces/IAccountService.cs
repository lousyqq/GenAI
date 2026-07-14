using GenAI.Controllers;

namespace GenAI.Services.Interfaces;

public interface IAccountService
{
    /// <summary>
    /// 帳號清單 server-side 分頁（供「帳號管理」表格按需載入）。
    ///   只回每列「基本顯示資料」（empId/name/department/roleLevel + assignedRoles + defaultPages），
    ///   不含 manageableMenus/extra/deny 等明細（那些只在編輯時透過 GetAccountDetailsAsync lazy-load）。
    ///   q：以 EmpId / Name / Department 模糊比對；分頁直接下推 DB（Skip/Take），避免全表撈進記憶體。
    /// </summary>
    Task<(List<object> items, int total)> GetAccountsPagedAsync(int page, int pageSize, string? q);

    /// <summary>
    /// 一次性匯出全部帳號的完整明細（供 Excel 匯出備份用，admin 明確觸發、非熱路徑）。
    ///   含 assignedRoles / manageableMenus / defaultPages（對齊 createWorkbookData 會用到的 sheet 欄位）。
    /// </summary>
    Task<List<object>> GetAccountsForExportAsync();

    Task<object?> GetAccountDetailsAsync(string empId);
    Task<(bool success, string errorMessage)> CreateAccountAsync(AccountFullDto dto);
    // notFound 旗標：true = 帳號真的不存在（controller 回 404）；false = 帳號存在但被策略/驗證拒絕（回 400）。
    Task<(bool success, string errorMessage, bool notFound)> UpdateAccountAsync(string empId, AccountFullDto dto);
    Task<(bool success, string errorMessage, string? backupJson)> DeleteAccountAsync(string empId, string? currentEmpId = null);
}
