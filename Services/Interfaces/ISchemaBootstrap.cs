namespace GenAI.Services.Interfaces;

/// <summary>
/// App 啟動時跑一次的 schema 自我修復：
///   - 補齊 Accounts.LoginCount / LastLoginTime 欄位
///   - 補齊 Map_Account_ExtraMenu / Map_Account_DenyMenu 兩張覆寫表
///   - 把 appsettings.Auth.TestAccounts 中尚未存在於 Accounts 表的工號自動 upsert 進去
///       (讓 admin 可以從 UI 直接設定那些測試帳號的角色 / 委派 / 默認頁面)
/// </summary>
public interface ISchemaBootstrap
{
    Task RunAsync();
}
