using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using System.Threading.RateLimiting;
using GenAI.Data;
using GenAI.Middleware;
using GenAI.Services;
using GenAI.Services.Interfaces;
using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerGen;
using Serilog;
using GenAI.Models.Settings;
using System.Net;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;

var builder = WebApplication.CreateBuilder(args);

// === 設定 Serilog 實體檔案日誌 ===
builder.Host.UseSerilog((context, services, configuration) => configuration
    .ReadFrom.Configuration(context.Configuration)
    .Enrich.FromLogContext()
    // ⚠️ Serilog 只讀「Serilog」組態區段（本專案 appsettings 沒有），Logging:LogLevel 那段對它無效 —
    //    不壓低 Microsoft.* 的話，每個 request（Microsoft.AspNetCore）與每條 EF SQL
    //    （Microsoft.EntityFrameworkCore）都會以 INF 寫進 logs/log-*.txt（純噪音＋磁碟 I/O）。
    //    app 自己的 log（GenAI.*、Program）維持 Information 不受影響。
    .MinimumLevel.Override("Microsoft.AspNetCore", Serilog.Events.LogEventLevel.Warning)
    .MinimumLevel.Override("Microsoft.EntityFrameworkCore", Serilog.Events.LogEventLevel.Warning)
    .WriteTo.Console()
    .WriteTo.File("logs/log-.txt", rollingInterval: RollingInterval.Day));

// === 部署模式判定 (HTTP / HTTPS) ===
//   Hosting:RequireHttps  → true 時強制 HTTPS（UseHttpsRedirection + Cookie Secure=Always）
//                         → false 時允許 HTTP（不 redirect + Cookie Secure=SameAsRequest）
//   預設值：Production = true (安全優先)；Development = false (本機跑 http://localhost)
//   IIS 部署在 HTTP 站點的情境：在 web.config / appsettings 設 Hosting:RequireHttps=false
//     否則 Cookie 帶 Secure flag → 瀏覽器在 HTTP 不會送回 → 每個 request 都被視為未登入。
var requireHttps = builder.Configuration.GetValue<bool?>("Hosting:RequireHttps")
    ?? !builder.Environment.IsDevelopment();

// 註冊 Anti-Forgery 服務 (防範 CSRF)
builder.Services.AddAntiforgery(options =>
{
    options.HeaderName = "X-CSRF-TOKEN";
    // 預設 CookieName 是 .AspNetCore.Antiforgery.xxx
});

// 加入控制器支援 (供 SettingsController API 使用)
builder.Services.AddControllersWithViews();

// === 回應壓縮 (Response Compression) ===
//   背景：/Settings/GetInitialData 一次回傳整包 appState（重複的 PascalCase 欄位鍵 + Menus/Apps 的
//        Base64 圖示），是純文字 JSON、壓縮率極高（常見 80~90% 縮減）。工廠看板很多時，這份 payload
//        是「資料多→變慢/卡」最直接的傳輸瓶頸。非 admin 的「列級過濾」已在 SettingsController 完成，
//        壓縮則同時讓 admin / 非 admin 的傳輸量大幅下降，且**零前端改動、無破壞風險**。
//   BREACH 風險評估：本站 CSRF 採「X-Requested-With 標頭檢查」(不在回應 body 內放反射式 token)，
//        GetInitialData 為已認證、無反射使用者輸入的 JSON → BREACH 風險低，故 EnableForHttps=true。
//   CPU：Sariel 記憶體吃緊 (6GB)，壓縮等級取 Fastest 以免吃 CPU；Brotli/Gzip Fastest 對 JSON 仍很有效。
builder.Services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
    options.Providers.Add<Microsoft.AspNetCore.ResponseCompression.BrotliCompressionProvider>();
    options.Providers.Add<Microsoft.AspNetCore.ResponseCompression.GzipCompressionProvider>();
    // 預設 MimeTypes 已含 application/json，但顯式補上 JSON 與 SVG 字型等以策完整。
    options.MimeTypes = Microsoft.AspNetCore.ResponseCompression.ResponseCompressionDefaults.MimeTypes
        .Concat(new[] { "application/json", "application/javascript", "text/json", "image/svg+xml" });
});
builder.Services.Configure<Microsoft.AspNetCore.ResponseCompression.BrotliCompressionProviderOptions>(o =>
    o.Level = System.IO.Compression.CompressionLevel.Fastest);
