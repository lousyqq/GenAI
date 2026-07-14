using System.ComponentModel.DataAnnotations;

namespace GenAI.Models;

public class AppItem
{
    [Key]
    [MaxLength(50)]
    public string AppId { get; set; } = null!;
    public string? MenuId { get; set; }
    public string? AppName { get; set; }
    public string? Url { get; set; }
    public string? IconBase64 { get; set; }
    public string? Target { get; set; }
}
