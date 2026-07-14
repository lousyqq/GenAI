using System.ComponentModel.DataAnnotations.Schema;

namespace GenAI.Models;

/// <summary>
/// 帳號層級「個別封鎖」可視 Menu（從 Role 繼承來的可視範圍中扣除），**綁定特定廠區 (FabId)**。
/// 權限計算（per-fab）：該廠區 effective = role.allowedMenuIds(該廠區角色) ∪ extraMenus[fab] - denyMenus[fab]
/// 複合主鍵 (EmpId, FabId, MenuId)；FabId 為一般欄位、刻意不設 FK 到 Fabs（理由同 ExtraMenu）。
/// </summary>
[Table("Map_Account_DenyMenu")]
public class MapAccountDenyMenu
{
    public string EmpId { get; set; } = string.Empty;
    public string FabId { get; set; } = string.Empty;
    public string MenuId { get; set; } = string.Empty;

    public Account? Account { get; set; }
    public Menu? Menu { get; set; }
}
