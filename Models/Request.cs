using System.ComponentModel.DataAnnotations;

namespace GenAI.Models;

public class Request
{
    [Key]
    [MaxLength(50)]
    public string RequestId { get; set; } = null!;
    public string? EmpId { get; set; }
    public string? EmpName { get; set; }
    public string? Reason { get; set; }
    public long? Timestamp { get; set; }
    public string? Status { get; set; }
    public string? WithdrawReason { get; set; }
    public string? Reply { get; set; }
    public string? ReqType { get; set; }
    public string? Fab { get; set; }
}
