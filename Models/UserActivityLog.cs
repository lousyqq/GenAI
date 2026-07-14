using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace GenAI.Models;

/// <summary>
/// 使用者操作紀錄 — 對齊一般企業 audit log 規範。
/// 由 ActivityLoggingMiddleware 自動寫入；AuthController / 特殊 action 也會用 IActivityLogger 補明確紀錄。
/// 索引：(EmpId, Timestamp DESC) / (Timestamp DESC) / (Category, Timestamp DESC) 由 SchemaBootstrap 建立。
/// </summary>
public class UserActivityLog
{
    [Key]
    public long LogId { get; set; }

    /// <summary>UTC 時間戳</summary>
    public DateTime Timestamp { get; set; }

    /// <summary>登入者工號 (匿名/未登入請求為 NULL)</summary>
    [MaxLength(50)]
    public string? EmpId { get; set; }

    /// <summary>登入者姓名快照 (留檔避免 Account 改名後追溯困難)</summary>
    [MaxLength(100)]
    public string? EmpName { get; set; }

    /// <summary>登入來源：windows / manual / test / emergency</summary>
    [MaxLength(20)]
    public string? LoginSource { get; set; }

    /// <summary>用戶端 IP (IPv4/IPv6)</summary>
    [MaxLength(45)]
    public string? IpAddress { get; set; }

    /// <summary>User-Agent (上限 500，超出截斷)</summary>
    [MaxLength(500)]
    public string? UserAgent { get; set; }

    /// <summary>HTTP method：GET/POST/PUT/DELETE</summary>
    [MaxLength(10)]
    public string? HttpMethod { get; set; }

    /// <summary>請求 path (含 PathBase)</summary>
    [MaxLength(500)]
    public string? Path { get; set; }

    /// <summary>query string</summary>
    [MaxLength(500)]
    public string? QueryString { get; set; }

    /// <summary>回應狀態碼</summary>
    public int? StatusCode { get; set; }

    /// <summary>處理耗時 (ms)</summary>
    public int? DurationMs { get; set; }

    /// <summary>分類：Login / Logout / Auth / Menu / Account / Role / Fab / App / Request / PersonalSettings / Settings / Other</summary>
    [MaxLength(50)]
    public string? Category { get; set; }

    /// <summary>動作描述：LoginSuccess / LoginFail-WrongPassword / CreateMenu / DeleteAccount ...</summary>
    [MaxLength(100)]
    public string? Action { get; set; }

    /// <summary>受影響資源類型 (e.g. Menu / Account)；非 CRUD 操作可為 NULL</summary>
    [MaxLength(50)]
    public string? TargetType { get; set; }

    /// <summary>受影響資源 ID</summary>
    [MaxLength(100)]
    public string? TargetId { get; set; }

    /// <summary>額外細節 JSON (e.g. {"oldVal":"x","newVal":"y"})。⚠️ 不可含密碼/PII</summary>
    [Column(TypeName = "nvarchar(max)")]
    public string? Detail { get; set; }

    /// <summary>True = 操作成功；False = 失敗；NULL = 中性 (例如純查詢)</summary>
    public bool? IsSuccess { get; set; }

    /// <summary>失敗原因簡述</summary>
    [MaxLength(500)]
    public string? ErrorMessage { get; set; }
}
