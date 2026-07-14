// === ui/navigation.js - 語系切換、選單導航、路由、iframe ===
import { getCustomMenus, getFabs, getRoles, t } from '../config.js?v=20260607k';
import { loadActivityLogs } from '../admin/activity-log.js?v=20260607k';
import { openAppGridPage } from '../admin/misc-manage.js?v=20260607k';
import { renderSidebarMenus } from '../render/sidebar.js?v=20260607k';
import { renderAccountTable, renderApplyTable, renderAuditTable, renderFabTable, renderMenuConfigTable, renderPersonalMenuManage, renderRoleTable, renderWebpageTable } from '../render/tables.js?v=20260607k';
import { appState } from '../store.js?v=20260607k';


export function changeLanguage(lang) {
    appState.currentLang = lang;

    // 1. 全面掃描 data-i18n 屬性，替換靜態 HTML 文字
    if (typeof i18n !== 'undefined') {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (i18n[lang] && i18n[lang][key] !== undefined && i18n[lang][key] !== null) el.innerHTML = i18n[lang][key];
        });
        // 1b. data-i18n-placeholder：input/textarea 的 placeholder 也要跟著翻譯（如側邊欄看板搜尋框）
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (i18n[lang] && i18n[lang][key] !== undefined && i18n[lang][key] !== null) el.setAttribute('placeholder', i18n[lang][key]);
        });
    }

    // 2. 更新語言按鈕顯示文字（用當前語言的名稱）
    const langDisplayEl = document.getElementById('current-lang-display');
    if (langDisplayEl) langDisplayEl.innerText = t('lang_' + lang, lang.toUpperCase());

    // 3. ✅ 更新語言下拉選單的打勾圖示 (同步 check icon)
    document.querySelectorAll('.lang-check').forEach(el => el.classList.add('d-none'));
    const checkIcon = document.getElementById('check-' + lang);
    if (checkIcon) checkIcon.classList.remove('d-none');

    // 4. 更新版面切換按鈕文字 (系統/自訂 → System/Custom → システム/カスタム)
    const sysText = document.getElementById('btn-layout-system');
    const perText = document.getElementById('btn-layout-personal');
    if (sysText) sysText.innerText = t('nav_sys', '系統');
    if (perText) perText.innerText = t('nav_personal', '自訂');

    // 5. ✅ 重繪首頁儀表板與右上角使用者資訊
    if (typeof renderHomeDashboard === 'function') renderHomeDashboard();

    // 6. 重繪側邊欄（含系統設定子選單翻譯）
    if (appState.currentUser && typeof renderSidebarMenus === 'function') renderSidebarMenus();

    // 7. ✅ 核心修復：重新渲染當前正在顯示的頁面，讓動態產生的按鈕與表格文字也一併翻譯
    const activePage = document.querySelector('.page-section.active');
    if (activePage) {
        const pageId = activePage.id;
        if (pageId === 'page-personal-manage' && typeof renderPersonalMenuManage === 'function') renderPersonalMenuManage();
        if (pageId === 'page-webpage-manage' && typeof renderWebpageTable === 'function') renderWebpageTable();
        if (pageId === 'page-menu-manage' && typeof renderMenuConfigTable === 'function') renderMenuConfigTable();
        if (pageId === 'page-fab-manage' && typeof renderFabTable === 'function') renderFabTable();
        if (pageId === 'page-role-manage' && typeof renderRoleTable === 'function') renderRoleTable();
        if (pageId === 'page-account-manage' && typeof renderAccountTable === 'function') renderAccountTable();
        if (pageId === 'page-apply' && typeof renderApplyTable === 'function') renderApplyTable();
        if (pageId === 'page-audit-manage' && typeof renderAuditTable === 'function') renderAuditTable();
        if (pageId === 'page-activity-log' && typeof loadActivityLogs === 'function') loadActivityLogs();
    }
}
window.changeLanguage = changeLanguage;


