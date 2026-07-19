// === render/account-ui.js - 帳號 Modal 內部 UI 渲染 ===

import { getCustomMenus, getFabs, getRoles } from '../config.js?v=20260719';


import { clearDefaultMenu, pickDefaultMenu } from '../admin/account-manage.js?v=20260607k';
import { generateIconHtml } from '../ui/dialogs.js?v=20260607k';
import { getFullMenuPathStr } from '../ui/navigation.js?v=20260719';
import { appState } from '../store.js?v=20260607k';


export function renderAccRoleCheckboxes(selectedIds) {
    if (!selectedIds || !Array.isArray(selectedIds)) selectedIds = [];
    const container = document.getElementById('accRoleCheckboxes');
    if (!container) return;
    container.innerHTML = '';

    // ⭐️ 顯示「所屬廠區名」而非角色(模組)名：建立 roleId → 所屬廠區名稱 的對應。
    //    勾選綁定值(value)仍為 roleId、class 仍為 acc-role-cb，故權限邏輯完全不變，純顯示層調整。
    //    一個角色可能掛在多個廠區 → 以「、」串接；若不屬於任何廠區 → fallback 回角色群組名。
    const roleIdToFabNames = {};
    getFabs().forEach(f => {
        const fabName = f.fabName || f.FabName || f.id || f.fabId || f.FabId || '';
        const fabRoles = f.assignedRoles || f.AssignedRoles || [];
        if (!Array.isArray(fabRoles)) return;
        fabRoles.forEach(roleId => {
            const key = String(roleId);
            if (!roleIdToFabNames[key]) roleIdToFabNames[key] = [];
            if (fabName && !roleIdToFabNames[key].includes(fabName)) {
                roleIdToFabNames[key].push(fabName);
            }
        });
    });

    let html = [];
    getRoles().forEach(r => {
        const rId = r.id || r.roleId || r.RoleId || '';
        const rName = r.groupName || r.GroupName || rId;
        // 以所屬廠區名顯示；找不到對應廠區則退回角色群組名
        const fabNames = roleIdToFabNames[String(rId)];
        const displayName = (fabNames && fabNames.length) ? fabNames.join('、') : rName;
        // 12A 減量版：單一廠區只有一個群組 → 一律自動勾選（UI 已隱藏），儲存時自動指派唯一群組
        const isChecked = 'checked';

        html.push(`
            <div class="form-check form-check-inline border rounded px-3 py-1 bg-white mb-1 shadow-sm" style="border-color: #dee2e6 !important;">
                <input class="form-check-input ms-0 me-2 acc-role-cb cursor-pointer" type="checkbox" id="acr_${window.escapeHTML(rId)}" value="${window.escapeHTML(rId)}" ${isChecked}>
                <label class="form-check-label small fw-bold text-dark cursor-pointer" for="acr_${window.escapeHTML(rId)}">${window.escapeHTML(displayName)}</label>
            </div>
        `);
    });
    container.innerHTML = html.join('');

    // ⭐️ 勾選/取消勾選角色時，立刻刷新「管理目錄」、「廠區預設首頁」、以及個別覆寫三個區塊與預覽
    if (!container.hasAttribute('data-roles-bound')) {
        container.setAttribute('data-roles-bound', '1');
        container.addEventListener('change', (e) => {
            if (!e.target.classList.contains('acc-role-cb')) return;
            // 切換角色前，先把目前廠區的 extra/deny 勾選狀態落回 temp（避免重繪時遺失）
            if (typeof persistOverrideDom === 'function') persistOverrideDom();
            // 保留目前勾選的管理目錄狀態
            const stillCheckedManage = Array.from(document.querySelectorAll('.acc-menu-cb:checked')).map(cb => cb.value);

            if (typeof renderAccManageMenuCheckboxes === 'function') {
                renderAccManageMenuCheckboxes(stillCheckedManage);
            }
            if (typeof renderAccDefaultPagesUI === 'function') renderAccDefaultPagesUI();
            // 角色變動會影響「可存取廠區」與各廠區 role 可見集合 → 整個覆寫面板重繪
            if (typeof window.renderAccOverridePanel === 'function') window.renderAccOverridePanel();
        });
    }
}

