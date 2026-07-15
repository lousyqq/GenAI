namespace GenAI.Models.Settings;

public class AuthSettings
{
    /// <summary>本機開發模擬 Windows 桌機登入帳號：設定如 "UMC\00058897" 或 "UMC\test"；留空 "" 則使用系統實際偵測到的 Windows 帳號。</summary>
    public string? SimulatedWindowsAccount { get; set; }

    public string? WindowsDomainStripPrefix { get; set; }
    public bool EnableEmergencyAdmin { get; set; }
    public bool AllowManualLogin { get; set; }
    public TestAccountsSettings TestAccounts { get; set; } = new();
    public LdapSettings Ldap { get; set; } = new();

    /// <summary>Windows 自動偵測到的工號若不在 Accounts 表 → 自動建立 user 帳號（人人可瀏覽）。</summary>
    public bool AutoProvisionWindowsAccounts { get; set; } = true;

    /// <summary>自動建帳號時預設指派的權限群組（決定新使用者看得到哪些主選單）。</summary>
    public List<string> DefaultRoleIds { get; set; } = new();

    /// <summary>
    /// 帳號權限覆寫：每次 Windows 登入時強制套用指定工號的 RoleLevel / CanEditOthers。
    /// 測試期間用來直接在設定檔卡控特定帳號（例如 yu-tinglin）為 admin 或 user+委派管理。
    /// </summary>
    public List<AccountOverride> AccountOverrides { get; set; } = new();
}

public class AccountOverride
{
    public string EmpId { get; set; } = string.Empty;
    public string RoleLevel { get; set; } = "user";
    public bool CanEditOthers { get; set; }
}

public class TestAccountsSettings
{
    public bool Enabled { get; set; }
    public List<TestAccountInfo> Accounts { get; set; } = new();
}

public class TestAccountInfo
{
    public string EmpId { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
    public string RoleLevel { get; set; } = "user";
    public string Name { get; set; } = string.Empty;
    public string Department { get; set; } = string.Empty;
    public bool CanEditOthers { get; set; }
}

public class LdapSettings
{
    public bool Enabled { get; set; }
    public string Server { get; set; } = string.Empty;
    public int Port { get; set; }
    public bool UseSsl { get; set; }
    public string BindDomain { get; set; } = string.Empty;
    public string SearchBase { get; set; } = string.Empty;
    public string UserPrincipalSuffix { get; set; } = string.Empty;
}