export function renderLangSwitcher() {
    const container = document.getElementById('lang-dropdown-menu');
    if (!container) return;

    const langs = [
        { code: 'zh', label: '繁體中文' },
        { code: 'en', label: 'English' },
        { code: 'ja', label: '日本語' }
    ];

    container.innerHTML = langs.map(l => `
        <li>
            <a class="dropdown-item py-1 fw-bold cursor-pointer d-flex justify-content-between align-items-center
                ${appState.currentLang === l.code ? 'active bg-light text-primary' : ''}"
               onclick="changeLanguage('${l.code}')">
                ${l.label}
                ${appState.currentLang === l.code ? '<i class="fa-solid fa-check"></i>' : ''}
            </a>
        </li>
    `).join('');
}
window.renderLangSwitcher = renderLangSwitcher;

// 取得上方導覽列名稱
export function getTopMenuName() {
    if (appState.currentActiveTopMenuId === 'system_settings') return t('nav_sys_settings', '系統設定');
    if (!appState.currentActiveTopMenuId) return '';
    const menus = getCustomMenus();
    const cTargetId = window.cleanId(appState.currentActiveTopMenuId);
    const topMenu = menus.find(m => window.cleanId(m.id || m.MenuId || m.menuId) === cTargetId);
    if (topMenu) {
        let mId = topMenu.id || topMenu.MenuId || topMenu.menuId;
        let dName = topMenu.displayName || topMenu.DisplayName || topMenu.sysName || topMenu.SysName;
        let isEdited = topMenu.isEdited || topMenu.IsEdited;

        if (typeof i18n !== 'undefined' && i18n[appState.currentLang] && i18n[appState.currentLang]['dyn_' + mId] && !isEdited) {
            dName = i18n[appState.currentLang]['dyn_' + mId];
        }
        return dName;
    }
    return '';
}

// 取得麵包屑路徑
export function getMenuPath(element) {
    let path = []; let current = element;
    while (current) {
        let container = current.closest('.collapse');
        if (!container) break;
        let targetId = container.id;
        let parentItem = document.querySelector(`[data-bs-target="#${targetId}"]`);
        if (parentItem) {
            let textSpan = parentItem.querySelector('span');
            if (textSpan) path.unshift(textSpan.innerText.trim());
            else path.unshift(parentItem.innerText.trim());
            current = parentItem;
        } else break;
    }
    return path.join(' / ');
}

// 取得完整路徑字串
export function getFullMenuPathStr(menuId, allMenus) {
    let path = [];
    let cTargetId = window.cleanId(menuId);
    let curr = allMenus.find(m => window.cleanId(m.id || m.MenuId || m.menuId) === cTargetId);

    while (curr) {
        let mId = curr.id || curr.MenuId || curr.menuId;
        let dName = curr.displayName || curr.DisplayName || curr.sysName || curr.SysName;
        let isEdited = curr.isEdited || curr.IsEdited;

        if (typeof i18n !== 'undefined' && i18n[appState.currentLang] && i18n[appState.currentLang]['dyn_' + mId] && !isEdited) {
            dName = i18n[appState.currentLang]['dyn_' + mId];
        }
        path.unshift(dName);

        let pId = curr.parentId || curr.ParentMenuId || curr.parentMenuId || (curr.parentIds && curr.parentIds.length > 0 ? curr.parentIds[0] : null);
        let cPId = window.cleanId(pId);

        if (cPId && cPId !== 'null') {
            curr = allMenus.find(m => window.cleanId(m.id || m.MenuId || m.menuId) === cPId);
        } else {
            curr = null;
        }
    }
    return path.join(' / ');
}