// 「管理目錄」清單：只列出「該帳號目前勾選的角色 → role.allowedMenuIds（含其下層）」中
// 屬於 folder 型的選單。沒選任何角色 / 沒對應的 folder → 顯示提示。
export function renderAccManageMenuCheckboxes(selectedIds) {
    if (!selectedIds || !Array.isArray(selectedIds)) selectedIds = [];
    const container = document.getElementById('accManageMenuCheckboxes');
    if (!container) return;
    container.innerHTML = '';

    // 取當前 modal 內已勾選的角色（即時讀 DOM，避免依賴外部傳入）
    const checkedRoleIds = Array.from(document.querySelectorAll('.acc-role-cb:checked')).map(cb => cb.value);
    const allMenus = getCustomMenus();

    if (checkedRoleIds.length === 0) {
        container.innerHTML = '<div class="text-warning small px-2 py-1"><i class="fas fa-exclamation-circle me-1"></i>請先在「可視群組版面」勾選至少一個角色，才能授權管理目錄</div>';
        return;
    }

    // 1) 從勾選角色蒐集 allowedMenuIds
    const roles = getRoles();
    let initialMenuIds = [];
    checkedRoleIds.forEach(rId => {
        const role = roles.find(r => window.cleanId(r.id || r.RoleId) === window.cleanId(rId));
        if (role && (role.allowedMenuIds || role.AllowedMenuIds)) {
            initialMenuIds.push(...(role.allowedMenuIds || role.AllowedMenuIds));
        }
    });

    // 2) 展開階層（包含子節點）
    const eligibleIds = window.getAllowedIdsWithHierarchy(allMenus, initialMenuIds);

    // 3) 篩選出「啟用 + 為 folder + 在 eligibleIds 內」
    const folderMenus = allMenus.filter(m =>
        (m.menuMode || m.MenuMode || '').toLowerCase() === 'folder' &&
        (m.enabled !== false && m.IsEnabled !== false) &&
        eligibleIds.has(m.id || m.MenuId)
    );

    if (folderMenus.length === 0) {
        container.innerHTML = '<div class="text-muted small px-2 py-1"><i class="fas fa-info-circle me-1 opacity-50"></i>所選角色在可視廠區內沒有可委派的主選單目錄</div>';
        return;
    }

    let html = [];
    folderMenus.forEach(m => {
        const mId = m.id || m.MenuId || '';
        const mDName = m.displayName || m.DisplayName || '';
        const isChecked = selectedIds.some(s => window.cleanId(s) === window.cleanId(mId)) ? 'checked' : '';
        html.push(`
            <div class="form-check mb-1 ms-1 d-flex align-items-center">
                <input class="form-check-input acc-menu-cb cursor-pointer mt-0" type="checkbox" id="acm_${mId}" value="${mId}" ${isChecked}>
                <label class="form-check-label fw-bold text-dark cursor-pointer d-flex align-items-center ms-2" for="acm_${mId}">
                    <i class="fas fa-folder text-warning me-2 fs-5"></i> ${mDName}
                </label>
            </div>
        `);
    });
    container.innerHTML = html.join('');
}

// =========================================================================
// 個別覆寫 (per-fab)：以「廠區」為單位的額外開放 / 個別封鎖 / 即時可見預覽
//   狀態：appState.tempExtraMenus / appState.tempDenyMenus = { fabName: [menuId,...] }
//         appState.overrideFab = 目前正在編輯的廠區名（與 defaultPages 同樣以「廠區名」為 key）
//   優先序與 sidebar.js 對齊：該廠區 role 可見 ＋ extra[fab] − deny[fab]。
// =========================================================================

// 共用：把所有「非 folder + 啟用」menu 抓出來
export function getAllSelectableMenus() {
    const all = getCustomMenus();
    return all.filter(m => {
        const mode = (m.menuMode || m.MenuMode || '').toLowerCase();
        if (mode === 'folder') return false;
        if (m.enabled === false || m.IsEnabled === false) return false;
        return true;
    });
}

// 目前 modal 內已勾選的角色 id 清單
function getCheckedRoleIds() {
    return Array.from(document.querySelectorAll('.acc-role-cb:checked')).map(cb => cb.value);
}

