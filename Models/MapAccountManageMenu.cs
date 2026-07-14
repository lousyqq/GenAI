using System.ComponentModel.DataAnnotations.Schema;

namespace GenAI.Models;

[Table("Map_Account_ManageMenu")]
public class MapAccountManageMenu
{
    public string EmpId { get; set; } = string.Empty;
    public string MenuId { get; set; } = string.Empty;

    public Account? Account { get; set; }
    public Menu? Menu { get; set; }
}
