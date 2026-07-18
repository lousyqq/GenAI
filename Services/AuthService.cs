using System.DirectoryServices.Protocols;
using System.Net;
using GenAI.Data;
using GenAI.Models;
using GenAI.Models.Settings;
using GenAI.Services.Interfaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace GenAI.Services;

public class AuthService : IAuthService
{
    private readonly AppDbContext _context;
    private readonly AuthSettings _authSettings;
    private readonly ILogger<AuthService> _logger;

    public AuthService(AppDbContext context, IOptionsSnapshot<AuthSettings> authOptions, ILogger<AuthService> logger)
    {
        _context = context;
        _authSettings = authOptions.Value;
        _logger = logger;
    }

    public string? ExtractEmpIdFromWindowsIdentity(string? identityName)
    {
        if (string.IsNullOrWhiteSpace(identityName)) return null;

        var empId = identityName.Trim();
        var slashIdx = empId.LastIndexOf('\\');
        if (slashIdx >= 0 && slashIdx < empId.Length - 1)
        {
            empId = empId[(slashIdx + 1)..].Trim();
        }

        var atIdx = empId.IndexOf('@');
        if (atIdx > 0)
        {
            empId = empId[..atIdx].Trim();
        }

        return string.IsNullOrWhiteSpace(empId) ? null : empId;
    }

    public Task<(bool success, string? errorMessage)> VerifyLdapPasswordAsync(string empId, string password)
    {
        // LDAP bind 是同步 API，包成 Task.Run 以避免阻塞執行緒池。
        return Task.Run(() => VerifyLdapPasswordCore(empId, password));
    }