// 算出「目前 modal 內已勾選 roles」展開後的全部 menuId 集合（含子節點）— 跨廠區聯集（保留給外部相容用）
export function computeRoleAllowedSet() {
    const checkedRoleIds = getCheckedRoleIds();
    const roles = getRoles();
    let initialMenuIds = [];
    checkedRoleIds.forEach(rId => {
        const role = roles.find(r => window.cleanId(r.id || r.RoleId) === window.cleanId(rId));
        if (role && (role.allowedMenuIds || role.AllowedMenuIds)) {
            initialMenuIds.push(...(role.allowedMenuIds || role.AllowedMenuIds));
        }
    });
    return window.getAllowedIdsWithHierarchy(getCustomMenus(), initialMenuIds);
}

// 此帳號「可存取的廠區」= 所有現存廠區（單一系統版面預設皆可觀看，不再檢查 Map_Fab_Role）
function getAccessibleOverrideFabs() {
    let fabs = getFabs().map(f => f.fabName || f.FabName || f.id || f.fabId || f.FabId || '').filter(Boolean);
    return fabs.length ? fabs : ['12A'];
}
window.__getAccessibleOverrideFabs = getAccessibleOverrideFabs;

// 某廠區「role 可見集合」= 單一系統版面預設涵蓋所有選單
function computeRoleAllowedSetForFab(fabName) {
    let initialMenuIds = getCustomMenus().map(m => m.id || m.MenuId);
    return window.getAllowedIdsWithHierarchy(getCustomMenus(), initialMenuIds);
}

// 把目前畫面上的 extra/deny 勾選狀態存回 temp（綁定 appState.overrideFab 這個廠區）
function persistOverrideDom() {
    const fab = appState.overrideFab;
    if (!fab) return;
    if (!appState.tempExtraMenus) appState.tempExtraMenus = {};
    if (!appState.tempDenyMenus) appState.tempDenyMenus = {};
    appState.tempExtraMenus[fab] = Array.from(document.querySelectorAll('.acc-extra-cb:checked')).map(cb => cb.value);
    appState.tempDenyMenus[fab] = Array.from(document.querySelectorAll('.acc-deny-cb:checked')).map(cb => cb.value);
}
window.__persistAccOverrideDom = persistOverrideDom;

// 主入口：建立「廠區選擇器」＋ 該廠區的 extra/deny 清單 ＋ 預覽
window.renderAccOverridePanel = function () {
    if (!appState.tempExtraMenus) appState.tempExtraMenus = {};
    if (!appState.tempDenyMenus) appState.tempDenyMenus = {};
    const accessible = getAccessibleOverrideFabs();
    const selWrap = document.getElementById('accOverrideFabSelector');

    // 目前選的廠區若已不在可存取清單 → 改選第一個（或清空）
    if (!appState.overrideFab || !accessible.some(f => window.cleanId(f) === window.cleanId(appState.overrideFab))) {
        appState.overrideFab = accessible.length ? accessible[0] : '';
    }

    if (selWrap) {
        // 單一系統版面預設只固定一個廠區，自動選擇並且隱藏多餘的切換 UI
        selWrap.style.display = 'none';
    }

    window.renderAccExtraMenuCheckboxes();
    window.renderAccDenyMenuCheckboxes();
    window.renderAccEffectivePreview();
};

// 額外開放（當前廠區）：列出「不在該廠區 Role 範圍內的 menus」，讓 admin 勾選來補
window.renderAccExtraMenuCheckboxes = function () {
    const container = document.getElementById('accExtraMenuCheckboxes');
    if (!container) return;
    const fab = appState.overrideFab;
    if (!fab) { container.innerHTML = '<div class="text-muted small px-2 py-1"><i class="fas fa-info-circle me-1 opacity-50"></i>請先選擇要設定的廠區</div>'; return; }

    const selectableMenus = getAllSelectableMenus();
    const roleAllowedSet = computeRoleAllowedSetForFab(fab);
    const selected = (((appState.tempExtraMenus || {})[fab]) || []).map(window.cleanId);

    // 候選 = (全部可選 menus) − (該廠區 role 已涵蓋)；已勾選的 extra 一律顯示
    const candidates = selectableMenus.filter(m => {
        const mId = window.cleanId(m.id || m.MenuId);
        if (selected.includes(mId)) return true;
        return !roleAllowedSet.has(mId);
    });

    if (candidates.length === 0) {
        container.innerHTML = '<div class="text-muted small px-2 py-1"><i class="fas fa-info-circle me-1 opacity-50"></i>此廠區的 Role 已涵蓋所有看板，不需要額外開放</div>';
        return;
    }

    let html = [];
    candidates.forEach(m => {
        const mId = m.id || m.MenuId || '';
        const mName = m.displayName || m.DisplayName || m.name || m.SysName || mId;
        const checked = selected.includes(window.cleanId(mId)) ? 'checked' : '';
        const pathStr = typeof getFullMenuPathStr === 'function' ? getFullMenuPathStr(mId, getCustomMenus()) : mName;
        html.push(`
            <div class="form-check d-flex align-items-center">
                <input class="form-check-input acc-extra-cb cursor-pointer mt-0" type="checkbox" id="acex_${mId}" value="${mId}" ${checked} onchange="window.__accOverrideChanged('extra')">
                <label class="form-check-label small text-dark cursor-pointer ms-2" for="acex_${mId}" title="${pathStr}">
                    <i class="fas fa-file-alt text-secondary me-1 opacity-75"></i>${mName}
                </label>
            </div>
        `);
    });
    container.innerHTML = html.join('');
};