builder.Services.Configure<Microsoft.AspNetCore.ResponseCompression.GzipCompressionProviderOptions>(o =>
    o.Level = System.IO.Compression.CompressionLevel.Fastest);

// 註冊 Swagger API 文件
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo { Title = "GenAI API", Version = "v1" });
    // 自動在 Swagger UI 為 POST/PUT/DELETE 加入 CSRF 標頭
    c.OperationFilter<CsrfHeaderFilter>();
});

// 註冊快取服務
builder.Services.AddMemoryCache();

// === Data Protection Keys 持久化 ===
//   ASP.NET Core 用 Data Protection 加密 cookie、antiforgery token 等。
//   預設 keys 存在 user profile (本機 dev) 或記憶體 (IIS w/o user profile)。
//   IIS App Pool 預設「不載入使用者設定檔」→ keys 只存在記憶體 → 每次 App Pool
//   回收、重啟、IIS 重起 → 所有 cookie 失效，全部 user 被踢出來重登。
//   解法：固定存到磁碟特定目錄 (App_Data/keys)，並用 SetApplicationName 隔離不同 app。
//   目錄需要 App Pool 身份可讀寫。位置可用 Hosting:DataProtectionKeysPath 覆寫。
var dpKeysPath = builder.Configuration["Hosting:DataProtectionKeysPath"]
    ?? Path.Combine(builder.Environment.ContentRootPath, "App_Data", "keys");
try { Directory.CreateDirectory(dpKeysPath); } catch { /* 權限不足時退回預設 */ }
builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(dpKeysPath))
    .SetApplicationName("GenAI");

// === InitialData 快取作廢：Singleton 事實來源 + EF SaveChanges 攔截器 ===
//   IInitialDataCacheInvalidator 持有 IMemoryCache + ETag（原本散在 SettingsService 的 static 欄位）。
//   CacheInvalidationInterceptor 在 EF SaveChanges 成功後自動作廢「權限/設定相關」實體的快取，
//   消除「每個寫入端點都要記得手動 Invalidate」的 double load-bearing 地雷（見 CLAUDE.md §6.2）。
//   兩者皆為 Singleton，攔截器才能在 AddDbContext（非請求 scope）安全注入。
builder.Services.AddSingleton<IInitialDataCacheInvalidator, InitialDataCacheInvalidator>();
builder.Services.AddSingleton<CacheInvalidationInterceptor>();

// 註冊 AppDbContext（掛上快取作廢攔截器）
// ⚡ P3 優化：改用 AddDbContextPool — 重用 DbContext 實例（歸還時 EF 自動重設 ChangeTracker），
//    降低高併發下「每請求 new 一個 context」的配置/GC 壓力。
//    相容性已逐項驗證：
//      ① AppDbContext 建構子只吃 DbContextOptions<AppDbContext>、無注入 scoped 服務、無可變實例狀態（僅 DbSets）。
//      ② CacheInvalidationInterceptor 為 Singleton（依賴亦 Singleton）→ pool 一次性建好 options 即可安全共用；
//         其 ConditionalWeakTable 以 context 實例為 key，且每次 SaveChanges 內「Mark→Flush/Discard」成對完成、
//         不跨請求殘留，故對「實例被 pool 重用」安全。
//      ③ 全程無 SetCommandTimeout / ChangeTracker / QueryTrackingBehavior 等 per-instance 設定變動（pooling 不會重設這些）。
//    poolSize 用預設（1024）。
builder.Services.AddDbContextPool<AppDbContext>((sp, options) =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("GenAI"),
        sqlOptions => sqlOptions.EnableRetryOnFailure(
            maxRetryCount: 5,
            maxRetryDelay: TimeSpan.FromSeconds(30),
            errorNumbersToAdd: null))
    .AddInterceptors(sp.GetRequiredService<CacheInvalidationInterceptor>()));

// 註冊 Service 層（DI 依賴注入）
builder.Services.Configure<AuthSettings>(builder.Configuration.GetSection("Auth"));
// 健康檢查：SqlServer 檢查標記 "ready"，只給 readiness 端點用（liveness 不碰 DB）
builder.Services.AddHealthChecks()
    .AddSqlServer(builder.Configuration.GetConnectionString("GenAI") ?? "", tags: new[] { "ready" });

