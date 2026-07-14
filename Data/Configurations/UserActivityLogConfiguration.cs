using GenAI.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace GenAI.Data.Configurations;

public class UserActivityLogConfiguration : IEntityTypeConfiguration<UserActivityLog>
{
    public void Configure(EntityTypeBuilder<UserActivityLog> builder)
    {
        builder.HasKey(e => e.LogId);
        builder.Property(e => e.EmpId).HasMaxLength(50);
        builder.Property(e => e.EmpName).HasMaxLength(100);
        builder.Property(e => e.Action).HasMaxLength(50);
        builder.Property(e => e.Category).HasMaxLength(50);
        builder.Property(e => e.IpAddress).HasMaxLength(50);

        // 實體索引（IX_UserActivityLogs_Timestamp / _EmpId_Timestamp / _Category_Time）
        // 由 SchemaBootstrap.EnsureIndexesAsync 統一建立。
        // 注意：原本單欄 HasIndex(EmpId) 已被複合索引 (EmpId, Timestamp DESC) 取代，
        // 後者完整覆蓋「依員工查最近操作」的查詢，故不再宣告單欄版本。
        // （本專案無 EF Migrations，HasIndex 對既有 DB 不會真的建索引，故不在此宣告以免誤導）
    }
}
