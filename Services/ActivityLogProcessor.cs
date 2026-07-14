using GenAI.Data;
using GenAI.Models;

namespace GenAI.Services;

public class ActivityLogProcessor : BackgroundService
{
    private readonly IActivityLogQueue _queue;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<ActivityLogProcessor> _logger;

    // 一次最多 drain 這麼多筆湊成一批做單次 SaveChanges。
    //   太大 → 單筆毒資料會牽連整批、且交易過大；太小 → 批次效益低。100 對小型稽核量已足夠。
    private const int MaxBatchSize = 100;

    public ActivityLogProcessor(IActivityLogQueue queue, IServiceScopeFactory scopeFactory, ILogger<ActivityLogProcessor> logger)
    {
        _queue = queue;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                // 先阻塞等第一筆（沒資料時不空轉、不浪費 CPU）。
                var first = await _queue.DequeueAsync(stoppingToken);

                // E4：再非阻塞 drain 出當下佇列裡其餘的紀錄，湊成一批 → 單次 SaveChanges。
                //     取代原本「每筆一次 SaveChanges」的 round-trip 寫放大；尖峰時收斂效果最明顯。
                var batch = new List<UserActivityLog>(MaxBatchSize) { first };
                while (batch.Count < MaxBatchSize && _queue.TryDequeue(out var next) && next != null)
                {
                    batch.Add(next);
                }

                await SaveBatchAsync(batch, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                // 停機 token 取消 → 正常結束，不視為錯誤、不拋例外
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Activity Log 背景批次處理發生未預期錯誤");
            }
        }
    }

    // 批次寫入；單批失敗時退回「逐筆寫」，避免一筆毒資料拖垮整批稽核紀錄。
    private async Task SaveBatchAsync(List<UserActivityLog> batch, CancellationToken stoppingToken)
    {
        foreach (var log in batch)
            if (log.Timestamp == default) log.Timestamp = DateTime.UtcNow;

        try
        {
            using var scope = _scopeFactory.CreateScope();
            var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            context.UserActivityLogs.AddRange(batch);
            await context.SaveChangesAsync(stoppingToken);
        }
        catch (OperationCanceledException)
        {
            throw; // 停機 → 交給外層處理，不要走逐筆退避（那只會再次 OCE）
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Activity Log 批次寫入失敗 ({Count} 筆)，改為逐筆重試以隔離毒資料", batch.Count);
            await SaveIndividuallyAsync(batch, stoppingToken);
        }
    }

    private async Task SaveIndividuallyAsync(List<UserActivityLog> batch, CancellationToken stoppingToken)
    {
        foreach (var log in batch)
        {
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                context.UserActivityLogs.Add(log);
                await context.SaveChangesAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Activity Log 單筆寫入失敗，已略過：{Action} {Path}", log.Action, log.Path);
            }
        }
    }
}
