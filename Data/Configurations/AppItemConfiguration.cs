using GenAI.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace GenAI.Data.Configurations;

public class AppItemConfiguration : IEntityTypeConfiguration<AppItem>
{
    public void Configure(EntityTypeBuilder<AppItem> builder)
    {
        builder.HasKey(e => e.AppId);
        builder.Property(e => e.AppId).HasMaxLength(50);
    }
}