// 個別封鎖（當前廠區）：列出「該廠區目前可見 = role + 已勾 extra」，讓 admin 勾要扣掉的
window.renderAccDenyMenuCheckboxes = function () {
    const container = document.getElementById('accDenyMenuCheckboxes');
    if (!container) return;
    const fab = appState.overrideFab;
    if (!fab) { container.innerHTML = '<div class="text-muted small px-2 py-1"><i class="fas fa-info-circle me-1 opacity-50"></i>請先選擇要設定的廠區</div>'; return; }

    // 候選 = 該廠區 role allowed + 目前 modal 勾的 extra
    const roleAllowedSet = computeRoleAllowedSetForFab(fab);
    const checkedExtraIds = Array.from(document.querySelectorAll('.acc-extra-cb:checked')).map(cb => window.cleanId(cb.value));
    const candidateSet = new Set([...roleAllowedSet, ...checkedExtraIds]);

    const selectable = getAllSelectableMenus().filter(m => candidateSet.has(window.cleanId(m.id || m.MenuId)));
    const selected = (((appState.tempDenyMenus || {})[fab]) || []).map(window.cleanId);

    if (selectable.length === 0) {
        container.innerHTML = '<div class="text-muted small px-2 py-1"><i class="fas fa-info-circle me-1 opacity-50"></i>此廠區沒有可被封鎖的看板（先勾選 Role 或加入額外開放）</div>';
        return;
    }

    let html = [];
    selectable.forEach(m => {
        const mId = m.id || m.MenuId || '';
        const mName = m.displayName || m.DisplayName || m.name || m.SysName || mId;
        const checked = selected.includes(window.cleanId(mId)) ? 'checked' : '';
        const pathStr = typeof getFullMenuPathStr === 'function' ? getFullMenuPathStr(mId, getCustomMenus()) : mName;
        html.push(`
            <div class="form-check d-flex align-items-center">
                <input class="form-check-input acc-deny-cb cursor-pointer mt-0" type="checkbox" id="acdn_${mId}" value="${mId}" ${checked} onchange="window.__accOverrideChanged('deny')">
                <label class="form-check-label small text-dark cursor-pointer ms-2" for="acdn_${mId}" title="${pathStr}">
                    <i class="fas fa-file-alt text-secondary me-1 opacity-75"></i>${mName}
                </label>
            </div>
        `);
    });
    container.innerHTML = html.join('');
};

// 統一處理：勾選 extra/deny 時，先把當前廠區狀態落到 temp，再連動更新候選與預覽
window.__accOverrideChanged = function (which) {
    persistOverrideDom();
    if (which === 'extra') {
        // extra 動了 → deny 的候選池需重整 (deny 候選 = role + extra)
        if (typeof window.renderAccDenyMenuCheckboxes === 'function') window.renderAccDenyMenuCheckboxes();
    }
    if (typeof window.renderAccEffectivePreview === 'function') window.renderAccEffectivePreview();
};

