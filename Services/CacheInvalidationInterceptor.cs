using System.Runtime.CompilerServices;
using GenAI.Services.Interfaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GenAI.Services;

/// <summary>
/// EF Core SaveChanges 攔截器：當 DbContext 寫入「權限 / 設定相關」實體後，
/// 自動作廢 InitialData 快取並 bump ETag。
///
/// 目的：移除「每個寫入路徑都要記得手動呼叫 InvalidateInitialDataCache()」的脆弱性
///       （CLAUDE.md 標記為 double load-bearing 地雷）。即使開發者新增寫入端點時忘了手動呼叫，
///       此攔截器也會在 SaveChanges 成功後自動補上 —— 既有控制器的手動呼叫則保留為顯式意圖、與此並存（冪等無害）。
///
/// ⚠️ 僅對「走 EF Core SaveChanges」的寫入生效。raw ADO.NET 的
///    <c>SettingsService.SaveDataAsync</c>（Excel 全量覆寫）不經 SaveChanges，
///    仍須維持其原有的手動 Invalidate 呼叫；<c>SchemaBootstrap</c> 的 DDL 同理（啟動期、無需作廢）。
///
/// 機制（兩階段）：
///   1) <c>SavingChanges</c>：掃 ChangeTracker，決定本次「作廢層級」（0=無 / 1=volatile-only / 2=global），
///      暫存於 <see cref="ConditionalWeakTable{TKey,TValue}"/>（以 DbContext 實例為 key，多 scoped context 併發安全）。
///      必須在 save 前判斷 —— SaveChanges 後 Added/Modified 會被重設為 Unchanged、Deleted 變 Detached，屆時無從得知改了什麼。
///   2) <c>SavedChanges</c>（交易已 commit）：才真正作廢。若在 commit 前先清快取，會被其他請求用「尚未 commit 的舊資料」回填，
///      反而留下過期快取到 TTL 為止。失敗（<c>SaveChangesFailed</c>）則丟棄 pending 決策、不作廢。
///
/// 層級規則：
///   - <c>UserActivityLog</c>：忽略（高頻 audit 寫入，作廢等於關閉快取）。
///   - <c>PersonalSetting</c>：volatile-only（個人版面只在 volatile 快取，且不影響 menu 可見性）。
///   - 其餘所有受管實體（Menu/Fab/Role/Account/App/Request + 全部 Map_*）：global（清全域 + volatile + bump ETag）。
/// </summary>
public class CacheInvalidationInterceptor : SaveChangesInterceptor
{
    private readonly IInitialDataCacheInvalidator _invalidator;

    // 攜帶 SavingChanges→SavedChanges 之間的「作廢層級」決策。
    //   以 DbContext 實例為 key（弱引用，context 被 GC 後自動移除），值為 boxed int：1=volatile / 2=global。
    private static readonly ConditionalWeakTable<DbContext, object> _pending = new();

    // 層級分類（型別比對；entity 永不為 null）。
    private const int LevelNone = 0;
    private const int LevelVolatile = 1;
    private const int LevelGlobal = 2;

    private static bool IsIgnored(object entity) => entity is Models.UserActivityLog;
    private static bool IsVolatileOnly(object entity) => entity is Models.PersonalSetting;

    public CacheInvalidationInterceptor(IInitialDataCacheInvalidator invalidator)
    {
        _invalidator = invalidator;
    }

    private static void Mark(DbContext? context)
    {
        if (context == null) return;

        int level = LevelNone;
        foreach (var entry in context.ChangeTracker.Entries())
        {
            if (entry.State != EntityState.Added &&
                entry.State != EntityState.Modified &&
                entry.State != EntityState.Deleted)
                continue;

            var e = entry.Entity;
            if (IsIgnored(e)) continue;
            if (IsVolatileOnly(e)) { if (level < LevelVolatile) level = LevelVolatile; continue; }

            level = LevelGlobal;
            break; // 任一全域實體即可拍板，無需再掃
        }

        if (level > LevelNone)
            _pending.AddOrUpdate(context, level); // boxing int → object
    }

    private void Flush(DbContext? context)
    {
        if (context == null) return;
        if (!_pending.TryGetValue(context, out var boxed)) return;

        _pending.Remove(context);
        int level = (int)boxed;
        if (level >= LevelGlobal) _invalidator.Invalidate();
        else if (level == LevelVolatile) _invalidator.InvalidateVolatile();
    }

    private static void Discard(DbContext? context)
    {
        if (context != null) _pending.Remove(context);
    }

    public override InterceptionResult<int> SavingChanges(
        DbContextEventData eventData, InterceptionResult<int> result)
    {
        Mark(eventData.Context);
        return base.SavingChanges(eventData, result);
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData, InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        Mark(eventData.Context);
        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    public override int SavedChanges(SaveChangesCompletedEventData eventData, int result)
    {
        Flush(eventData.Context);
        return base.SavedChanges(eventData, result);
    }

    public override ValueTask<int> SavedChangesAsync(
        SaveChangesCompletedEventData eventData, int result,
        CancellationToken cancellationToken = default)
    {
        Flush(eventData.Context);
        return base.SavedChangesAsync(eventData, result, cancellationToken);
    }

    public override void SaveChangesFailed(DbContextErrorEventData eventData)
    {
        Discard(eventData.Context); // 未 commit → 不作廢
        base.SaveChangesFailed(eventData);
    }

    public override Task SaveChangesFailedAsync(
        DbContextErrorEventData eventData, CancellationToken cancellationToken = default)
    {
        Discard(eventData.Context);
        return base.SaveChangesFailedAsync(eventData, cancellationToken);
    }
}