builder.Services.AddScoped<ISettingsService, SettingsService>();
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<ISchemaBootstrap, SchemaBootstrap>();
builder.Services.AddScoped<IAccountService, AccountService>();
builder.Services.AddScoped<IMenuService, MenuService>();
builder.Services.AddScoped<IMenuAuthService, MenuAuthService>();
builder.Services.AddScoped<IIconStorageService, IconStorageService>();
builder.Services.AddScoped<IActivityLogger, ActivityLogger>();
builder.Services.AddSingleton<IActivityLogQueue, ActivityLogQueue>();
builder.Services.AddHostedService<ActivityLogProcessor>();
// UserActivityLogs 每日自動清理（保留天數讀 ActivityLog:RetentionDays，<=0 停用）。
builder.Services.AddHostedService<ActivityLogPurgeService>();
// === 身份驗證：Cookies (主) + Negotiate (Windows 自動偵測) ===
// 預設 scheme 仍是 Cookies — 一般 API/頁面靠它識別；
// Negotiate 只在 /api/Auth/WhoAmI 時被瀏覽器以 401 → WWW-Authenticate: Negotiate 觸發。
builder.Services
    .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "GenAI.Auth";
        options.ExpireTimeSpan = TimeSpan.FromHours(12);
        options.SlidingExpiration = true;
        // ⭐️ 安全強化：Cookie 安全設定
        options.Cookie.SameSite = SameSiteMode.Lax;    // 防止 CSRF 跨站請求偽造
        options.Cookie.HttpOnly = true;                 // 防止 JS 讀取 Cookie (XSS 防護)
        // Round-3 P1 #5 + IIS HTTP 部署修正：
        //   - requireHttps=true  → Always   (HTTPS 強制；Production 預設)
        //   - requireHttps=false → SameAsRequest (允許 HTTP；IIS 內網 HTTP 站台、Dev 本機)
        //   不能無條件 Always — 否則 HTTP 環境下 cookie 不會送回、登入完全壞掉。
        options.Cookie.SecurePolicy = requireHttps
            ? CookieSecurePolicy.Always
            : CookieSecurePolicy.SameAsRequest;
        options.Events.OnValidatePrincipal = async context =>
        {
            var empId = context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
            if (!string.IsNullOrWhiteSpace(empId))
            {
                var authSetForSim = context.HttpContext.RequestServices.GetService<Microsoft.Extensions.Options.IOptionsSnapshot<AuthSettings>>()?.Value;
                if (!string.IsNullOrWhiteSpace(authSetForSim?.SimulatedWindowsAccount))
                {
                    var authSvc = context.HttpContext.RequestServices.GetService<IAuthService>();
                    var expectedEmpId = authSvc?.ExtractEmpIdFromWindowsIdentity(authSetForSim.SimulatedWindowsAccount);
                    if (!string.IsNullOrWhiteSpace(expectedEmpId) && !string.Equals(empId, expectedEmpId, StringComparison.OrdinalIgnoreCase))
                    {
                        context.RejectPrincipal();
                        await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                        return;
                    }
                }

                var loginSource = context.Principal?.FindFirstValue("LoginSource") ?? "windows";
                var isTestOrEmergency = string.Equals(loginSource, "test", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(loginSource, "emergency", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(empId, "admin", StringComparison.OrdinalIgnoreCase);

                var db = context.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
                // 不可用 .ToLower() 比對 — 會轉成 SQL 的 LOWER(EmpId) 使索引失效（本事件每個請求都執行）。
                // SQL Server 預設 CI 定序本身即不分大小寫，直接等值比對即可走索引 seek。
                var account = await db.Accounts.AsNoTracking().FirstOrDefaultAsync(a => a.EmpId == empId.Trim());
                if (account == null)
                {
                    // 若是 TestAccounts / EmergencyAdmin (例如 admin)，因其僅存在記憶體或設定檔中，不在 DB Accounts 表，絕對不可 RejectPrincipal
                    if (isTestOrEmergency)
                    {
                        var authSet = context.HttpContext.RequestServices.GetService<Microsoft.Extensions.Options.IOptionsSnapshot<AuthSettings>>()?.Value;
                        var overrideRole = authSet?.AccountOverrides?.FirstOrDefault(o => string.Equals(o.EmpId, empId, StringComparison.OrdinalIgnoreCase))?.RoleLevel;
                        if (!string.IsNullOrWhiteSpace(overrideRole))
                        {
                            var currentRole = (context.Principal?.FindFirstValue(ClaimTypes.Role) ?? "").ToLower();
                            if (!string.Equals(currentRole, overrideRole.ToLower(), StringComparison.OrdinalIgnoreCase))
                            {
                                var testClaims = new List<Claim>
                                {
                                    new(ClaimTypes.NameIdentifier, empId),
                                    new(ClaimTypes.Name, context.Principal?.FindFirstValue(ClaimTypes.Name) ?? empId),
                                    new(ClaimTypes.Role, overrideRole.ToLower()),
                                    new("LoginSource", loginSource)
                                };
                                context.ReplacePrincipal(new ClaimsPrincipal(new ClaimsIdentity(testClaims, CookieAuthenticationDefaults.AuthenticationScheme)));
                                context.ShouldRenew = true;
                            }
                        }
                        return;
                    }

                    context.RejectPrincipal();
                    await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                    return;
                }

                var authSettings = context.HttpContext.RequestServices.GetService<Microsoft.Extensions.Options.IOptionsSnapshot<AuthSettings>>()?.Value;
                var ovr = authSettings?.AccountOverrides?.FirstOrDefault(o => string.Equals(o.EmpId, account.EmpId, StringComparison.OrdinalIgnoreCase));
                var effectiveRole = ovr != null && !string.IsNullOrWhiteSpace(ovr.RoleLevel) ? ovr.RoleLevel.ToLower() : (account.RoleLevel ?? "user").ToLower();

                var cookieRole = (context.Principal?.FindFirstValue(ClaimTypes.Role) ?? "").ToLower();
                if (!string.Equals(cookieRole, effectiveRole, StringComparison.OrdinalIgnoreCase))
                {
                    var claims = new List<Claim>
                    {
                        new(ClaimTypes.NameIdentifier, account.EmpId),
                        new(ClaimTypes.Name, account.Name ?? account.EmpId),
                        new(ClaimTypes.Role, effectiveRole),
                        new("LoginSource", loginSource)
                    };
                    var identity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
                    var newPrincipal = new ClaimsPrincipal(identity);
                    context.ReplacePrincipal(newPrincipal);
                    context.ShouldRenew = true;
                }
            }
        };
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = 401;
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = context =>
        {
            context.Response.StatusCode = 403;
            return Task.CompletedTask;
        };
    });

