using System.ComponentModel.DataAnnotations.Schema;

namespace GenAI.Models;

/// <summary>
/// Menu 層級白名單：列出來的工號才能看到這個 menu。空表 → 不卡控。
/// </summary>
[Table("Map_Menu_AllowAccount")]
public class MapMenuAllowAccount
{
    public string MenuId { get; set; } = string.Empty;
    public string EmpId { get; set; } = string.Empty;

    public Menu? Menu { get; set; }
    public Account? Account { get; set; }
}