// 即時預覽（當前廠區）：role + extra - deny
window.renderAccEffectivePreview = function () {
    const container = document.getElementById('accEffectivePreview');
    if (!container) return;
    const fab = appState.overrideFab;

    const roleAllowedSet = fab ? computeRoleAllowedSetForFab(fab) : new Set();
    const checkedExtraIds = Array.from(document.querySelectorAll('.acc-extra-cb:checked')).map(cb => window.cleanId(cb.value));
    const checkedDenyIds = Array.from(document.querySelectorAll('.acc-deny-cb:checked')).map(cb => window.cleanId(cb.value));

    const effective = new Set([...roleAllowedSet, ...checkedExtraIds]);
    checkedDenyIds.forEach(id => effective.delete(id));

    const items = getCustomMenus().filter(m => {
        const mId = window.cleanId(m.id || m.MenuId);
        if (!effective.has(mId)) return false;
        const mode = (m.menuMode || m.MenuMode || '').toLowerCase();
        if (mode === 'folder') return false;
        if (m.enabled === false || m.IsEnabled === false) return false;
        return true;
    });

    if (!fab) {
        container.innerHTML = '<div class="text-muted small"><i class="fas fa-info-circle me-1 opacity-50"></i>選擇廠區後即可預覽該廠區實際可見看板</div>';
        return;
    }
    if (items.length === 0) {
        container.innerHTML = '<div class="text-warning small"><i class="fas fa-exclamation-triangle me-1"></i>此帳號在「' + window.escapeHTML(fab) + '」目前沒有任何可見看板</div>';
        return;
    }

    let html = [];
    items.forEach(m => {
        const mName = m.displayName || m.DisplayName || m.name || m.SysName || '';
        const mId = window.cleanId(m.id || m.MenuId);
        const isExtra = checkedExtraIds.includes(mId);  // extra 綠 / role 藍
        const bg = isExtra ? 'bg-success-subtle text-success border-success' : 'bg-primary-subtle text-primary border-primary';
        html.push(`<span class="badge border ${bg} border-opacity-50" style="font-size:0.7rem;"><i class="fas fa-file-alt me-1 opacity-75"></i>${mName}</span>`);
    });
    container.innerHTML = html.join('');
};

export function renderAccDefaultPagesUI() {
    const container = document.getElementById('accDefaultPagesContainer'); if (!container) return;
    const fabs = getFabs(); const menus = getCustomMenus(); let html = '';
    const escAttr = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    fabs.forEach(f => {
        const fName = f.fabName || f.FabName || f.id || f.fabId || f.FabId || '';
        let defMenuId = appState.tempDefaultPages[fName];
        let defMenuObj = menus.find(m => window.cleanId(m.id || m.MenuId) === window.cleanId(defMenuId));
        let displayTxt = defMenuObj ? getFullMenuPathStr(defMenuId, menus) : '系統自動抓取第一個可視看板';
        let txtColor = defMenuObj ? 'text-success fw-bold' : 'text-muted';

        // 使用 data-fab + addEventListener 取代 inline onclick，避免名稱含引號時注入
        html += `
            <div class="d-flex align-items-center mb-2 border-bottom pb-2">
                <span class="badge bg-secondary me-2" style="width: 45px;">${fName}</span>
                <span class="flex-grow-1 text-truncate small ${txtColor}" id="def_text_${escAttr(fName)}">預設：${displayTxt}</span>
                <button type="button" class="btn btn-sm btn-outline-primary py-0 px-3 fw-bold rounded-pill shadow-sm js-pick-default" data-fab="${escAttr(fName)}">指定</button>
                <button type="button" class="btn btn-sm btn-outline-danger border-0 py-0 px-2 ms-1 js-clear-default" data-fab="${escAttr(fName)}" title="清除設定"><i class="fas fa-times"></i></button>
            </div>
        `;
    });
    container.innerHTML = html;

    if (!container.hasAttribute('data-bound')) {
        container.setAttribute('data-bound', '1');
        container.addEventListener('click', function (e) {
            const pickBtn = e.target.closest('.js-pick-default');
            const clearBtn = e.target.closest('.js-clear-default');
            if (pickBtn) {
                const fab = pickBtn.getAttribute('data-fab');
                if (typeof openMenuSelector === 'function') openMenuSelector(fab);
            } else if (clearBtn) {
                const fab = clearBtn.getAttribute('data-fab');
                if (typeof clearDefaultMenu === 'function') clearDefaultMenu(fab);
            }
        });
    }
}

