using GenAI.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace GenAI.Data.Configurations;

public class AccountConfiguration : IEntityTypeConfiguration<Account>
{
    public void Configure(EntityTypeBuilder<Account> builder)
    {
        builder.HasKey(e => e.EmpId);
        builder.Property(e => e.EmpId).HasMaxLength(50);
        // 實體索引 IX_Accounts_RoleLevel 由 SchemaBootstrap.EnsureIndexesAsync 統一建立
        // （本專案無 EF Migrations，HasIndex 對既有 DB 不會真的建索引，故不在此宣告以免誤導）
    }
}