// 判斷是否為子節點
window.isMenuDescendant = function (folderId, targetId, allMenus) {
    let cFolderId = window.cleanId(folderId);
    let cTargetId = window.cleanId(targetId);
    if (cFolderId === cTargetId) return true;

    let queue = [cFolderId];
    while (queue.length > 0) {
        let curr = queue.shift();
        let children = allMenus.filter(m => {
            let pId = m.parentId || m.ParentMenuId || m.parentMenuId;
            return window.cleanId(pId) === curr || (m.parentIds || []).map(window.cleanId).includes(curr);
        });
        for (let child of children) {
            let cId = window.cleanId(child.id || child.MenuId || child.menuId);
            if (cId === cTargetId) return true;
            queue.push(cId);
        }
    }
    return false;
};

// ⭐️ 智慧點擊主選單連動：直接依照繪製好的側邊欄判斷是否為網頁
export function selectTopMenu(menuId) {
    appState.currentActiveTopMenuId = menuId;
    if (typeof renderSidebarMenus === 'function') renderSidebarMenus();

    if (menuId === 'system_settings') {
        setTimeout(() => {
            const firstLeafEl = document.querySelector('#dynamic-sidebar-menus .menu-item:not([aria-expanded])');
            if (firstLeafEl) firstLeafEl.click();
        }, 50);
        return;
    }

    setTimeout(() => {
        // 直接檢查側邊欄是否有成功畫出任何項目 (代表有子選單)
        const hasSidebarItems = document.querySelectorAll('#dynamic-sidebar-menus .menu-item').length > 0;
        const firstLeafEl = document.querySelector('#dynamic-sidebar-menus .menu-item:not([aria-expanded])');

        if (!hasSidebarItems) {
            // 側邊欄沒有東西，代表這是一個獨立的主選單網頁，直接執行開啟動作
            const menus = getCustomMenus();
            const activeRoot = menus.find(m => window.cleanId(m.id || m.MenuId || m.menuId) === window.cleanId(menuId));

            if (activeRoot) {
                let mId = activeRoot.id || activeRoot.MenuId || activeRoot.menuId;
                let dName = activeRoot.displayName || activeRoot.DisplayName || activeRoot.sysName || activeRoot.SysName;
                let mMode = activeRoot.menuMode || activeRoot.MenuMode;
                let mUrl = activeRoot.url || activeRoot.Url;
                let mTarget = activeRoot.target || activeRoot.Target || activeRoot.openTarget || activeRoot.OpenTarget;
                let mTargetPage = activeRoot.targetPage || activeRoot.TargetPage;
                let isEdited = activeRoot.isEdited || activeRoot.IsEdited;

                if (typeof i18n !== 'undefined' && i18n[appState.currentLang] && i18n[appState.currentLang]['dyn_' + mId] && !isEdited) {
                    dName = i18n[appState.currentLang]['dyn_' + mId];
                }

                if (mMode === 'app_grid') openAppGridPage(mId, dName, null);
                else if (mUrl) {
                    // ⚠️ XSS 防護：window.open 對 `javascript:` URL 在 same-origin 下會執行；
                    //   先過 safeExternalUrl 把非 http(s)/相對路徑的危險 URL 全部阻斷
                    const safeUrl = (typeof window.safeExternalUrl === 'function') ? window.safeExternalUrl(mUrl) : mUrl;
                    if (safeUrl !== '#') {
                        if (mTarget === 'blank') {
                            window.open(safeUrl, '_blank', 'noopener,noreferrer');
                        } else if (mTarget === 'ie') {
                            openInIE(safeUrl);
                        } else if (mTarget === 'fullscreen') {
                            const w = screen.availWidth || window.screen.width || 1920;
                            const h = screen.availHeight || window.screen.height || 1080;
                            window.open(safeUrl, '_blank', `width=${w},height=${h},top=0,left=0,resizable=yes,scrollbars=yes,status=yes`);
                        } else if (mTarget === 'popup') {
                            const w = Math.min(1024, (screen.availWidth || 1280) - 100);
                            const h = Math.min(768, (screen.availHeight || 800) - 100);
                            const left = Math.round(((screen.availWidth || 1280) - w) / 2);
                            const top = Math.round(((screen.availHeight || 800) - h) / 2);
                            window.open(safeUrl, '_blank', `width=${w},height=${h},top=${top},left=${left},resizable=yes,scrollbars=yes,status=yes`);
                        } else if (mTarget === 'iframe_fullscreen') {
                            openDynamicIframe(safeUrl, dName, null, true);
                        } else {
                            openDynamicIframe(safeUrl, dName, null, false);
                        }
                    }
                }
                else if (mTargetPage) navTo(mTargetPage, null, dName);
                else {
                    let underConstructionPage = document.getElementById('page-under-construction');
                    const mainContent = document.getElementById('main-content');
                    if (!underConstructionPage) {
                        underConstructionPage = document.createElement('div');
                        underConstructionPage.id = 'page-under-construction';
                        underConstructionPage.className = 'page-section';
                        underConstructionPage.innerHTML = `<div class="manage-alert" id="under-construction-text"></div>`;
                        if (mainContent) mainContent.appendChild(underConstructionPage);
                    } else if (underConstructionPage.parentElement && underConstructionPage.parentElement.id !== 'main-content') {
                        if (mainContent) mainContent.appendChild(underConstructionPage);
                    }
                    const textEl = document.getElementById('under-construction-text');
                    if (textEl) textEl.innerText = `${dName} 內容建置中`;
                    navTo('page-under-construction', null, dName);
                }
            }
        } else if (firstLeafEl) {
            // 側邊欄有東西，代表這是一個群組，自動點擊群組內的第一個網頁
            firstLeafEl.click();
        }
    }, 50);
}

