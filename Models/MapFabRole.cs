using System.ComponentModel.DataAnnotations.Schema;

namespace GenAI.Models;

[Table("Map_Fab_Role")]
public class MapFabRole
{
    public string FabId { get; set; } = string.Empty;
    public string RoleId { get; set; } = string.Empty;

    public Fab? Fab { get; set; }
    public Role? Role { get; set; }
}
