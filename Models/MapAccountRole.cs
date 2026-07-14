using System.ComponentModel.DataAnnotations.Schema;

namespace GenAI.Models;

[Table("Map_Account_Role")]
public class MapAccountRole
{
    public string EmpId { get; set; } = string.Empty;
    public string RoleId { get; set; } = string.Empty;

    public Account? Account { get; set; }
    public Role? Role { get; set; }
}
