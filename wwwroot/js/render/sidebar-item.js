// === render/sidebar-item.js - 選單項目產生器 ===
import { getFabs, t } from '../config.js?v=20260607k';
import { renderSidebarMenus } from './sidebar.js?v=20260607k';
import { customAlert } from '../ui/dialogs.js?v=20260607k';
import { changeLanguage, goDefaultHome } from '../ui/navigation.js?v=20260607k';
import { appState } from '../store.js?v=20260607k';


export function generateSidebarMenuItem(menu, allMenus, level, forceExpand = true) {
    if (!menu || !menu.id) return '';
    const subMenus = allMenus.filter(m => m.id !== menu.id && (window.isParentMatch(m.parentId, menu) || (m.parentIds || []).some(pid => window.isParentMatch(pid, menu))));
    subMenus.sort((a, b) => (a.parentOrders?.[menu.id] ?? a.order ?? 0) - (b.parentOrders?.[menu.id] ?? b.order ?? 0));
    const hasChildren = subMenus.length > 0;
    let isDescendant = false;
    if (hasChildren && appState.currentActiveSidebarMenuId && typeof window.localIsMenuDescendant === 'function') {
        isDescendant = window.localIsMenuDescendant(menu.id, appState.currentActiveSidebarMenuId, allMenus);
    }
    const isExpanded = forceExpand || isDescendant; // 這裡將會是 true

    let iconClass = menu.icon || 'far fa-file-alt';
    if (menu.menuMode === 'folder' && !menu.icon) iconClass = 'fas fa-folder';
    let iconHtml = `<i class="${window.escapeHTML(iconClass)} menu-icon ${menu.menuMode === 'folder' ? 'text-warning' : ''}"></i>`;
    // 圖片來源 = data: URI（剛上傳的預覽）或任何含 '/' 的路徑（/images/icons/... 實體檔、舊 icon/...、外部 URL）。
    // FontAwesome class（如 "fas fa-folder"）永不含 '/'，故以此區分圖片 vs FA。
    if (menu.icon && (menu.icon.startsWith('data:') || menu.icon.includes('/'))) {
        iconHtml = `<img src="${window.escapeHTML(menu.icon)}" class="custom-icon menu-icon" alt="icon">`;
    }

    const safeDomId = 'collapse_' + encodeURIComponent(String(menu.id)).replace(/%/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');

    // ⭐️ 核心修正：棄用 Bootstrap 原生觸發器，改用完全自己掌控的 onclick，絕對不卡死！
    let actionAttr = '';
    if (hasChildren) actionAttr = `onclick="window.toggleSubMenu(event, '${safeDomId}', this)"`;
    else if (menu.menuMode === 'app_grid') actionAttr = `data-action="activate-menu" data-id="${window.escapeHTML(menu.id)}"`;
    else if (menu.url) {
        if (menu.target === 'blank') actionAttr = `data-action="open-url" data-url="${window.escapeHTML(menu.url)}"`;
        else if (menu.target === 'ie') actionAttr = `data-action="open-ie" data-url="${window.escapeHTML(menu.url)}"`;
        else actionAttr = `data-action="activate-menu" data-id="${window.escapeHTML(menu.id)}"`;
    }
    else if (menu.targetPage) actionAttr = `data-action="activate-menu" data-id="${window.escapeHTML(menu.id)}"`;

    let dName = menu.displayName || menu.name || '未命名選單';
    if (typeof i18n !== 'undefined' && i18n[appState.currentLang] && i18n[appState.currentLang]['dyn_' + menu.id] && !menu.isEdited) {
        dName = i18n[appState.currentLang]['dyn_' + menu.id];
    }
    const safeDName = window.escapeHTML(dName);

    if (hasChildren) {
        const expClass = isExpanded ? 'show' : '';
        const ariaAttr = isExpanded ? 'true' : 'false';
        const collapsedClass = isExpanded ? '' : 'collapsed';
        let html = `<div class="menu-item ${collapsedClass}" ${actionAttr} title="${safeDName}" aria-expanded="${ariaAttr}" style="cursor:pointer;">
                        ${iconHtml}<span class="text-truncate">${safeDName}</span>
                        <i class="fas fa-chevron-right dropdown-arrow"></i>
                    </div>
                    <div class="collapse ${expClass}" id="${safeDomId}">
                        <div class="sub-menu-container">`;
        subMenus.forEach(child => html += generateSidebarMenuItem(child, allMenus, level + 1, forceExpand));
        html += `</div></div>`;
        return html;
    } else {
        const itemClass = level > 1 ? 'menu-item sub-item' : 'menu-item';
        return `<div class="${itemClass}" ${actionAttr} title="${safeDName}" style="cursor:pointer;">${iconHtml}<span class="text-truncate">${safeDName}</span></div>`;
    }
}

// ⭐️ 補回遺失的首頁儀表板渲染邏輯
window.renderHomeDashboard = function () {
    try {
        if (!appState.currentUser) return;
        const homeRole = document.getElementById('home-role-title');
        const homeRoleLvl = document.getElementById('home-role-level');
        if (homeRole) homeRole.innerText = appState.currentUser.roleLevel === 'admin' ? t('home_role_admin', '系統管理員') : t('home_role_user', '一般使用者');
        if (homeRoleLvl) homeRoleLvl.innerText = appState.currentUser.roleLevel === 'admin' ? '(Admin)' : '(User)';

        const fabs = getFabs();
        let currentFabObj = fabs.find(f => window.cleanId(f.fabName || f.FabName || f.id || f.fabId || f.FabId) === window.cleanId(appState.currentFab));
        let displayDName = currentFabObj ? (currentFabObj.displayName || currentFabObj.DisplayName || currentFabObj.fabName || currentFabObj.FabName) : appState.currentFab;

        const homeFab = document.getElementById('home-fab-display');
        if (homeFab) homeFab.innerText = displayDName;

        // 同步右上角頭像下拉的使用者資訊（對齊 TEST_20260429.html:2917-2930）
        if (typeof window.renderUserDropdown === 'function') window.renderUserDropdown();
    } catch (e) { console.error("renderHomeDashboard error", e); }
};

// 右上角使用者下拉資訊（姓名、部門、累積登入次數、本次登入時間、登入來源徽章）
window.renderUserDropdown = function () {
    if (!appState.currentUser) return;
    const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.innerText = txt; };
    const setHtml = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };

    // 登入來源徽章：Windows 自動 / 手動 / 測試 / 緊急
    const src = (appState.currentUser.loginSource || '').toLowerCase();
    let srcBadge = '';
    if (src === 'windows') srcBadge = ' <span class="badge bg-info text-white ms-1" style="font-size:0.6rem; vertical-align:middle;"><i class="fab fa-windows me-1"></i>' + t('login_src_windows', 'Windows') + '</span>';
    else if (src === 'manual') srcBadge = ' <span class="badge bg-secondary text-white ms-1" style="font-size:0.6rem; vertical-align:middle;"><i class="fas fa-key me-1"></i>' + t('login_src_manual', '手動') + '</span>';
    else if (src === 'test') srcBadge = ' <span class="badge bg-warning text-dark ms-1" style="font-size:0.6rem; vertical-align:middle;"><i class="fas fa-vial me-1"></i>' + t('login_src_test', '測試') + '</span>';
    else if (src === 'emergency') srcBadge = ' <span class="badge bg-danger text-white ms-1" style="font-size:0.6rem; vertical-align:middle;"><i class="fas fa-shield-alt me-1"></i>' + t('login_src_emergency', '緊急') + '</span>';

    setText('user-name', appState.currentUser.id || '');
    const loginCount = appState.currentUser.loginCount || 1;
    setHtml('user-role',
        t('login_count_prefix', '這是您第 ') + '<span style="color:#38bdf8; font-weight:800; font-size:0.75rem;">' + loginCount + '</span>' + t('login_count_suffix', ' 次登入'));

    setHtml('dropdown-user-name', (appState.currentUser.name || '') + ' (' + (appState.currentUser.id || '') + ')' + srcBadge);
    setText('dropdown-user-dept', appState.currentUser.department || t('dept_unknown', '未設定部門'));
    setText('dropdown-user-login-count', loginCount + ' ' + t('login_count_unit', '次'));
    let displayTime = appState.currentUser.currentLoginTime || '0000/00/00 00:00:00';
    if (appState.currentUser.lastLoginTime) {
        try {
            const dt = new Date(appState.currentUser.lastLoginTime);
            if (!isNaN(dt)) {
                const pad = (n) => n.toString().padStart(2, '0');
                displayTime = `${dt.getFullYear()}/${pad(dt.getMonth() + 1)}/${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
            }
        } catch (e) {}
    }
    setText('dropdown-user-login-time', displayTime);
};
// =========================================================================
// ⭐️ 無敵雙重容錯版：自動相容各種 HTML ID 命名，且直接讀取底層記憶體！
// =========================================================================
window.renderFabSwitcher = function () {
    // ⭐️ 核心修正 1：雙重 ID 尋找機制！不論您 HTML 裡面叫 dropdown 還是 switcher 都能抓到
    const fabMenu = document.getElementById('fab-dropdown-menu') || document.getElementById('fab-switcher-menu');
    const fabNameDisplay = document.getElementById('current-fab-name') || document.getElementById('current-fab-display');
    const homeFabDisplay = document.getElementById('home-fab-display');

    if (!fabMenu) {
        // 廠區切換 UI 已自 index.html 移除（本系統固定 12A）— 靜默略過
        return;
    }

    // 直接從全域記憶體取得 fabs
    const allFabs = (window.appState && window.appState.fabs) ? window.appState.fabs : [];

    // ⭐️ 依「可視群組版面 (appState.currentUser.assignedRoles)」與「fab.assignedRoles」的交集過濾廠區
    //    fab 的 assignedRoles 與帳號的 assignedRoles 有任何共同 role → 該廠區可見
    //    admin 也套用同規則（admin 帳號預設綁定所有 role 即可看到所有廠區）
    const userRoleIds = (appState.currentUser && (appState.currentUser.assignedRoles || appState.currentUser.AssignedRoles) || [])
        .map(window.cleanId);
    const fabs = !appState.currentUser ? allFabs : allFabs.filter(f => {
        const fabRoles = (f.assignedRoles || f.AssignedRoles || []).map(window.cleanId);
        // 若該廠區沒設任何 role，視為「無人可見」（與舊版單檔的隱含規則一致）
        if (fabRoles.length === 0) return false;
        return fabRoles.some(r => userRoleIds.includes(r));
    });

    fabMenu.innerHTML = '';

    if (fabs.length === 0) {
        fabMenu.innerHTML = '<li><span class="dropdown-item text-muted px-3 py-2"><i class="fas fa-exclamation-circle me-1"></i>無可用廠區資料</span></li>';
        if (fabNameDisplay) fabNameDisplay.innerText = '無';
        if (homeFabDisplay) homeFabDisplay.innerText = '無';
        return;
    }

    // 初始化 / 校正 appState.currentFab：若目前 appState.currentFab 不在可見清單中，自動切到第一個
    const isCurrentVisible = !!fabs.find(f =>
        window.cleanId(f.fabName || f.FabName || f.id || f.fabId || f.FabId) === window.cleanId(appState.currentFab)
    );
    if (!appState.currentFab || !isCurrentVisible) {
        const first = fabs[0];
        appState.currentFab = first.fabName || first.FabName || first.id || first.fabId || first.FabId;
        try { appState.currentFab = appState.currentFab; } catch (e) { }
    }

    // 尋找目前的廠區物件以取得顯示名稱
    const currentFabObj = fabs.find(f =>
        window.cleanId(f.fabName || f.FabName || f.id || f.fabId || f.FabId) === window.cleanId(appState.currentFab)
    );
    const displayDName = currentFabObj
        ? (currentFabObj.displayName || currentFabObj.DisplayName || currentFabObj.fabName || currentFabObj.FabName)
        : appState.currentFab;

    if (fabNameDisplay) fabNameDisplay.innerText = displayDName;
    if (homeFabDisplay) homeFabDisplay.innerText = displayDName;

    // 動態產生選單項目（已過濾過的 fabs）
    let htmlBuffer = [];
    fabs.forEach(f => {
        const fName = f.fabName || f.FabName || f.id || f.fabId || f.FabId;
        const dName = f.displayName || f.DisplayName || fName;
        const isCurrent = window.cleanId(fName) === window.cleanId(appState.currentFab);

        htmlBuffer.push(`
          <li>
            <a class="dropdown-item py-2 fw-bold d-flex justify-content-between align-items-center ${isCurrent ? 'bg-primary text-white' : ''}"
               href="#"
               data-fab="${String(fName).replace(/"/g, '&quot;')}">
              <span><i class="fas fa-industry me-2 small ${isCurrent ? 'text-white' : 'text-secondary'}"></i>${dName}</span>
              ${isCurrent ? '<i class="fas fa-check ms-2"></i>' : ''}
            </a>
          </li>
        `);
    });
    fabMenu.innerHTML = htmlBuffer.join('');

    // 綁定點擊事件 (精準攔截 a 標籤內的所有點擊)
    if (!fabMenu.hasAttribute('data-fab-bound')) {
        fabMenu.setAttribute('data-fab-bound', '1');
        fabMenu.addEventListener('click', function (e) {
            const a = e.target.closest('a[data-fab]');
            if (!a) return;
 
            e.preventDefault();
            // ✅ 不要 stopPropagation，讓 Bootstrap 的自動收合機制可以運作
            // e.stopPropagation();
 
            const selectedFab = a.getAttribute('data-fab');
            window.switchFab(selectedFab);
 
            // ✅ 手動保險收合（就算別的地方擋掉，也一定會關）
            const dropdownBtn = fabMenu.closest('.dropdown')?.querySelector('button[data-bs-toggle="dropdown"]');
            if (dropdownBtn && window.bootstrap?.Dropdown) {
                bootstrap.Dropdown.getOrCreateInstance(dropdownBtn).hide();
            }
        });
 
    }
};
 
// ⭐️ 廠區切換引擎（依「可視廠區」防呆）
window.switchFab = function (fabName) {
    if (!fabName) return;
    if (window.cleanId(appState.currentFab) === window.cleanId(fabName)) return;

    const fabs = (window.appState && window.appState.fabs) ? window.appState.fabs : [];
    const fabObj = fabs.find(f =>
        window.cleanId(f.fabName || f.FabName || f.id || f.fabId || f.FabId) === window.cleanId(fabName)
    );
    if (!fabObj) return;

    // 防呆：使用者沒有交集角色就不允許切到該廠區
    if (appState.currentUser) {
        const userRoleIds = (appState.currentUser.assignedRoles || appState.currentUser.AssignedRoles || []).map(window.cleanId);
        const fabRoleIds = (fabObj.assignedRoles || fabObj.AssignedRoles || []).map(window.cleanId);
        const canSee = fabRoleIds.length > 0 && fabRoleIds.some(r => userRoleIds.includes(r));
        if (!canSee) {
            if (typeof customAlert === 'function') customAlert(t('no_permission', '您沒有權限存取此廠區'));
            return;
        }
    }

    appState.currentFab = fabName;
    try { appState.currentFab = fabName; } catch (e) { }

    const dLang = fabObj.defaultLang || fabObj.DefaultLang;
    if (dLang && typeof changeLanguage === 'function') {
        changeLanguage(dLang);
    }

    if (typeof renderFabSwitcher === 'function') renderFabSwitcher();
    if (typeof renderHomeDashboard === 'function') renderHomeDashboard();
    if (typeof renderSidebarMenus === 'function') renderSidebarMenus();

    const isSystemSettings = appState.currentActiveTopMenuId === 'system_settings';
    if (appState.currentLayoutMode === 'system' && !isSystemSettings) {
        if (typeof goDefaultHome === 'function') {
            goDefaultHome();
        }
    }
};
// === 個人頁面管理 ===
//  - 主選單 (level 0) 才放在 tbody，DataTable 分頁只計主選單筆數（不含子選單）
//  - 主選單若有子選單，使用 DataTable row.child() 內嵌呈現
//  - 主選單拖曳影響上方導覽列順序；子選單拖曳影響側邊欄順序
//  - 顯示/隱藏 toggle、開啟方式下拉皆可即時生效

// Expose for HTML inline handlers
window.generateSidebarMenuItem = generateSidebarMenuItem;