// ⭐️ 核心修復：點擊啟動特定看板 (加入對 DB 欄位大寫的全面支援)
export function activateMenu(menuId) {
    try {
        if (!menuId) {
            // ⭐️ 徹底封殺 page-home 迴圈，不顯示多餘的總覽
            return;
        }

        const menus = getCustomMenus();
        const targetMenu = menus.find(m => window.cleanId(m.id || m.MenuId || m.menuId) === window.cleanId(menuId));

        if (!targetMenu) {
            console.warn("🚨 無法在資料庫找到對應的選單 ID:", menuId);
            // ⭐️ 徹底封殺 page-home 迴圈
            return;
        }

        let rootId = targetMenu.id || targetMenu.MenuId || targetMenu.menuId;
        let currNode = targetMenu;
        while (currNode) {
            let pId = currNode.parentId || currNode.ParentMenuId || currNode.parentMenuId || (currNode.parentIds && currNode.parentIds.length > 0 ? currNode.parentIds[0] : null);
            let cPId = window.cleanId(pId);
            if (cPId && cPId !== 'null') {
                currNode = menus.find(m => window.cleanId(m.id || m.MenuId || m.menuId) === cPId);
                if (currNode) rootId = currNode.id || currNode.MenuId || currNode.menuId;
                else break;
            } else {
                break;
            }
        }

        appState.currentActiveTopMenuId = rootId;
        appState.currentActiveSidebarMenuId = menuId;

        if (typeof renderSidebarMenus === 'function') renderSidebarMenus();

        let mId = targetMenu.id || targetMenu.MenuId || targetMenu.menuId;
        let dName = targetMenu.displayName || targetMenu.DisplayName || targetMenu.sysName || targetMenu.SysName;
        let mMode = targetMenu.menuMode || targetMenu.MenuMode;
        let mUrl = targetMenu.url || targetMenu.Url;
        let mTarget = targetMenu.target || targetMenu.Target || targetMenu.openTarget || targetMenu.OpenTarget;
        let mTargetPage = targetMenu.targetPage || targetMenu.TargetPage;
        let isEdited = targetMenu.isEdited || targetMenu.IsEdited;

        if (typeof i18n !== 'undefined' && i18n[appState.currentLang] && i18n[appState.currentLang]['dyn_' + mId] && !isEdited) {
            dName = i18n[appState.currentLang]['dyn_' + mId];
        }

        const elList = document.querySelectorAll('.menu-item');
        let targetEl = null;
        elList.forEach(el => { if (el.getAttribute('onclick') && el.getAttribute('onclick').includes(mId)) targetEl = el; });

        if (mMode === 'app_grid') openAppGridPage(mId, dName, targetEl);
        else if (mUrl) {
            // 依 OpenTarget 區分：blank=另開分頁 / fullscreen=全螢幕 / 其他=畫面內嵌
            // ⚠️ XSS 防護：先過 safeExternalUrl
            const safeUrl = (typeof window.safeExternalUrl === 'function') ? window.safeExternalUrl(mUrl) : mUrl;
            if (safeUrl !== '#') {
                if (mTarget === 'blank') {
                    window.open(safeUrl, '_blank', 'noopener,noreferrer');
                } else if (mTarget === 'ie') {
                    openInIE(safeUrl);
                } else if (mTarget === 'fullscreen') {
                    const w = screen.availWidth || window.screen.width || 1920;
                    const h = screen.availHeight || window.screen.height || 1080;
                    window.open(safeUrl, '_blank', `width=${w},height=${h},top=0,left=0,resizable=yes,scrollbars=yes,status=yes`);
                } else if (mTarget === 'popup') {
                    const w = Math.min(1024, (screen.availWidth || 1280) - 100);
                    const h = Math.min(768, (screen.availHeight || 800) - 100);
                    const left = Math.round(((screen.availWidth || 1280) - w) / 2);
                    const top = Math.round(((screen.availHeight || 800) - h) / 2);
                    window.open(safeUrl, '_blank', `width=${w},height=${h},top=${top},left=${left},resizable=yes,scrollbars=yes,status=yes`);
                } else if (mTarget === 'iframe_fullscreen') {
                    openDynamicIframe(safeUrl, dName, targetEl, true);
                } else {
                    openDynamicIframe(safeUrl, dName, targetEl, false);
                }
            }
        }
        else if (mTargetPage) {
            navTo(mTargetPage, targetEl, dName);
        } else {
            let underConstructionPage = document.getElementById('page-under-construction');
            const mainContent = document.getElementById('main-content');
            if (!underConstructionPage) {
                underConstructionPage = document.createElement('div');
                underConstructionPage.id = 'page-under-construction';
                underConstructionPage.className = 'page-section';
                underConstructionPage.innerHTML = `<div class="manage-alert" id="under-construction-text"></div>`;
                if (mainContent) mainContent.appendChild(underConstructionPage);
            } else if (underConstructionPage.parentElement && underConstructionPage.parentElement.id !== 'main-content') {
                if (mainContent) mainContent.appendChild(underConstructionPage);
            }
            const textEl = document.getElementById('under-construction-text');
            if (textEl) textEl.innerText = `${dName} 內容建置中`;
            navTo('page-under-construction', targetEl, dName);
        }
    } catch (error) {
        console.error("🚨 啟動看板時發生錯誤:", error);
    }
}