if (builder.Configuration["Auth:DisableNegotiate"] != "true")
{
    builder.Services.AddAuthentication().AddNegotiate();
}

builder.Services.AddAuthorization(options =>
{
    // 預設不強制要求認證 — 保留與舊行為相容，每支 Controller/Action 個別決定。
    options.FallbackPolicy = null;
});

// === Rate Limiting (Round-3 P1 #4) ===
// 對 /api/Auth/Login 加 IP 粒度的速率限制，阻止離線暴力破解 TestAccounts / LDAP 密碼。
//   - 每個 IP 60 秒內最多 10 次嘗試 (含成功)，超過回 429 Too Many Requests
//     （留少量緩衝給合法使用者打錯密碼；多數人走 Windows 自動登入，手動 LDAP 是 fallback）
//   - QueueLimit=0：超出直接 reject、不排隊，避免攻擊者 batch 灌入
//   - 真實上線環境若有反向代理 (Nginx/IIS ARR)，需確認 RemoteIpAddress 是真實 client IP
//     (一般需設 ForwardedHeadersOptions 處理 X-Forwarded-For，已有 UseHttpsRedirection 配合)
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("login-ip", context =>
    {
        var ip = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        return RateLimitPartition.GetFixedWindowLimiter(ip, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromSeconds(60),
            QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
            QueueLimit = 0,
            AutoReplenishment = true
        });
    });

    // 友善的拒絕回應 — 前端可以根據 Retry-After 提示使用者
    options.OnRejected = async (ctx, token) =>
    {
        ctx.HttpContext.Response.Headers["Retry-After"] = "60";
        ctx.HttpContext.Response.ContentType = "application/json";
        await ctx.HttpContext.Response.WriteAsync(
            "{\"success\":false,\"message\":\"嘗試次數過於頻繁，請等候 1 分鐘後再試。\"}", token);
    };
});

