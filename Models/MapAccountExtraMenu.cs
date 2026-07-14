using System.ComponentModel.DataAnnotations.Schema;

namespace GenAI.Models;

/// <summary>
/// 帳號層級「額外開放」可視 Menu（RBAC 之外的單一新增），**綁定特定廠區 (FabId)**。
/// 權限計算（per-fab）：該廠區 effective = role.allowedMenuIds(該廠區角色) ∪ extraMenus[fab] - denyMenus[fab]
/// 複合主鍵 (EmpId, FabId, MenuId)；FabId 為一般欄位、刻意不設 FK 到 Fabs
/// （避免 Account/Menu/Fab 三方 cascade path 衝突；舊資料遷移後 FabId='' 也不會卡 FK）。
/// </summary>
[Table("Map_Account_ExtraMenu")]
public class MapAccountExtraMenu
{
    public string EmpId { get; set; } = string.Empty;
    public string FabId { get; set; } = string.Empty;
    public string MenuId { get; set; } = string.Empty;

    public Account? Account { get; set; }
    public Menu? Menu { get; set; }
}
