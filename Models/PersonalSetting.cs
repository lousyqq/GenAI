using System.ComponentModel.DataAnnotations;

namespace GenAI.Models;

public class PersonalSetting
{
    [Key]
    [MaxLength(50)]
    public string EmpId { get; set; } = null!;
    public string? MenuId { get; set; }
    public bool? IsHidden { get; set; }
    public string? OpenTarget { get; set; }
    public string? Icon { get; set; }
    public int? SortOrder { get; set; }
}