var app = builder.Build();

// === Schema bootstrap (idempotent；每次啟動跑一次) ===
// 自動建立缺失的覆寫表 + 種入 TestAccounts 中尚未存在的工號
using (var scope = app.Services.CreateScope())
{
    var bootstrap = scope.ServiceProvider.GetRequiredService<ISchemaBootstrap>();
    await bootstrap.RunAsync();

    // 一次性把 DB 中既有以 base64 儲存的 Menu/App icon 轉成實體檔（idempotent；轉完即 no-op）。
    // 失敗不擋啟動 —— 只記 log，舊 base64 icon 仍可被前端渲染。
    try
    {
        var iconStorage = scope.ServiceProvider.GetRequiredService<IIconStorageService>();
        await iconStorage.MigrateBase64IconsAsync();
    }
    catch (Exception ex)
    {
        var startupLogger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
        startupLogger.LogError(ex, "⚠️ base64 icon 一次性遷移失敗（不影響啟動，請手動檢查）");
    }
}

// === Production guard：啟動時驗證高風險設定 (Round-3 設定面 hardening) ===
//   非 Development 環境下，下列設定值若仍是「不安全的開發預設值」就直接拒絕啟動，
//   避免人為失誤把測試帳號 / placeholder LDAP / 緊急 admin 一路帶到正式環境。
//   Development 環境只 log warning、不擋啟動 (本機開發要保留 TestAccounts 才能離線測)。
{
    var logger = app.Services.GetRequiredService<ILogger<Program>>();
    var cfg = app.Configuration;
    var isProd = !app.Environment.IsDevelopment();

    var issues = new List<string>();

    if (cfg.GetValue<bool>("Auth:TestAccounts:Enabled"))
        issues.Add("Auth:TestAccounts:Enabled = true (測試帳號 admin/admin、user/user 等可直接登入)");
    if (cfg.GetValue<bool>("Auth:EnableEmergencyAdmin"))
        issues.Add("Auth:EnableEmergencyAdmin = true (admin 帳號可無密碼登入)");

    // LDAP placeholder：若 LDAP 已啟用，Server 必須是真實 hostname、不能是已知 placeholder
    if (cfg.GetValue<bool>("Auth:Ldap:Enabled"))
    {
        var server = cfg["Auth:Ldap:Server"] ?? "";
        var lower = server.ToLowerInvariant();
        bool isPlaceholder = string.IsNullOrWhiteSpace(server)
            || lower == "ldap.umc.com"
            || lower.Contains("replace")
            || lower.Contains("placeholder")
            || lower.Contains("todo")
            || lower.Contains("example");
        if (isPlaceholder)
            issues.Add($"Auth:Ldap:Server 仍是 placeholder \"{server}\"，請填實際 AD server");
    }

    // 連線字串明碼密碼：偵測 Password=test 之類弱密碼仍在 appsettings 內
    var connStr = cfg.GetConnectionString("GenAI") ?? "";
    if (connStr.Contains("Password=test", StringComparison.OrdinalIgnoreCase) ||
        connStr.Contains("Password=password", StringComparison.OrdinalIgnoreCase))
    {
        issues.Add("ConnectionStrings:GenAI 含弱密碼（請改用環境變數 ConnectionStrings__GenAI 或 User Secrets 注入）");
    }

    if (issues.Count > 0)
    {
        if (isProd)
        {
            logger.LogCritical("🚨 拒絕啟動：偵測到 {Count} 項不適合 Production 的設定值：\n  - {Issues}",
                issues.Count, string.Join("\n  - ", issues));
            throw new InvalidOperationException(
                "Production 環境偵測到不安全設定，已拒絕啟動。詳見 log。若確實要保留此設定，請改用 Development 環境執行。");
        }
        else
        {
            logger.LogWarning("⚠️ Development 環境偵測到 {Count} 項上線前需處理的設定：\n  - {Issues}",
                issues.Count, string.Join("\n  - ", issues));
        }
    }
}