// ⭐️ 物理強制關閉抽屜 (解掉 blocked aria-hidden focus 的錯誤)
window.closeMenuSelector = function () {
    if (document.activeElement) document.activeElement.blur();
    const drawerEl = document.getElementById('menuSelectDrawer');
    if (drawerEl) {
        drawerEl.classList.remove('show');
        setTimeout(() => { drawerEl.style.visibility = 'hidden'; }, 300);
    }
    const backdrop = document.getElementById('offcanvas-force-backdrop');
    if (backdrop) backdrop.remove();
};

window.toggleDrawerCollapse = function (e, targetId, element) {
    e.preventDefault(); e.stopPropagation();
    const targetEl = document.getElementById(targetId);
    if (!targetEl) return;
    if (targetEl.classList.contains('show')) {
        targetEl.classList.remove('show'); element.classList.add('collapsed'); element.setAttribute('aria-expanded', 'false');
    } else {
        targetEl.classList.add('show'); element.classList.remove('collapsed'); element.setAttribute('aria-expanded', 'true');
    }
};

window.openMenuSelector = function (fabName) {
    if (document.activeElement) document.activeElement.blur();

    let pickingInput = document.getElementById('pickingForFab');
    if (!pickingInput) {
        pickingInput = document.createElement('input');
        pickingInput.type = 'hidden'; pickingInput.id = 'pickingForFab';
        document.body.appendChild(pickingInput);
    }
    pickingInput.value = fabName;

    // 此時 HTML 中已經完美具備了 Z-index 10600 的 Drawer
    const drawerEl = document.getElementById('menuSelectDrawer');
    const container = document.getElementById('menuSelectDrawerContainer');
    container.innerHTML = '';
    const searchInput = document.getElementById('menuSelectSearchInput');
    if (searchInput) searchInput.value = '';

    let assignedRoles = []; document.querySelectorAll('.acc-role-cb:checked').forEach(cb => assignedRoles.push(cb.value));

    const fabs = getFabs();
    const fabObj = fabs.find(f => window.cleanId(f.fabName || f.FabName || f.id || f.fabId || f.FabId) === window.cleanId(fabName));
    const fabRoleIds = fabObj ? (fabObj.assignedRoles || fabObj.AssignedRoles || []) : [];

    const allMenus = getCustomMenus();
    // 單一系統版面預設皆可觀看，與 renderSidebarMenus 同步放寬所有選單
    let initialMenuIds = allMenus.map(m => m.id || m.MenuId);
    let allowedIds = new Set(initialMenuIds.map(id => window.cleanId(id)));

    // 由已允許的資料夾往下展開子節點（含 app_grid 等），確保資料夾底下的看板也可被選為預設頁。
    // ⚠️ 必須檢查「全部 parentIds」（一個看板可同時掛在多個群組底下，見 api.js:252），不可只看
    //    parentId / parentIds[0]（兩者都只是第一個父節點）——否則該看板的「被允許群組」若不是其 parentIds
    //    的第一個元素就會被漏掉，導致挑選器只跑出群組底下的第一個看板（與 sidebar.js
    //    getAllowedIdsWithHierarchy 的多父展開邏輯對齊）。
    let added = true;
    while (added) {
        added = false;
        allMenus.forEach(m => {
            let mId = window.cleanId(m.id || m.MenuId);
            if (!allowedIds.has(mId)) {
                const parents = [];
                if (m.parentId) parents.push(m.parentId);
                if (m.ParentMenuId) parents.push(m.ParentMenuId);
                if (Array.isArray(m.parentIds)) parents.push(...m.parentIds);
                if (parents.some(p => allowedIds.has(window.cleanId(p)))) { allowedIds.add(mId); added = true; }
            }
        });
    }

    // ⭐ 預設看板挑選器：除了「可開啟的看板」，也納入「有子選單的資料夾」(folder)，讓管理者能把整個群組
    //    （例：ZE 強化防禦群組）指定為預設首頁；登入時 goDefaultHome(navigation.js) 會自動展開、落到其下
    //    第一個可看的子看板。可見集合 (allowedIds) 完全不變、只放寬「可被選取的類型」，與側邊欄
    //    renderSidebarMenus(sidebar.js) 的可見範圍仍保持對齊。
    const viewableMenus = allMenus.filter(m => (m.enabled !== false && m.IsEnabled !== false) && allowedIds.has(window.cleanId(m.id || m.MenuId)));

    if (viewableMenus.length === 0) {
        container.innerHTML = `<div class="text-center text-muted py-5 fw-bold"><i class="fas fa-folder-open mb-3 fs-1 opacity-50"></i><br>此帳號在該廠區沒有可觀看的看板。<br><small class="fw-normal">請先勾選下方的可視群組版面。</small></div>`;
    } else {
        let groups = {};
        viewableMenus.forEach(m => {
            let rootNode = m;
            while (rootNode && (rootNode.parentId || rootNode.ParentMenuId || (rootNode.parentIds && rootNode.parentIds.length > 0))) {
                let pId = rootNode.parentId || rootNode.ParentMenuId || rootNode.parentIds[0];
                let parent = allMenus.find(x => window.cleanId(x.id || x.MenuId) === window.cleanId(pId));
                if (parent) rootNode = parent; else break;
            }

            let rId = rootNode ? window.cleanId(rootNode.id || rootNode.MenuId) : 'other';
            let rName = rootNode ? (rootNode.displayName || rootNode.DisplayName || rootNode.name || rootNode.SysName) : '其他獨立看板';
            if (typeof i18n !== 'undefined' && i18n[appState.currentLang] && i18n[appState.currentLang]['dyn_' + rId] && rootNode && !rootNode.isEdited && !rootNode.IsEdited) rName = i18n[appState.currentLang]['dyn_' + rId];

            const rOrder = rootNode ? (rootNode.order || rootNode.GlobalOrder || 999) : 999;
            const rIcon = rootNode ? (rootNode.icon || rootNode.Icon || 'fas fa-link') : 'fas fa-link';

            if (!groups[rId]) groups[rId] = { rootName: rName, rootIcon: rIcon, items: [], order: rOrder };

            const mId = window.cleanId(m.id || m.MenuId);
            let fullPathStr = typeof getFullMenuPathStr === 'function' ? getFullMenuPathStr(mId, allMenus) : (m.displayName || m.DisplayName);
            let pathArr = fullPathStr.split(' / ');
            if (pathArr.length > 1) pathArr.shift(); pathArr.pop();
            let subPath = pathArr.join(' / ');

            const mMode = m.menuMode || m.MenuMode;
            const mOrder = m.order || m.GlobalOrder || 999;
            groups[rId].items.push({ id: mId, name: m.name || m.SysName, displayName: m.displayName || m.DisplayName, subPath: subPath, type: mMode, order: mOrder });
        });

        const sortedGroupKeys = Object.keys(groups).sort((a, b) => groups[a].order - groups[b].order);
        let html = ``; let isFirst = true;

        sortedGroupKeys.forEach((rId, index) => {
            let group = groups[rId];
            group.items.sort((a, b) => a.order - b.order);

            let listHtml = `<div class="bg-white border border-top-0 rounded-bottom pt-1 pb-2 shadow-sm">`;
            group.items.forEach(item => {
                const isFolderItem = String(item.type || '').toLowerCase() === 'folder';
                let badge = item.type === 'app_grid'
                    ? '<span class="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25 ms-2" style="font-size:0.6rem;">應用集合</span>'
                    : (isFolderItem ? '<span class="badge bg-warning bg-opacity-10 text-warning border border-warning border-opacity-25 ms-2" style="font-size:0.6rem;">資料夾 (登入落第一個子看板)</span>' : '');
                let subPathHtml = item.subPath ? `<div class="badge bg-secondary bg-opacity-10 text-secondary border mt-1 fw-normal" style="font-size:0.65rem;">位於: ${item.subPath}</div>` : '';
                const itemIcon = item.type === 'app_grid' ? 'fa-th-large text-success' : (isFolderItem ? 'fa-folder text-warning' : 'fa-file-alt text-secondary');

                listHtml += `
                    <div class="drawer-item d-flex justify-content-between align-items-center p-2 border-bottom cursor-pointer hover-bg-light" style="transition: all 0.2s;" onclick="pickDefaultMenu('${item.id}'); window.closeMenuSelector();">
                        <div class="pe-2">
                            <div class="fw-bold text-dark d-flex align-items-center mb-0" style="font-size: 0.85rem;">
                                <i class="fas ${itemIcon} item-icon me-2 opacity-75"></i> ${item.displayName} ${badge}
                            </div>
                            ${subPathHtml}
                        </div>
                        <button type="button" class="btn btn-sm btn-outline-primary px-3 fw-bold rounded-pill shadow-sm bg-white" style="font-size: 0.75rem; flex-shrink: 0;" onclick="event.stopPropagation(); pickDefaultMenu('${item.id}'); window.closeMenuSelector();">選取</button>
                    </div>
                `;
            });
            listHtml += `</div>`;

            let iconHtml = typeof generateIconHtml === 'function' ? generateIconHtml(group.rootIcon, 'text-primary', '', true) : `<i class="${group.rootIcon} text-primary"></i>`;

            html += `
                <div class="drawer-group mb-3">
                    <div class="drawer-group-title bg-white border rounded shadow-sm p-3 d-flex justify-content-between align-items-center cursor-pointer ${isFirst ? '' : 'collapsed'}" onclick="window.toggleDrawerCollapse(event, 'drawer_col_${index}', this)" aria-expanded="${isFirst ? 'true' : 'false'}">
                        <div class="d-flex align-items-center">
                            <div style="width:24px; text-align:center;" class="me-2">${iconHtml}</div>
                            <span class="fw-bold text-dark fs-6">${group.rootName}</span>
                        </div>
                        <span class="badge bg-white text-dark border border-secondary rounded-pill shadow-sm px-2">${group.items.length}</span>
                    </div>
                    <div class="collapse ${isFirst ? 'show' : ''}" id="drawer_col_${index}">
                        ${listHtml}
                    </div>
                </div>
            `;
            isFirst = false;
        });
        container.innerHTML = html;
    }

    // ⭐️ 物理強制霸道展開：無條件將抽屜移到 body 最末端，套用突破天際的 z-index 999999
    if (drawerEl) {
        if (drawerEl.parentElement !== document.body) {
            document.body.appendChild(drawerEl);
        }
        drawerEl.style.setProperty('z-index', '999999', 'important');
        drawerEl.style.setProperty('position', 'fixed', 'important');
        drawerEl.style.visibility = 'visible';
        void drawerEl.offsetWidth;
        drawerEl.classList.add('show');

        let offBackdrop = document.getElementById('offcanvas-force-backdrop');
        if (!offBackdrop) {
            offBackdrop = document.createElement('div');
            offBackdrop.id = 'offcanvas-force-backdrop';
            offBackdrop.className = 'modal-backdrop fade show';
            offBackdrop.style.setProperty('z-index', '999998', 'important');
            offBackdrop.onclick = window.closeMenuSelector;
            document.body.appendChild(offBackdrop);
        }

        setTimeout(() => { const input = document.getElementById('menuSelectSearchInput'); if (input) input.focus(); }, 300);
    }
};

