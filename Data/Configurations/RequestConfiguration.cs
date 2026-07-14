using GenAI.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace GenAI.Data.Configurations;

public class RequestConfiguration : IEntityTypeConfiguration<Request>
{
    public void Configure(EntityTypeBuilder<Request> builder)
    {
        builder.HasKey(e => e.RequestId);
        builder.Property(e => e.RequestId).HasMaxLength(50);
        // 實體索引 IX_Requests_Status 由 SchemaBootstrap.EnsureIndexesAsync 統一建立
        // （本專案無 EF Migrations，HasIndex 對既有 DB 不會真的建索引，故不在此宣告以免誤導）
    }
}
