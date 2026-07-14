namespace GenAI.Services.Interfaces;

public interface IMenuAuthService
{
    Task<bool> CanManageStructureAsync(string empId, string menuId, bool isAdmin);
    Task<bool> CanEditOrDeleteMenuAsync(string empId, string menuId, bool isAdmin);
    Task<bool> IsDelegatedAdminAsync(string empId, bool isAdmin);

    /// <summary>
    /// 算出指定 user 真正看得到哪些 MenuId — 用於後端過濾 GetInitialData / GetMenus 等 API，
    /// 避免一般 user 透過 API 拿到所有看板 URL / Apps / Roles mapping 等敏感資訊。
    ///
    /// 必須與 wwwroot/js/render/sidebar.js 的 renderSidebarMenus 演算法對齊：
    ///   1. allowedSet = ∪ role.allowedMenuIds  ∪ account.extraMenus
    ///   2. − account.denyMenus  (但 menu force-allow 可蓋過)
    ///   3. + menu ACL force-allow  (白名單命中)
    ///   4. − menu ACL deny  (黑名單包含 user，或白名單非空但 user 不在)
    ///   5. 展開子節點 (透過 Map_Menu_Structure 走 children；遇到 deny 不展開)
    ///
    /// admin 回 null 代表「不限制」，呼叫端不必過濾。
    /// </summary>
    Task<HashSet<string>?> GetVisibleMenuIdsAsync(string empId, bool isAdmin);
}
