using System.Threading.Channels;
using GenAI.Models;

namespace GenAI.Services;

public interface IActivityLogQueue
{
    ValueTask QueueLogAsync(UserActivityLog log);
    ValueTask<UserActivityLog> DequeueAsync(CancellationToken cancellationToken);

    // E4 批次寫入用：非阻塞地再多取一筆。Processor 先 DequeueAsync 等到第一筆，
    //   再用此方法把當下佇列裡剩餘的紀錄 drain 成一批，做單次 SaveChanges（降低寫放大）。
    bool TryDequeue(out UserActivityLog? log);
}

public class ActivityLogQueue : IActivityLogQueue
{
    private const int Capacity = 1000;
    private readonly Channel<UserActivityLog> _queue;
    private readonly ILogger<ActivityLogQueue> _logger;

    public ActivityLogQueue(ILogger<ActivityLogQueue> logger)
    {
        _logger = logger;

        // B1：FullMode 從 DropOldest 改成 Wait。
        //   原本 DropOldest 會在佇列滿時「靜默丟掉最舊的稽核記錄」—— 稽核資料被無聲蓋掉、事後完全查不出來。
        //   改 Wait + 下方 QueueLogAsync 用 TryWrite（非阻塞）：
        //     - 佇列未滿 → 正常入列。
        //     - 佇列已滿 → TryWrite 回 false，記一筆 Warning 告警（讓維運知道「正在掉稽核」），
        //       而不是悄悄丟掉最舊那筆。仍不阻塞請求執行緒（稽核寫入不該拖慢使用者請求）。
        var options = new BoundedChannelOptions(Capacity)
        {
            FullMode = BoundedChannelFullMode.Wait
        };
        _queue = Channel.CreateBounded<UserActivityLog>(options);
    }

    public ValueTask QueueLogAsync(UserActivityLog log)
    {
        // 非阻塞寫入：滿載時不丟舊資料、改記 Warning 告警。
        //   刻意不用 WriteAsync —— 它在滿載時會 await 卡住，反而把背壓傳回請求路徑、拖慢使用者。
        if (!_queue.Writer.TryWrite(log))
        {
            _logger.LogWarning(
                "稽核佇列已滿 (容量 {Capacity})，本筆操作紀錄未寫入：{Action} {Path}。" +
                "代表背景寫入跟不上產生速度，請檢查 DB 寫入效能或調高容量。",
                Capacity, log.Action, log.Path);
        }
        return ValueTask.CompletedTask;
    }

    public async ValueTask<UserActivityLog> DequeueAsync(CancellationToken cancellationToken)
    {
        return await _queue.Reader.ReadAsync(cancellationToken);
    }

    public bool TryDequeue(out UserActivityLog? log)
    {
        return _queue.Reader.TryRead(out log);
    }
}