// ⭐ 以 IE 開啟網址（開啟方式 target === 'ie'）：供含 ActiveX 等舊元件、Edge/Chrome 無法正常顯示的老網頁。
//   實作：導向自訂協定「ie:<完整URL>」交給本機協定處理器啟動 iexplore ——
//   客戶端需「一次性」匯入 /tools/install-ie-protocol.reg 註冊協定（企業可用 GPO 派送整批安裝）。
//   未註冊協定時瀏覽器會靜默忽略（不導航、不報錯），頁面停在原地不受影響。
//   ⚠️ 呼叫端必須先過 safeExternalUrl（與 blank 分支同層防護），本函式不重複驗證。
export function openInIE(url) {
    try {
        // 相對路徑／無 scheme 網址先絕對化（協定處理器收到的必須是完整 URL；
        //   解析行為與 blank 分支的 window.open 相對解析一致）
        let abs = url;
        try { abs = new URL(url, window.location.href).href; } catch (e) { /* 解析失敗保留原值 */ }
        window.location.href = 'ie:' + abs;
    } catch (e) {
        console.error('IE 協定呼叫失敗:', e);
    }
}
window.openInIE = openInIE;

// ⭐️ 對齊 TEST_20260429.html:3496 的預設首頁跳轉（含廠區過濾、folder 自動取第一個子節點）
export function goDefaultHome() {
    try {
        if (!appState.currentUser) return;

        let defPage = null;

        // 1. 優先使用該帳號在目前廠區設定的專屬首頁
        if (appState.currentUser.defaultPages && appState.currentUser.defaultPages[appState.currentFab]) {
            defPage = appState.currentUser.defaultPages[appState.currentFab];
        } else if (appState.currentUser.defaultPage) {
            defPage = appState.currentUser.defaultPage; // 向下相容舊資料
        }

        const menus = getCustomMenus() || [];
        const validList = appState._currentValidMenus || [];

        const _isFolder = (m) => !!m && String(m.menuMode || m.MenuMode || '').toLowerCase() === 'folder';
        const _isOpenable = (m) => !!m && !!(m.url || m.Url || m.targetPage || m.TargetPage || (m.menuMode || m.MenuMode) === 'app_grid');
        // ⭐ 預設頁若指向「資料夾」（管理者在挑選器把整個群組指定為預設）→ 自動往下展開到第一個可開啟的子看板，
        //    避免登入落在資料夾空殼（activateMenu 對 folder 會顯示「內容建置中」）。只在「可見」(validList) 的
        //    子節點中找，優先挑可直接開啟者；找不到可開啟者就鑽進第一個子資料夾繼續展開。
        const _resolveFolderToFirstLeaf = (folderId) => {
            let curId = window.cleanId(folderId), guard = 0;
            while (guard++ < 100) {
                const node = menus.find(m => window.cleanId(m.id || m.MenuId) === curId);
                if (!node || !_isFolder(node)) return curId;
                let children = validList.filter(m =>
                    window.cleanId(m.parentId || m.ParentMenuId) === curId ||
                    (m.parentIds || []).map(window.cleanId).includes(curId)
                );
                if (children.length === 0) return curId;
                children.sort((a, b) => {
                    const oa = (a.parentOrders && a.parentOrders[curId] != null) ? a.parentOrders[curId] : (a.order || a.GlobalOrder || 0);
                    const ob = (b.parentOrders && b.parentOrders[curId] != null) ? b.parentOrders[curId] : (b.order || b.GlobalOrder || 0);
                    return oa - ob;
                });
                const next = children.find(_isOpenable) || children[0];
                curId = window.cleanId(next.id || next.MenuId);
            }
            return curId;
        };

        // 2. 未設定 → 依目前廠區 fab.assignedRoles 與帳號 assignedRoles 的交集，找出該帳號可看的第一個 root
        if (!defPage) {
            const currentFabObj = getFabs().find(f => window.cleanId(f.fabName || f.FabName) === window.cleanId(appState.currentFab));
            if (currentFabObj) {
                const fabRoleIds = currentFabObj.assignedRoles || currentFabObj.AssignedRoles || [];
                const userRoleIds = appState.currentUser.assignedRoles || appState.currentUser.AssignedRoles || [];
                const activeRoleIds = fabRoleIds.filter(id => userRoleIds.some(uId => window.cleanId(uId) === window.cleanId(id)));

                const roles = getRoles();
                let initialMenuIds = [];
                activeRoleIds.forEach(roleId => {
                    const role = roles.find(r => window.cleanId(r.id || r.RoleId) === window.cleanId(roleId));
                    if (role && (role.allowedMenuIds || role.AllowedMenuIds)) {
                        initialMenuIds.push(...(role.allowedMenuIds || role.AllowedMenuIds));
                    }
                });

                const allowedIds = typeof window.getAllowedIdsWithHierarchy === 'function'
                    ? window.getAllowedIdsWithHierarchy(menus, initialMenuIds)
                    : new Set(initialMenuIds);

                // 找出第一層 root（非 pool、無父節點、啟用、且在 allowedIds 中）
                let validRoots = menus.filter(m =>
                    m.isPoolItem === false &&
                    !m.parentId &&
                    (!m.parentIds || m.parentIds.length === 0) &&
                    m.enabled !== false &&
                    allowedIds.has(m.id)
                );

                // 依群組權限指定的順序排序
                validRoots.sort((a, b) => {
                    let idxA = initialMenuIds.indexOf(a.id);
                    let idxB = initialMenuIds.indexOf(b.id);
                    return (idxA === -1 ? 9999 : idxA) - (idxB === -1 ? 9999 : idxB);
                });

                if (validRoots.length > 0) {
                    let firstRoot = validRoots[0];
                    // root 若為 folder，自動取其下第一個子看板，避免顯示空殼
                    if (firstRoot.menuMode === 'folder') {
                        let children = menus.filter(m =>
                            m.parentId === firstRoot.id ||
                            (m.parentIds && m.parentIds.includes(firstRoot.id))
                        );
                        children.sort((a, b) =>
                            (a.parentOrders && a.parentOrders[firstRoot.id] != null ? a.parentOrders[firstRoot.id] : (a.order || 0)) -
                            (b.parentOrders && b.parentOrders[firstRoot.id] != null ? b.parentOrders[firstRoot.id] : (b.order || 0))
                        );
                        defPage = children.length > 0 ? children[0].id : firstRoot.id;
                    } else {
                        defPage = firstRoot.id;
                    }
                }
            }
        }

        // 2.5 預設頁指向資料夾 → 展開到第一個可開啟子看板（管理者可把整個群組設為預設首頁）
        if (defPage) {
            const _defObj = menus.find(m => window.cleanId(m.id || m.MenuId) === window.cleanId(defPage));
            if (_isFolder(_defObj)) {
                const _resolved = _resolveFolderToFirstLeaf(defPage);
                const _resObj = menus.find(m => window.cleanId(m.id || m.MenuId) === window.cleanId(_resolved));
                defPage = (_resObj && !_isFolder(_resObj)) ? _resolved : null; // 仍是資料夾(空) → 交給下方防呆
            }
        }

        // 3. 終極防呆：仍找不到或合法權限已被拔除 → 從安全過濾後的清單尋找
        if (!defPage || !validList.find(m => window.cleanId(m.id) === window.cleanId(defPage))) {
            let firstVisible = validList.find(m => (m.menuMode || '').toLowerCase() !== 'folder');
            if (firstVisible) defPage = firstVisible.id;
            else defPage = null; // ⭐️ 安全防護：無可用看板時寧可空白，避免越權顯示
        }

        if (defPage) activateMenu(defPage);
        else navTo('page-unauthorized'); // ⭐️ 此廠區無任何可視看板 → 導向中性「空狀態」頁（非「無權限」警示）。
        //    上方導覽列本就因 renderSidebarMenus 沒有 root 而自然留空；此處只是讓內容區顯示中性提示而非空白/警示，
        //    避免使用者誤以為系統出錯或資料遺失（廠區能被切到＝已有可存取角色，零看板＝尚未配置看板而非權限問題）。

    } catch (error) {
        console.error("🚨 導向預設首頁時發生錯誤:", error);
    }
}

