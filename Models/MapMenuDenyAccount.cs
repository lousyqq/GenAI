using System.ComponentModel.DataAnnotations.Schema;

namespace GenAI.Models;

/// <summary>
/// Menu 層級黑名單：列出來的工號不能看到這個 menu (其他人不受影響)。
/// </summary>
[Table("Map_Menu_DenyAccount")]
public class MapMenuDenyAccount
{
    public string MenuId { get; set; } = string.Empty;
    public string EmpId { get; set; } = string.Empty;

    public Menu? Menu { get; set; }
    public Account? Account { get; set; }
}
