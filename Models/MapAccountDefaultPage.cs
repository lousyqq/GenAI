using System.ComponentModel.DataAnnotations.Schema;

namespace GenAI.Models;

[Table("Map_Account_DefaultPage")]
public class MapAccountDefaultPage
{
    public string EmpId { get; set; } = string.Empty;
    public string FabId { get; set; } = string.Empty;
    public string? MenuId { get; set; }

    public Account? Account { get; set; }
    public Fab? Fab { get; set; }
    public Menu? Menu { get; set; }
}