    private (bool success, string? errorMessage) VerifyLdapPasswordCore(string empId, string password)
    {
        if (string.IsNullOrWhiteSpace(empId) || string.IsNullOrWhiteSpace(password))
            return (false, "工號或密碼為空");

        var ldapEnabled = _authSettings.Ldap.Enabled;
        if (!ldapEnabled)
        {
            _logger.LogWarning("LDAP 驗證未啟用，拒絕登入 (empId={EmpId})", empId);
            return (false, "LDAP 驗證未啟用");
        }

        var server = _authSettings.Ldap.Server;
        var port = _authSettings.Ldap.Port > 0 ? _authSettings.Ldap.Port : 389;
        var useSsl = _authSettings.Ldap.UseSsl;
        var bindDomain = _authSettings.Ldap.BindDomain ?? "";
        var upnSuffix = _authSettings.Ldap.UserPrincipalSuffix ?? "";

        if (string.IsNullOrWhiteSpace(server))
            return (false, "LDAP server 未配置");

        try
        {
            using var connection = new LdapConnection(new LdapDirectoryIdentifier(server, port));
            connection.SessionOptions.ProtocolVersion = 3;
            // 🛡️ 加入 Timeout 保護 (3秒)，避免 AD 無回應時導致 Thread Starvation
            connection.Timeout = new TimeSpan(0, 0, 3);

            if (useSsl)
            {
                connection.SessionOptions.SecureSocketLayer = true;
            }

            // 優先用 UPN (user@domain.com) bind，多數 AD 對 Kerberos/Negotiate 行得通；
            // 若沒設 UPN suffix 就退而求其次用 DOMAIN\user 的 NTLM 形式。
            var bindUser = !string.IsNullOrWhiteSpace(upnSuffix)
                ? empId + upnSuffix
                : (!string.IsNullOrWhiteSpace(bindDomain) ? $"{bindDomain}\\{empId}" : empId);

            connection.AuthType = AuthType.Negotiate;
            connection.Credential = new NetworkCredential(bindUser, password);

            // Bind 失敗會丟 LdapException → 我們攔截後回 false
            connection.Bind();

            _logger.LogInformation("LDAP bind 成功 (empId={EmpId})", empId);
            return (true, null);
        }
        catch (LdapException ex) when (ex.ErrorCode == 49)
        {
            // 49 = invalidCredentials
            return (false, "工號或密碼錯誤");
        }
        catch (LdapException ex)
        {
            _logger.LogWarning(ex, "LDAP bind 失敗 (empId={EmpId}, code={Code})", empId, ex.ErrorCode);
            return (false, $"AD 驗證失敗 (code={ex.ErrorCode})");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "LDAP 連線異常 (empId={EmpId})", empId);
            return (false, "AD 伺服器連線失敗，請稍後再試");
        }
    }

    public async Task<Account?> FindAccountAsync(string empId)
    {
        if (string.IsNullOrWhiteSpace(empId)) return null;
        var normalized = empId.Trim();
        var account = await _context.Accounts.FirstOrDefaultAsync(a => a.EmpId.ToLower() == normalized.ToLower());
        if (account != null && !string.Equals(account.EmpId, "admin", StringComparison.OrdinalIgnoreCase))
        {
            if (string.IsNullOrWhiteSpace(account.Department) || string.Equals(account.Name, account.EmpId, StringComparison.OrdinalIgnoreCase))
            {
                var (found, personName, personDept) = await ResolvePersonInfoAsync(account.EmpId);
                if (found && (account.Name != personName || account.Department != personDept))
                {
                    account.Name = personName;
                    account.Department = personDept;
                    await _context.SaveChangesAsync();
                    _logger.LogInformation("FindAccountAsync: 自動由 [WEB].[dbo].[notes_person] 補齊帳號 {EmpId} 資訊 (姓名={Name}, 部門={Dept})", account.EmpId, account.Name, account.Department);
                }
            }
        }
        return account;
    }

    public (bool matched, Account? fallbackAccount) VerifyTestAccount(string empId, string password)
    {
        var enabled = _authSettings.TestAccounts.Enabled;
        if (!enabled) return (false, null);

        var accounts = _authSettings.TestAccounts.Accounts;
        if (accounts == null || accounts.Count == 0) return (false, null);

        foreach (var child in accounts)
        {
            var cfgEmpId = child.EmpId;
            var cfgPwd = child.Password;
            if (string.IsNullOrWhiteSpace(cfgEmpId) || cfgPwd == null) continue;

            if (!string.Equals(cfgEmpId, empId, StringComparison.OrdinalIgnoreCase)) continue;
            // 密碼比對保留大小寫敏感（與 AD/LDAP 行為一致）
            if (!string.Equals(cfgPwd, password, StringComparison.Ordinal)) continue;

            // 命中：建一個 fallback skeleton，呼叫端若 DB 有這個工號會優先用 DB 那筆
            var fallback = new Account
            {
                EmpId = cfgEmpId,
                Name = child.Name ?? cfgEmpId,
                Department = child.Department ?? "測試環境",
                RoleLevel = child.RoleLevel ?? "user",
                CanEditOthers = child.CanEditOthers
            };
            _logger.LogInformation("TestAccount 命中 (empId={EmpId})", cfgEmpId);
            return (true, fallback);
        }

        return (false, null);
    }

    public async Task<(bool found, string name, string department)> ResolvePersonInfoAsync(string empId)
    {
        if (string.IsNullOrWhiteSpace(empId)) return (false, empId ?? "", "");
        var cleanEmpId = empId.Trim();
        try
        {
            var conn = _context.Database.GetDbConnection();
            var wasOpen = conn.State == System.Data.ConnectionState.Open;
            if (!wasOpen) await conn.OpenAsync();
            try
            {
                using var cmd = conn.CreateCommand();
                cmd.CommandText = @"
SELECT TOP 1 NAME, DEPTNAME 
FROM [WEB].[dbo].[notes_person] 
WHERE EMPNO = @empId 
   OR (@isNumeric = 1 AND EMPNO LIKE '%' + @empId AND LEN(EMPNO) >= LEN(@empId))";
                var pEmp = cmd.CreateParameter();
                pEmp.ParameterName = "@empId";
                pEmp.Value = cleanEmpId;
                cmd.Parameters.Add(pEmp);

                var pNum = cmd.CreateParameter();
                pNum.ParameterName = "@isNumeric";
                pNum.Value = cleanEmpId.All(char.IsDigit) ? 1 : 0;
                cmd.Parameters.Add(pNum);

                using var reader = await cmd.ExecuteReaderAsync();
                if (await reader.ReadAsync())
                {
                    var name = reader["NAME"]?.ToString()?.Trim();
                    var dept = reader["DEPTNAME"]?.ToString()?.Trim();
                    if (!string.IsNullOrWhiteSpace(name))
                    {
                        return (true, name, dept ?? "");
                    }
                }
            }
            finally
            {
                if (!wasOpen) await conn.CloseAsync();
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "從 [WEB].[dbo].[notes_person] 查詢工號 {EmpId} 時發生異常", empId);
        }

        // 查詢時 DB 不存在此筆資料，則姓名維持登入帳號、部門維持空白
        return (false, cleanEmpId, "");
    }
}
