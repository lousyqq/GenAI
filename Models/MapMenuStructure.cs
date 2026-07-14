using System.ComponentModel.DataAnnotations.Schema;

namespace GenAI.Models;

[Table("Map_Menu_Structure")]
public class MapMenuStructure
{
    public string ParentMenuId { get; set; } = string.Empty;
    public string ChildMenuId { get; set; } = string.Empty;
    public int? SortOrder { get; set; }

    public Menu? ParentMenu { get; set; }
    public Menu? ChildMenu { get; set; }
}
