using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace GenAI.Models;

/// <summary>
/// 網站每日/月份瀏覽彙總統計表 — 記錄每日各工號的不重複瀏覽人數 (UV) 與總瀏覽次數 (PV)。
/// </summary>
public class SiteVisitorDailyStat
{
    /// <summary>統計日期 (例如 2026-07-18)</summary>
    public DateOnly StatDate { get; set; }

    /// <summary>員工工號 (未登入者為 'ANONYMOUS')</summary>
    [MaxLength(50)]
    public string EmpId { get; set; } = null!;

    /// <summary>員工姓名快照</summary>
    [MaxLength(100)]
    public string? EmpName { get; set; }

    /// <summary>所屬部門快照</summary>
    [MaxLength(100)]
    public string? Department { get; set; }

    /// <summary>當日累計開啟/進站頁面次數 (PV)</summary>
    public int PageViews { get; set; } = 1;

    /// <summary>當日第一次訪問時間</summary>
    public DateTime FirstVisitTime { get; set; }

    /// <summary>當日最後一次訪問時間</summary>
    public DateTime LastVisitTime { get; set; }
}
