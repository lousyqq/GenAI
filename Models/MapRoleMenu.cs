using System.ComponentModel.DataAnnotations.Schema;

namespace GenAI.Models;

[Table("Map_Role_Menu")]
public class MapRoleMenu
{
    public string RoleId { get; set; } = string.Empty;
    public string MenuId { get; set; } = string.Empty;
    public int? SortOrder { get; set; }

    public Role? Role { get; set; }
    public Menu? Menu { get; set; }
}
