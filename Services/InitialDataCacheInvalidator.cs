using GenAI.Services.Interfaces;
using Microsoft.Extensions.Caching.Memory;

namespace GenAI.Services;

/// <summary>
/// <see cref="IInitialDataCacheInvalidator"/> 的單例實作。
///
/// 持有 <see cref="IMemoryCache"/> 與全域 ETag。原本 ETag 是 <c>SettingsService</c>(Scoped) 上的
/// <c>private static</c> 欄位（靠 static 達成跨請求共享）；改放 Singleton 後語意相同、且能被
/// 不在請求 scope 內的 SaveChangesInterceptor 安全共用。ETag 以 <c>volatile</c> 欄位持有，
/// 確保不同執行緒讀到的是最新整體值（參考型別賦值本身為原子）。
/// </summary>
public class InitialDataCacheInvalidator : IInitialDataCacheInvalidator
{
    private readonly IMemoryCache _cache;
    private readonly ILogger<InitialDataCacheInvalidator> _logger;

    public string GlobalCacheKey => "InitialData_Global";
    public string VolatileCacheKey => "InitialData_Volatile";

    private volatile string _eTag = Guid.NewGuid().ToString("N");
    public string CurrentETag => _eTag;

    public InitialDataCacheInvalidator(IMemoryCache cache, ILogger<InitialDataCacheInvalidator> logger)
    {
        _cache = cache;
        _logger = logger;
    }

    public void Invalidate()
    {
        _cache.Remove(GlobalCacheKey);
        _cache.Remove(VolatileCacheKey);
        _eTag = Guid.NewGuid().ToString("N");
        _logger.LogInformation("InitialData global and volatile caches invalidated (ETag bumped).");
    }

    public void InvalidateVolatile()
    {
        _cache.Remove(VolatileCacheKey);
        _eTag = Guid.NewGuid().ToString("N");
        _logger.LogInformation("InitialData volatile cache invalidated (ETag bumped).");
    }
}
