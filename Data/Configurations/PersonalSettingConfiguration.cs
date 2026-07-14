using GenAI.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace GenAI.Data.Configurations;

public class PersonalSettingConfiguration : IEntityTypeConfiguration<PersonalSetting>
{
    public void Configure(EntityTypeBuilder<PersonalSetting> builder)
    {
        builder.HasKey(e => new { e.EmpId, e.MenuId });
        builder.Property(e => e.EmpId).HasMaxLength(50);
        builder.Property(e => e.MenuId).HasMaxLength(50);
    }
}
