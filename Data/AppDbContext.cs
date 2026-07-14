using Microsoft.EntityFrameworkCore;
using GenAI.Models;

namespace GenAI.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    // 定義資料庫的實體映射表
    public DbSet<Account> Accounts { get; set; }
    public DbSet<Role> Roles { get; set; }
    public DbSet<Menu> Menus { get; set; }
    public DbSet<Fab> Fabs { get; set; }
    public DbSet<AppItem> Apps { get; set; }
    public DbSet<Request> Requests { get; set; }
    public DbSet<PersonalSetting> PersonalSettings { get; set; }
    
    // Mapping Tables
    public DbSet<MapFabRole> MapFabRoles { get; set; }
    public DbSet<MapAccountRole> MapAccountRoles { get; set; }
    public DbSet<MapAccountManageMenu> MapAccountManageMenus { get; set; }
    public DbSet<MapRoleMenu> MapRoleMenus { get; set; }
    public DbSet<MapMenuStructure> MapMenuStructures { get; set; }
    public DbSet<MapAccountDefaultPage> MapAccountDefaultPages { get; set; }
    public DbSet<MapAccountExtraMenu> MapAccountExtraMenus { get; set; }
    public DbSet<MapAccountDenyMenu> MapAccountDenyMenus { get; set; }
    public DbSet<MapMenuAllowAccount> MapMenuAllowAccounts { get; set; }
    public DbSet<MapMenuDenyAccount> MapMenuDenyAccounts { get; set; }

    // 操作紀錄
    public DbSet<UserActivityLog> UserActivityLogs { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
    }
}
