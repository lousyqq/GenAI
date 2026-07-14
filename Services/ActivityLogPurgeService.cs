using GenAI.Services.Interfaces;

namespace GenAI.Services;

/// <summary>
/// UserActivityLogs 自動清理背景服務：每日刪除超過 ActivityLog:RetentionDays 天的稽核紀錄。
///
/// 設計重點：
/// - <c>RetentionDays &lt;= 0</c> 或缺少組態段 ＝ 停用自動清理（admin 仍可走 /api/ActivityLogs 手動清）。
/// - <see cref="IActivityLogger"/> 為 Scoped（內含 Scoped 的 AppDbContext），故每次清理都自建 scope 解析，
///   不可在建構式注入（會把 Scoped 服務釘進 Singleton background service → 抓不到 / captive dependency）。
/// - <c>PurgeOlderThanAsync</c> 走 <c>ExecuteDeleteAsync</c>（不經 ChangeTracker），故不會觸發
///   CacheInvalidationInterceptor；而 UserActivityLog 本就不在 InitialData 快取範圍 → 無須手動 Invalidate。
/// - 啟動後先等 InitialDelay 再開始，避免與啟動時的 SchemaBootstrap / 遷移搶資源。
/// </summary>
public class ActivityLogPurgeService : BackgroundService
{
    private static readonly TimeSpan InitialDelay = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan Interval = TimeSpan.FromHours(24);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<ActivityLogPurgeService> _logger;

    public ActivityLogPurgeService(IServiceScopeFactory scopeFactory, IConfiguration config, ILogger<ActivityLogPurgeService> logger)
    {
        _scopeFactory = scopeFactory;
        _config = config;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(InitialDelay, stoppingToken);

            while (!stoppingToken.IsCancellationRequested)
            {
                // 每輪都重讀組態，使用者改 appsettings 後不必重啟即可調整保留天數（reloadOnChange）。
                var days = _config.GetValue<int>("ActivityLog:RetentionDays", 0);
                if (days > 0)
                {
                    try
                    {
                        using var scope = _scopeFactory.CreateScope();
                        var logger = scope.ServiceProvider.GetRequiredService<IActivityLogger>();
                        var deleted = await logger.PurgeOlderThanAsync(days);
                        if (deleted > 0)
                            _logger.LogInformation("操作紀錄自動清理：刪除 {Deleted} 筆超過 {Days} 天的紀錄", deleted, days);
                    }
                    catch (Exception ex)
                    {
                        // 單次失敗不終結服務 → 24 小時後自然重試。
                        _logger.LogError(ex, "操作紀錄自動清理失敗（24 小時後重試）");
                    }
                }

                await Task.Delay(Interval, stoppingToken);
            }
        }
        catch (OperationCanceledException)
        {
            // 停機 token 取消 → 正常結束，不視為錯誤。
        }
    }
}