// ⭐️ 全域例外處理：避免洩漏 Stack Trace 與內部路徑
app.UseExceptionHandler(errorApp =>
{
    errorApp.Run(async context =>
    {
        context.Response.StatusCode = 500;
        context.Response.ContentType = "application/json";
        await context.Response.WriteAsync(
            System.Text.Json.JsonSerializer.Serialize(new
            {
                success = false,
                message = "伺服器發生未預期的錯誤，請聯繫系統管理員。"
            }));
    });
});

// 只有 requireHttps=true 才強制 HTTPS 重新導向；否則 IIS 在 HTTP 上會吃到
// 「Failed to determine the https port for redirect」警告或產生 307 → 不可達的 https URL。
if (requireHttps)
{
    app.UseHttpsRedirection();
}

// ⭐️ 回應壓縮：放在靜態檔/路由之前，才能壓到 wwwroot 靜態檔與所有 controller 回應
//    （尤其 /Settings/GetInitialData 這份大 JSON）。須在 UseStaticFiles 之前註冊。
app.UseResponseCompression();

// ⭐️ 安全標頭中介軟體：防止點擊劫持、MIME 嗅探等攻擊。
//   ⚠️ CSRF 驗證已「下移」到 UseAuthentication / UseAuthorization 之後（見下方）。
//      原因：ASP.NET antiforgery token 綁定「登入者 claims 身分」，必須等 UseAuthentication
//      把 context.User 填好，才比對得起來。原本放在這裡（驗證階段 context.User 仍是匿名）
//      → 已登入者送來的「身分綁定 token」永遠對不上匿名 context → 一律 Invalid Token。
app.Use(async (context, next) =>
{
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["X-Frame-Options"] = "DENY";
    context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";

    // Content-Security-Policy：本專案 CDN（Bootstrap/FontAwesome/DataTables/jQuery/SheetJS）+ 大量
    //   inline onclick / style → script-src、style-src 必含 'unsafe-inline'；看板以 iframe 載入任意外部
    //   menu.url → frame-src 放寬 http:/https:；menu/app 圖示可為 data: 或外部 https 圖檔 → img-src 含
    //   data: https:。即使有 'unsafe-inline'，CSP 仍藉 source allowlist + object-src 'none' +
    //   base-uri 'self' + frame-ancestors 'none' + form-action 'self' 顯著縮小攻擊面。
    context.Response.Headers["Content-Security-Policy"] =
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://cdn.datatables.net https://code.jquery.com; " +
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://cdn.datatables.net; " +
        "img-src 'self' data: https:; " +
        "font-src 'self' data: https://cdnjs.cloudflare.com; " +
        "connect-src 'self'; " +
        "frame-src 'self' http: https:; " +
        "object-src 'none'; " +
        "base-uri 'self'; " +
        "frame-ancestors 'none'; " +
        "form-action 'self'";
    await next();
});

// ⭐️ 關鍵 1：設定預設檔案 (伺服器啟動時會自動去 wwwroot 尋找 index.html)
app.UseDefaultFiles();

// ⭐️ 關鍵 2：啟用靜態檔案 (依資產型別設定 Cache-Control)
// .reg（IE 協定客戶端安裝檔 /tools/install-ie-protocol.reg）不在預設 MIME 對照表 → 直接 404；
//   註冊為 text/plain 供下載。僅顯式加這一個副檔名、不開放 ServeUnknownFileTypes（避免誤伺服未知型別）。
var staticContentTypes = new Microsoft.AspNetCore.StaticFiles.FileExtensionContentTypeProvider();
staticContentTypes.Mappings[".reg"] = "text/plain";
app.UseStaticFiles(new StaticFileOptions
{
    ContentTypeProvider = staticContentTypes,
    OnPrepareResponse = ctx =>
    {
        var name = ctx.File.Name;
        // .js / .css / .html 採 no-cache：瀏覽器每次帶 If-None-Match / If-Modified-Since 重新驗證，
        // 未變更回 304（幾乎零成本）、一變更立即拿到新檔。
        // 根治「改完子模組仍需 Ctrl+F5」—— main.js 的 ES import 不帶版號，
        // 長快取會讓子模組最多卡 7 天才更新到使用者端。
        // ⚠️ .html 必須包含在 no-cache 清單：index.html 是整套 cache-bust 機制的「載體」
        //    （__APP_VER__ 與所有 ?v= 版本碼都寫在它裡面），若落入下方 7 天長快取，
        //    部署新版後使用者一般導航（非 F5）最多 7 天拿不到新版本碼 → ?v= 機制整個被架空
        //    （partials/modals.html 雖有 ?v= 救援，但 ?v= 的值同樣來自舊的 index.html）。
        if (name.EndsWith(".js", StringComparison.OrdinalIgnoreCase) ||
            name.EndsWith(".css", StringComparison.OrdinalIgnoreCase) ||
            name.EndsWith(".html", StringComparison.OrdinalIgnoreCase))
        {
            ctx.Context.Response.Headers.Append("Cache-Control", "no-cache");
        }
        else
        {
            // 圖片 / 字型 / favicon 等不常變動資產：保留 7 天長快取
            ctx.Context.Response.Headers.Append("Cache-Control", "public,max-age=604800");
        }
    }
});

