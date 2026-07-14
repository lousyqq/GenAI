using System.ComponentModel.DataAnnotations;

namespace GenAI.Models;

public class Menu
{
    [Key]
    [MaxLength(50)]
    public string MenuId { get; set; } = null!;
    public string? SysName { get; set; }
    public string? DisplayName { get; set; }
    public string? MenuMode { get; set; }
    public string? Url { get; set; }
    public string? TargetPage { get; set; }
    public string? OpenTarget { get; set; }
    public string? Icon { get; set; }
    public string? CreatedBy { get; set; }
    public bool? IsEnabled { get; set; }
    public bool? IsPoolItem { get; set; }
    public bool? IsEdited { get; set; }
    public int? GlobalOrder { get; set; }

    public ICollection<MapMenuStructure>? MapMenuStructuresChild { get; set; }
    public ICollection<MapMenuAllowAccount>? MapMenuAllowAccounts { get; set; }
    public ICollection<MapMenuDenyAccount>? MapMenuDenyAccounts { get; set; }
}