// 導航到指定區域塊
export function navTo(pageId, element, subTitle = '') {
    document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
    if (element) element.classList.add('active');
    document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
    const targetPage = document.getElementById(pageId);
    if (targetPage) targetPage.classList.add('active');
    document.body.classList.remove('fullscreen-mode');

    if (pageId === 'page-iframe') {
        document.body.classList.add('iframe-mode');
    } else {
        document.body.classList.remove('iframe-mode');
    }

    const bcPath = document.getElementById('bc-path');
    const bcName = document.getElementById('bc-name');
    if (bcPath && bcName) {
        if (pageId === 'page-home') {
            bcPath.style.display = 'none';
            bcName.innerText = t('nav_breadcrumb_home', '首頁總覽');
        } else {
            let topName = getTopMenuName();
            let folderPath = element ? getMenuPath(element) : '';

            let finalPathArr = [];
            if (topName) finalPathArr.push(topName);
            if (folderPath) finalPathArr.push(folderPath);

            if (finalPathArr.length > 0) {
                bcPath.style.display = 'inline';
                bcPath.innerText = finalPathArr.join(' / ') + ' / ';
            } else {
                bcPath.style.display = 'none';
            }

            let elName = element ? (element.querySelector('span')?.innerText || element.innerText.trim()) : '';
            bcName.innerText = subTitle || elName || '';
        }
    }

    if (pageId === 'page-personal-manage' && typeof renderPersonalMenuManage === 'function') renderPersonalMenuManage();
    if (pageId === 'page-webpage-manage' && typeof renderWebpageTable === 'function') renderWebpageTable();
    if (pageId === 'page-menu-manage' && typeof renderMenuConfigTable === 'function') renderMenuConfigTable();
    if (pageId === 'page-fab-manage' && typeof renderFabTable === 'function') renderFabTable();
    if (pageId === 'page-role-manage' && typeof renderRoleTable === 'function') renderRoleTable();
    if (pageId === 'page-account-manage' && typeof renderAccountTable === 'function') renderAccountTable();
    if (pageId === 'page-apply' && typeof renderApplyTable === 'function') renderApplyTable();
    if (pageId === 'page-audit-manage' && typeof renderAuditTable === 'function') renderAuditTable();
    if (pageId === 'page-activity-log' && typeof loadActivityLogs === 'function') loadActivityLogs();
    if (pageId !== 'page-app-grid') appState.currentAppGridMenuId = null;
}