// ⭐️ 關鍵 3：啟用 Swagger API 文件介面（僅限 Development，避免 IIS HTTP production 對外曝露 API 規格）
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(c => 
    {
        c.SwaggerEndpoint("/swagger/v1/swagger.json", "GenAI API v1");
        
        // 設定 Request 攔截器，強制 Swagger UI 送出時帶上 Windows 認證憑證 (NTLM) 與 Cookie
        c.UseRequestInterceptor("(req) => { req.credentials = 'include'; return req; }");
    });
}

app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();

// ⭐️ CSRF 防護（必須在 UseAuthentication / UseAuthorization 之後執行）：
//   antiforgery token 綁定登入者 claims 身分，需等 context.User 完成驗證後才能正確比對，
//   否則匿名 context 對上「已登入身分的 token」永遠失敗（Invalid Token）。
//   兩道防線：(1) X-Requested-With 自訂標頭（跨站請求無法偽造此標頭）；(2) antiforgery token。
//   /api/Auth/Login 例外（登入當下前端尚未取得 token）。
app.Use(async (context, next) =>
{
    var method = context.Request.Method;
    if ((method == "POST" || method == "PUT" || method == "DELETE") &&
        !context.Request.Path.StartsWithSegments("/api/Auth/Login", StringComparison.OrdinalIgnoreCase))
    {
        if (!context.Request.Headers.ContainsKey("X-Requested-With") ||
            context.Request.Headers["X-Requested-With"] != "XMLHttpRequest")
        {
            context.Response.StatusCode = 400;
            context.Response.ContentType = "application/json; charset=utf-8";
            await context.Response.WriteAsync("{\"success\":false,\"message\":\"CSRF validation failed: Missing X-Requested-With.\"}");
            return;
        }

        try
        {
            var antiforgery = context.RequestServices.GetRequiredService<Microsoft.AspNetCore.Antiforgery.IAntiforgery>();
            await antiforgery.ValidateRequestAsync(context);
        }
        catch (Microsoft.AspNetCore.Antiforgery.AntiforgeryValidationException)
        {
            context.Response.StatusCode = 400;
            context.Response.ContentType = "application/json; charset=utf-8";
            await context.Response.WriteAsync("{\"success\":false,\"message\":\"CSRF validation failed: Invalid Token.\"}");
            return;
        }
    }
    await next();
});

app.UseRateLimiter();  // 必須在 UseRouting 之後、MapControllerRoute 之前

// 操作紀錄 middleware — 放在 Authentication 之後才能拿到 User claim
app.UseMiddleware<ActivityLoggingMiddleware>();

// === IIS 子目錄部署自適應 ===
// 動態產生 /appbase.js — 前端載入後 window.APP_BASE 就拿到實際的 PathBase。
// 部署情境：
//   本機 dotnet run                     → APP_BASE = "/"
//   IIS 根目錄部署                       → APP_BASE = "/"
//   IIS 虛擬目錄 /GenAI_TEST       → APP_BASE = "/GenAI_TEST/"
//   IIS 多層虛擬目錄 /Apps/EQ/Dashboard  → APP_BASE = "/Apps/EQ/Dashboard/"
// 前端 api.js 的全域 fetch wrapper 會依此自動 prepend，所有現有 `fetch('/api/...')` 不用改一個字。
app.MapGet("/appbase.js", (HttpContext ctx) =>
{
    var basePath = ctx.Request.PathBase.HasValue ? ctx.Request.PathBase.Value : "";
    if (!basePath.EndsWith("/")) basePath += "/";
    // JSON.stringify 等效：用 System.Text.Json 序列化避免特殊字元造成 JS 注入
    var encoded = System.Text.Json.JsonSerializer.Serialize(basePath);
    var js = $"window.APP_BASE = {encoded};";
    // 不快取：若 deploy 路徑變動，瀏覽器舊快取會拿到錯誤 base 路徑
    ctx.Response.Headers["Cache-Control"] = "no-store, must-revalidate";
    ctx.Response.Headers["Pragma"] = "no-cache";
    return Results.Content(js, "application/javascript; charset=utf-8");
});

