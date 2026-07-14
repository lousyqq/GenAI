using GenAI.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace GenAI.Data.Configurations;

public class MapFabRoleConfiguration : IEntityTypeConfiguration<MapFabRole>
{
    public void Configure(EntityTypeBuilder<MapFabRole> builder)
    {
        builder.HasKey(e => new { e.FabId, e.RoleId });
        builder.HasOne(e => e.Fab).WithMany(f => f.MapFabRoles).HasForeignKey(e => e.FabId);
        builder.HasOne(e => e.Role).WithMany().HasForeignKey(e => e.RoleId);
    }
}

public class MapAccountRoleConfiguration : IEntityTypeConfiguration<MapAccountRole>
{
    public void Configure(EntityTypeBuilder<MapAccountRole> builder)
    {
        builder.HasKey(e => new { e.EmpId, e.RoleId });
        builder.HasOne(e => e.Account).WithMany(a => a.MapAccountRoles).HasForeignKey(e => e.EmpId);
        builder.HasOne(e => e.Role).WithMany().HasForeignKey(e => e.RoleId);
    }
}

public class MapAccountManageMenuConfiguration : IEntityTypeConfiguration<MapAccountManageMenu>
{
    public void Configure(EntityTypeBuilder<MapAccountManageMenu> builder)
    {
        builder.HasKey(e => new { e.EmpId, e.MenuId });
        builder.HasOne(e => e.Account).WithMany(a => a.MapAccountManageMenus).HasForeignKey(e => e.EmpId);
        builder.HasOne(e => e.Menu).WithMany().HasForeignKey(e => e.MenuId);
    }
}

public class MapRoleMenuConfiguration : IEntityTypeConfiguration<MapRoleMenu>
{
    public void Configure(EntityTypeBuilder<MapRoleMenu> builder)
    {
        builder.HasKey(e => new { e.RoleId, e.MenuId });
        builder.HasOne(e => e.Role).WithMany(r => r.MapRoleMenus).HasForeignKey(e => e.RoleId);
        builder.HasOne(e => e.Menu).WithMany().HasForeignKey(e => e.MenuId);
    }
}

public class MapMenuStructureConfiguration : IEntityTypeConfiguration<MapMenuStructure>
{
    public void Configure(EntityTypeBuilder<MapMenuStructure> builder)
    {
        builder.HasKey(e => new { e.ParentMenuId, e.ChildMenuId });
        builder.HasOne(e => e.ParentMenu).WithMany().HasForeignKey(e => e.ParentMenuId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(e => e.ChildMenu).WithMany(m => m.MapMenuStructuresChild).HasForeignKey(e => e.ChildMenuId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class MapAccountDefaultPageConfiguration : IEntityTypeConfiguration<MapAccountDefaultPage>
{
    public void Configure(EntityTypeBuilder<MapAccountDefaultPage> builder)
    {
        builder.HasKey(e => new { e.EmpId, e.FabId, e.MenuId });
        builder.HasOne(e => e.Account).WithMany(a => a.MapAccountDefaultPages).HasForeignKey(e => e.EmpId);
        builder.HasOne(e => e.Fab).WithMany().HasForeignKey(e => e.FabId);
        builder.HasOne(e => e.Menu).WithMany().HasForeignKey(e => e.MenuId);
    }
}

public class MapAccountExtraMenuConfiguration : IEntityTypeConfiguration<MapAccountExtraMenu>
{
    public void Configure(EntityTypeBuilder<MapAccountExtraMenu> builder)
    {
        // per-fab：複合主鍵含 FabId。FabId 刻意不設 FK 到 Fabs
        // （避免 Account/Menu/Fab 多重 cascade path；舊資料遷移後 FabId='' 也不會卡 FK）。
        builder.HasKey(e => new { e.EmpId, e.FabId, e.MenuId });
        builder.HasOne(e => e.Account).WithMany(a => a.MapAccountExtraMenus).HasForeignKey(e => e.EmpId);
        builder.HasOne(e => e.Menu).WithMany().HasForeignKey(e => e.MenuId);
    }
}

public class MapAccountDenyMenuConfiguration : IEntityTypeConfiguration<MapAccountDenyMenu>
{
    public void Configure(EntityTypeBuilder<MapAccountDenyMenu> builder)
    {
        // per-fab：複合主鍵含 FabId（理由同 ExtraMenu）。
        builder.HasKey(e => new { e.EmpId, e.FabId, e.MenuId });
        builder.HasOne(e => e.Account).WithMany(a => a.MapAccountDenyMenus).HasForeignKey(e => e.EmpId);
        builder.HasOne(e => e.Menu).WithMany().HasForeignKey(e => e.MenuId);
    }
}

public class MapMenuAllowAccountConfiguration : IEntityTypeConfiguration<MapMenuAllowAccount>
{
    public void Configure(EntityTypeBuilder<MapMenuAllowAccount> builder)
    {
        builder.HasKey(e => new { e.MenuId, e.EmpId });
        builder.HasOne(e => e.Menu).WithMany(m => m.MapMenuAllowAccounts).HasForeignKey(e => e.MenuId);
        builder.HasOne(e => e.Account).WithMany().HasForeignKey(e => e.EmpId);
    }
}

public class MapMenuDenyAccountConfiguration : IEntityTypeConfiguration<MapMenuDenyAccount>
{
    public void Configure(EntityTypeBuilder<MapMenuDenyAccount> builder)
    {
        builder.HasKey(e => new { e.MenuId, e.EmpId });
        builder.HasOne(e => e.Menu).WithMany(m => m.MapMenuDenyAccounts).HasForeignKey(e => e.MenuId);
        builder.HasOne(e => e.Account).WithMany().HasForeignKey(e => e.EmpId);
    }
}