export function openDynamicIframe(url, title, element, isFullscreen = false) {
    if (!url) return;
    navTo('page-iframe', element, title);
    const iframe = document.getElementById('main-iframe');
    iframe.removeAttribute('srcdoc');

    let finalUrl = url;
    if (!finalUrl.includes('fab=')) {
        finalUrl = finalUrl.includes('?') ? `${finalUrl}&fab=${appState.currentFab}` : `${finalUrl}?fab=${appState.currentFab}`;
    }
    if (!/^https?:\/\//i.test(finalUrl) && !finalUrl.startsWith('/') && !finalUrl.startsWith('page-')) {
        finalUrl = 'http://' + finalUrl;
    }

    // ⚠️ 動態 sandbox：對 same-origin URL 維持原配置（內部看板需要 cookie/storage 才能用）；
    //   對 cross-origin URL 移除 allow-same-origin，避免外部頁面可以透過 parent.document 操作本站 DOM。
    //   (Round-5 修：原本 HTML 固定 sandbox 含 allow-scripts + allow-same-origin，外部站台 = 沒 sandbox)
    try {
        const parsed = new URL(finalUrl, window.location.href);
        const isSameOrigin = parsed.origin === window.location.origin;
        iframe.setAttribute('sandbox', isSameOrigin
            ? 'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads'
            : 'allow-scripts allow-forms allow-popups allow-downloads');
    } catch (e) {
        // URL 解析失敗 (例如 page-xxx 偽 URL) → 保留 default sandbox
    }

    iframe.src = finalUrl;
    if (isFullscreen) document.body.classList.add('fullscreen-mode');
    else document.body.classList.remove('fullscreen-mode');
}

// 產生 Icon 的 HTML (共用)

// Expose for HTML inline handlers
window.changeLanguage = changeLanguage;
window.renderLangSwitcher = renderLangSwitcher;
window.getTopMenuName = getTopMenuName;
window.getMenuPath = getMenuPath;
window.getFullMenuPathStr = getFullMenuPathStr;
window.selectTopMenu = selectTopMenu;
window.activateMenu = activateMenu;
window.goDefaultHome = goDefaultHome;
window.navTo = navTo;
window.openDynamicIframe = openDynamicIframe;