window.filterMenuSelectDrawer = function () {
    const input = document.getElementById('menuSelectSearchInput').value.toLowerCase();
    const groups = document.querySelectorAll('#menuSelectDrawerContainer .drawer-group');

    groups.forEach(grpItem => {
        const listItems = grpItem.querySelectorAll('.drawer-item');
        let hasVisibleChild = false;

        listItems.forEach(li => {
            const text = li.innerText.toLowerCase();
            if (text.includes(input)) {
                li.style.setProperty('display', 'flex', 'important');
                hasVisibleChild = true;
            } else {
                li.style.setProperty('display', 'none', 'important');
            }
        });

        if (hasVisibleChild) {
            grpItem.style.display = 'block';
            if (input.trim() !== '') {
                const collapseEl = grpItem.querySelector('.collapse');
                if (collapseEl && !collapseEl.classList.contains('show')) {
                    collapseEl.classList.add('show');
                    const titleEl = grpItem.querySelector('.drawer-group-title');
                    if (titleEl) { titleEl.classList.remove('collapsed'); titleEl.setAttribute('aria-expanded', 'true'); }
                }
            }
        } else {
            grpItem.style.display = 'none';
        }
    });
};



// Expose for HTML inline handlers
window.renderAccRoleCheckboxes = renderAccRoleCheckboxes;
window.renderAccManageMenuCheckboxes = renderAccManageMenuCheckboxes;
window.getAllSelectableMenus = getAllSelectableMenus;
window.computeRoleAllowedSet = computeRoleAllowedSet;
window.renderAccDefaultPagesUI = renderAccDefaultPagesUI;

