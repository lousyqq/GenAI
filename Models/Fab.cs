using System.ComponentModel.DataAnnotations;

namespace GenAI.Models;

public class Fab
{
    [Key]
    [MaxLength(50)]
    public string FabId { get; set; } = null!;
    public string? FabName { get; set; }
    public string? DisplayName { get; set; }
    public string? DefaultLang { get; set; }
    
    public ICollection<MapFabRole>? MapFabRoles { get; set; }
}