// === 健康檢查端點 ===
// /health（liveness）：純存活探測，Predicate=_=>false 代表「不跑任何檢查」，
//   只要進程能回應就回 200。對外公開無妨（不碰 DB、不洩漏內部狀態），
//   給 IIS/load balancer/監控做「進程是否活著」用。
app.MapHealthChecks("/health", new HealthCheckOptions
{
    Predicate = _ => false
});

// === 提供 CSRF Token 給前端 ===
app.MapGet("/api/Auth/CsrfToken", (Microsoft.AspNetCore.Antiforgery.IAntiforgery antiforgery, HttpContext context) =>
{
    var tokens = antiforgery.GetAndStoreTokens(context);
    return Results.Ok(new { token = tokens.RequestToken });
});

// /health/ready（readiness）：跑 "ready" 標記的檢查（含 SqlServer 連線）。
//   會實際打 DB，屬內部維運資訊 → 僅允許 loopback / 私有網段存取，
//   其餘來源一律 404（不回 403，避免暴露端點存在）。
app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("ready")
}).Add(builder =>
{
    var next = builder.RequestDelegate!;
    builder.RequestDelegate = async context =>
    {
        if (!IsTrustedHealthClient(context.Connection.RemoteIpAddress))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }
        await next(context);
    };
});

// 註冊 API 路由 (讓前端 fetch 能對應到 Controller/Action)
app.MapControllerRoute(
    name: "default",
    pattern: "{controller=Home}/{action=Index}/{id?}");

app.Run();

// === /health/ready 來源 IP 白名單判定 ===
// 只放行 loopback（127.0.0.1 / ::1）與私有網段（10/8、172.16/12、192.168/16），
// 其餘（含網際網路）視為不可信，讓 readiness 端點對外等同不存在。
static bool IsTrustedHealthClient(IPAddress? ip)
{
    if (ip is null) return false;

    // IPv4-mapped IPv6（如 ::ffff:10.0.0.5）先還原成 IPv4 再判斷
    if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();

    if (IPAddress.IsLoopback(ip)) return true;

    var b = ip.GetAddressBytes();
    if (b.Length == 4)
    {
        if (b[0] == 10) return true;                          // 10.0.0.0/8
        if (b[0] == 172 && b[1] >= 16 && b[1] <= 31) return true; // 172.16.0.0/12
        if (b[0] == 192 && b[1] == 168) return true;          // 192.168.0.0/16
    }
    return false;
}

// === Swagger CSRF 標頭自動產生器 ===
// 這會讓 Swagger UI 的 POST/PUT/DELETE API 自動出現一個必填的 X-Requested-With 欄位
public class CsrfHeaderFilter : IOperationFilter
{
    public void Apply(OpenApiOperation operation, OperationFilterContext context)
    {
        var method = context.ApiDescription.HttpMethod?.ToUpper();
        if (method == "POST" || method == "PUT" || method == "DELETE")
        {
            if (operation.Parameters == null)
                operation.Parameters = new List<OpenApiParameter>();

            operation.Parameters.Add(new OpenApiParameter
            {
                Name = "X-Requested-With",
                In = ParameterLocation.Header,
                Description = "CSRF 防護標頭 (必須為 XMLHttpRequest)",
                Required = true,
                Schema = new OpenApiSchema
                {
                    Type = "string",
                    Default = new Microsoft.OpenApi.Any.OpenApiString("XMLHttpRequest")
                }
            });
        }
    }
}

// ⚠️ 整合測試進入點：WebApplicationFactory<Program> 需要 Program 為 public partial 才抓得到 host 組態。
//    （GenAI.Tests 的 authz 矩陣測試依賴此宣告；勿刪。）
public partial class Program { }
