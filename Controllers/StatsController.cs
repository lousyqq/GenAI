using System.Security.Claims;
using System.Text;
using GenAI.Data;
using GenAI.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace GenAI.Controllers;

[ApiController]
[Route("api/[controller]")]
public class StatsController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly ILogger<StatsController> _logger;

    public StatsController(AppDbContext dbContext, ILogger<StatsController> logger)
    {
        _dbContext = dbContext;
        _logger = logger;
    }

    /// <summary>
    /// 前端初始化或頁面進站時的輕量心跳打卡（Ping）
    /// 記錄今日該工號的 UV/PV 彙總資料。
    /// </summary>
    [HttpPost("Ping")]
    public async Task<IActionResult> Ping([FromBody] PingRequest? req)
    {
        try
        {
            // 工號**只信 Cookie Claim**，絕不採用 Request Body 的 EmpId —
            //   否則匿名請求可偽冒任意工號灌 PV、污染統計。未認證一律記 'ANONYMOUS'。
            string? claimEmpId = User.FindFirstValue(ClaimTypes.NameIdentifier)
                                 ?? User.FindFirst("empId")?.Value;
            bool isAuthenticated = !string.IsNullOrWhiteSpace(claimEmpId);
            string empId = isAuthenticated ? claimEmpId!.Trim() : "ANONYMOUS";

            // 以台灣工廠時間 UTC+8 作為「當日統計基準日」
            var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(8));
            var nowTime = DateTime.UtcNow.AddHours(8);

            // 使用主鍵查詢今日該工號是否已有一筆紀錄
            var stat = await _dbContext.SiteVisitorDailyStats.FindAsync(today, empId);

            if (stat != null)
            {
                stat.PageViews += 1;
                stat.LastVisitTime = nowTime;
            }
            else
            {
                // 若當天初次到訪，試圖從 Accounts 查詢姓名與部門快照。
                // Body 的 EmpName/Department 僅在已認證時採用（只會寫進自己當日那筆），匿名請求整包忽略。
                string? empName = isAuthenticated ? (req?.EmpName ?? User.FindFirstValue(ClaimTypes.Name)) : null;
                string? dept = isAuthenticated ? req?.Department : null;

                if (isAuthenticated && (string.IsNullOrEmpty(empName) || string.IsNullOrEmpty(dept)))
                {
                    var acc = await _dbContext.Accounts
                        .AsNoTracking()
                        .Where(a => a.EmpId == empId)
                        .Select(a => new { a.Name, a.Department })
                        .FirstOrDefaultAsync();

                    if (acc != null)
                    {
                        if (string.IsNullOrEmpty(empName)) empName = acc.Name;
                        if (string.IsNullOrEmpty(dept)) dept = acc.Department;
                    }
                }

                stat = new SiteVisitorDailyStat
                {
                    StatDate = today,
                    EmpId = empId,
                    EmpName = empName ?? (empId == "ANONYMOUS" ? "訪客" : empId),
                    Department = dept ?? "未分類/公用",
                    PageViews = 1,
                    FirstVisitTime = nowTime,
                    LastVisitTime = nowTime
                };

                _dbContext.SiteVisitorDailyStats.Add(stat);
            }

            await _dbContext.SaveChangesAsync();
            return Ok(new { success = true, pageViews = stat.PageViews, statDate = today.ToString("yyyy-MM-dd") });
        }
        catch (DbUpdateException dbEx)
        {
            // 若因為極短時間併發 Ping 導致重複主鍵衝突，進行一次優雅的 Update 嘗試
            _logger.LogWarning(dbEx, "Ping 發生併發主鍵衝突，重試更新 PV");
            try
            {
                var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(8));
                var empId = (User.FindFirstValue(ClaimTypes.NameIdentifier)
                             ?? User.FindFirst("empId")?.Value)?.Trim() ?? "ANONYMOUS";
                var existing = await _dbContext.SiteVisitorDailyStats.FindAsync(today, empId);
                if (existing != null)
                {
                    existing.PageViews += 1;
                    existing.LastVisitTime = DateTime.UtcNow.AddHours(8);
                    await _dbContext.SaveChangesAsync();
                }
            }
            catch (Exception exRetry)
            {
                _logger.LogWarning(exRetry, "Ping 重試亦失敗，不阻礙客戶端");
            }
            return Ok(new { success = true });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Stats/Ping 執行異常");
            // Ping 絕不中斷前端使用，出錯返回 Ok 或非阻斷狀態
            return Ok(new { success = false, message = ex.Message });
        }
    }

    /// <summary>
    /// 取得頂層 KPI 概況卡片資料（今日、本月、歷史總計）
    /// </summary>
    /// 統計儀表板僅 admin 可見（sidebar.js 以 role === 'admin' 顯示入口），API 端必須同步鎖 admin，
    /// 否則任何人可匿名直接呼叫取得全體同仁進站明細。
    [Authorize(Roles = "admin")]
    [HttpGet("Summary")]
    public async Task<IActionResult> GetSummary()
    {
        try
        {
            var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(8));
            var firstDayOfMonth = new DateOnly(today.Year, today.Month, 1);
            var lastDayOfMonth = firstDayOfMonth.AddMonths(1).AddDays(-1);

            // 今日統計
            var todayQuery = _dbContext.SiteVisitorDailyStats.AsNoTracking().Where(s => s.StatDate == today);
            int todayUv = await todayQuery.CountAsync();
            int todayPv = await todayQuery.SumAsync(s => (int?)s.PageViews) ?? 0;

            // 本月統計
            var monthQuery = _dbContext.SiteVisitorDailyStats.AsNoTracking()
                .Where(s => s.StatDate >= firstDayOfMonth && s.StatDate <= lastDayOfMonth);
            int monthUv = await monthQuery.Select(s => s.EmpId).Distinct().CountAsync();
            int monthPv = await monthQuery.SumAsync(s => (int?)s.PageViews) ?? 0;

            // 歷史累計總計
            var allQuery = _dbContext.SiteVisitorDailyStats.AsNoTracking();
            int totalUv = await allQuery.Select(s => s.EmpId).Distinct().CountAsync();
            int totalPv = await allQuery.SumAsync(s => (int?)s.PageViews) ?? 0;

            double avgViewsPerUser = monthUv > 0 ? Math.Round((double)monthPv / monthUv, 1) : 0;

            // 各部門本月使用占比 TOP 5
            var topDepts = await monthQuery
                .GroupBy(s => s.Department ?? "未分類/公用")
                .Select(g => new
                {
                    Department = g.Key,
                    Uv = g.Select(x => x.EmpId).Distinct().Count(),
                    Pv = g.Sum(x => x.PageViews)
                })
                .OrderByDescending(x => x.Uv)
                .Take(5)
                .ToListAsync();

            return Ok(new
            {
                success = true,
                today = new { uv = todayUv, pv = todayPv, date = today.ToString("yyyy-MM-dd") },
                thisMonth = new { uv = monthUv, pv = monthPv, avgViewsPerUser, yearMonth = today.ToString("yyyy-MM") },
                total = new { uv = totalUv, pv = totalPv },
                topDepartments = topDepts
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "取得統計摘要 Summary 失敗");
            return StatusCode(500, new { success = false, message = "取得統計摘要失敗：" + ex.Message });
        }
    }

    /// <summary>
    /// 查詢指定月份內「按日 (Daily)」走勢與細節清單
    /// </summary>
    [Authorize(Roles = "admin")]
    [HttpGet("Daily")]
    public async Task<IActionResult> GetDailyStats([FromQuery] int year = 0, [FromQuery] int month = 0)
    {
        try
        {
            var now = DateTime.UtcNow.AddHours(8);
            if (year <= 0) year = now.Year;
            if (month <= 0 || month > 12) month = now.Month;

            var firstDay = new DateOnly(year, month, 1);
            var lastDay = firstDay.AddMonths(1).AddDays(-1);

            // 每日 UV/PV 趨勢列表
            var trend = await _dbContext.SiteVisitorDailyStats
                .AsNoTracking()
                .Where(s => s.StatDate >= firstDay && s.StatDate <= lastDay)
                .GroupBy(s => s.StatDate)
                .Select(g => new
                {
                    date = g.Key,
                    uv = g.Count(),
                    pv = g.Sum(x => x.PageViews)
                })
                .OrderBy(x => x.date)
                .ToListAsync();

            var formattedTrend = trend.Select(t => new
            {
                date = t.date.ToString("yyyy-MM-dd"),
                uv = t.uv,
                pv = t.pv
            }).ToList();

            // 當月詳細進站人次「全量」列表 — 前端 dtStatsDetail (DataTables) 做純前端分頁與搜尋，
            //   後端不可截斷（曾 Take(50) 導致第 51 筆之後看不到）。
            //   若日後單月紀錄超過約一萬筆造成傳輸/渲染變慢，再評估改 server-side paged 查詢。
            var details = await _dbContext.SiteVisitorDailyStats
                .AsNoTracking()
                .Where(s => s.StatDate >= firstDay && s.StatDate <= lastDay)
                .OrderByDescending(s => s.StatDate)
                .ThenByDescending(s => s.PageViews)
                .Select(s => new
                {
                    statDate = s.StatDate.ToString("yyyy-MM-dd"),
                    empId = s.EmpId,
                    empName = s.EmpName ?? s.EmpId,
                    department = s.Department ?? "未分類/公用",
                    pageViews = s.PageViews,
                    firstVisit = s.FirstVisitTime.ToString("HH:mm:ss"),
                    lastVisit = s.LastVisitTime.ToString("HH:mm:ss")
                })
                .ToListAsync();

            return Ok(new
            {
                success = true,
                year,
                month,
                trend = formattedTrend,
                details
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "查詢每日統計 Daily 失敗");
            return StatusCode(500, new { success = false, message = "查詢每日統計失敗：" + ex.Message });
        }
    }

    /// <summary>
    /// 查詢指定年度內「按月份 (Monthly)」走勢清單
    /// </summary>
    [Authorize(Roles = "admin")]
    [HttpGet("Monthly")]
    public async Task<IActionResult> GetMonthlyStats([FromQuery] int year = 0)
    {
        try
        {
            var now = DateTime.UtcNow.AddHours(8);
            if (year <= 0) year = now.Year;

            var firstDay = new DateOnly(year, 1, 1);
            var lastDay = new DateOnly(year, 12, 31);

            // 先在 SQL 端以 (月份, 工號) 分組加總，只拉回縮減後的彙總列（月數 × 人數），
            //   不再把整年原始明細全部載入記憶體。UV (distinct 工號數) 於客端由已分組結果計數。
            var monthlyAgg = await _dbContext.SiteVisitorDailyStats
                .AsNoTracking()
                .Where(s => s.StatDate >= firstDay && s.StatDate <= lastDay)
                .GroupBy(s => new { s.StatDate.Month, s.EmpId })
                .Select(g => new { g.Key.Month, g.Key.EmpId, Pv = g.Sum(x => x.PageViews) })
                .ToListAsync();

            var monthly = monthlyAgg
                .GroupBy(x => x.Month)
                .Select(g => new
                {
                    month = g.Key,
                    monthLabel = $"{year} 年 {g.Key:D2} 月",
                    uv = g.Count(),
                    pv = g.Sum(x => x.Pv)
                })
                .OrderBy(x => x.month)
                .ToList();

            return Ok(new
            {
                success = true,
                year,
                monthly
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "查詢月度統計 Monthly 失敗");
            return StatusCode(500, new { success = false, message = "查詢月度統計失敗：" + ex.Message });
        }
    }

    /// <summary>
    /// 匯出該月統計 CSV 報表
    /// </summary>
    [Authorize(Roles = "admin")]
    [HttpGet("Export")]
    public async Task<IActionResult> ExportStats([FromQuery] int year = 0, [FromQuery] int month = 0)
    {
        try
        {
            var now = DateTime.UtcNow.AddHours(8);
            if (year <= 0) year = now.Year;
            if (month <= 0 || month > 12) month = now.Month;

            var firstDay = new DateOnly(year, month, 1);
            var lastDay = firstDay.AddMonths(1).AddDays(-1);

            var list = await _dbContext.SiteVisitorDailyStats
                .AsNoTracking()
                .Where(s => s.StatDate >= firstDay && s.StatDate <= lastDay)
                .OrderByDescending(s => s.StatDate)
                .ThenByDescending(s => s.PageViews)
                .ToListAsync();

            var sb = new StringBuilder();
            sb.AppendLine("統計日期,員工工號,員工姓名,所屬部門,當日瀏覽次數,首次進入時間,最後進入時間");

            foreach (var item in list)
            {
                sb.AppendLine($"{item.StatDate:yyyy-MM-dd},{CsvField(item.EmpId)},{CsvField(item.EmpName ?? item.EmpId)},{CsvField(item.Department ?? "未分類")},{item.PageViews},{item.FirstVisitTime:yyyy-MM-dd HH:mm:ss},{item.LastVisitTime:yyyy-MM-dd HH:mm:ss}");
            }

            var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray();
            return File(bytes, "text/csv; charset=utf-8", $"GenAI_SiteStats_{year}_{month:D2}.csv");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "匯出 CSV 失敗");
            return StatusCode(500, new { success = false, message = "匯出失敗：" + ex.Message });
        }
    }

    /// <summary>
    /// CSV 欄位安全編碼：雙引號跳脫 (RFC 4180)，並在開頭為 = + - @ 時前置單引號，
    /// 防止 Excel 將儲存格內容當公式執行 (CSV Formula Injection)。
    /// </summary>
    private static string CsvField(string? value)
    {
        var v = value ?? "";
        if (v.Length > 0 && (v[0] == '=' || v[0] == '+' || v[0] == '-' || v[0] == '@'))
        {
            v = "'" + v;
        }
        return "\"" + v.Replace("\"", "\"\"") + "\"";
    }
}

public class PingRequest
{
    /// <summary>前端仍會送出此欄位，但後端一律忽略 — 身分只認 Cookie Claim，防偽冒。</summary>
    public string? EmpId { get; set; }
    public string? EmpName { get; set; }
    public string? Department { get; set; }
}
