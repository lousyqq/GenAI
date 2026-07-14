using System.ComponentModel.DataAnnotations;

namespace GenAI.Models;

public class Account
{
    [Key]
    [MaxLength(50)]
    public string EmpId { get; set; } = null!;
    public string? Name { get; set; }
    public string? Department { get; set; }
    public string? RoleLevel { get; set; }
    public bool? CanEditOthers { get; set; }
    public int? LoginCount { get; set; }
    public DateTime? LastLoginTime { get; set; }

    public ICollection<MapAccountRole>? MapAccountRoles { get; set; }
    public ICollection<MapAccountManageMenu>? MapAccountManageMenus { get; set; }
    public ICollection<MapAccountDefaultPage>? MapAccountDefaultPages { get; set; }
    public ICollection<MapAccountExtraMenu>? MapAccountExtraMenus { get; set; }
    public ICollection<MapAccountDenyMenu>? MapAccountDenyMenus { get; set; }
}
