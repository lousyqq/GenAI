import { appState } from './store.js?v=20260607k';
import './config.js?v=20260719';
import './api.js?v=20260607h';
import './auth.js?v=20260607h';
import './ui/layout.js?v=20260607h';
import './ui/navigation.js?v=20260719';
import './ui/dialogs.js?v=20260607h';
import './render/sidebar.js?v=20260719';
import './render/sidebar-item.js?v=20260607h';
import './render/tables.js?v=20260719';
import './render/account-ui.js?v=20260607h';
import './admin/modal-utils.js?v=20260607h';
import './admin/fab-manage.js?v=20260607h';
import './admin/role-manage.js?v=20260607h';
import './admin/account-manage.js?v=20260607h';
import './admin/menu-manage.js?v=20260607h';
import './admin/misc-manage.js?v=20260607h';
import './admin/activity-log.js?v=20260607h';
import './admin/stats-ui.js?v=20260719';

export function initModalSafely(id) { const el = document.getElementById(id); return el ? new bootstrap.Modal(el) : null; }

export function initDashboardUI(stayOnCurrentPage = false) {
    if (!appState.currentUser) return;

    // 廠區固定為單一 12A（切換 UI 已移除）；語言固定繁中，不再依廠區切換。
    if (typeof getFabs === 'function') {
        const fabs = getFabs();
        if (fabs.length > 0) {
            let currentFabVal = typeof appState.currentFab !== 'undefined' ? appState.currentFab : '';
            const exists = fabs.find(f =>
                String(f.id || '').toLowerCase() === String(currentFabVal).toLowerCase() ||
                String(f.fabName || '').toLowerCase() === String(currentFabVal).toLowerCase()
            );
            appState.currentFab = exists ? exists.fabName : fabs[0].fabName;
        }
    }

    if (typeof renderAccountTable === 'function') renderAccountTable();
    if (typeof renderSidebarMenus === 'function') renderSidebarMenus();
    // 原本由 changeLanguage() 兼職觸發首頁儀表板/右上角使用者資訊重繪；語言固定後改為直接呼叫
    if (typeof renderHomeDashboard === 'function') renderHomeDashboard();
    if (typeof switchLayoutMode === 'function') switchLayoutMode('system');
    if (!stayOnCurrentPage) {
        if (typeof window.goDefaultHome === 'function') window.goDefaultHome();
    }
    if (typeof window.pingSiteVisitor === 'function') {
        setTimeout(() => window.pingSiteVisitor(), 1500);
    }
}

export async function pingSiteVisitor() {
    try {
        const empId = appState.currentUser ? (appState.currentUser.empId || appState.currentUser.id) : null;
        const empName = appState.currentUser ? appState.currentUser.name : null;
        const dept = appState.currentUser ? appState.currentUser.department : null;

        await fetch(window.toAppUrl('/api/Stats/Ping'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ empId, empName, department: dept }),
            credentials: 'same-origin'
        });
    } catch (e) {
        console.warn('背景流量統計心跳 (Stats/Ping) 異常，不影響操作:', e);
    }
}
window.pingSiteVisitor = pingSiteVisitor;

async function waitForTryAutoLogin(timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (typeof window.tryAutoLogin === 'function') return true;
        await new Promise(r => setTimeout(r, 50));
    }
    return false;
}

// 還原 localStorage 已有的 appState.currentUser；若沒有則 return false（讓 tryAutoLogin 接手）
export function restoreLoginFromStorage() {
    const storedUser = localStorage.getItem('umc_current_user');
    if (!storedUser || storedUser === 'null' || storedUser === 'undefined') return false;

    try {
        let tempUser = JSON.parse(storedUser);

        // ⚠️ slimUser 存進去的鍵叫 `empId`，舊程式碼讀成 tempUser.id 永遠是 undefined。
        //   後果：find 永遠回 undefined → 誤判帳號被刪除 → 假警告 + 強制重新登入 +
        //   重新登入後 appState.currentUser.id 是 undefined → sidebar.js 用 appState.currentUser.id 做權限判定全錯
        //   → 上方導覽列空白要等使用者匯入 excel 才復原。
        //   修法：empId 為主、id 為相容備援。
        const storedEmpId = tempUser.empId || tempUser.id || '';
        // 順手補回 id 欄位讓下游用 appState.currentUser.id 的程式碼能正常 (sidebar.js getMenuPermissions 等)
        if (!tempUser.id) tempUser.id = storedEmpId;

        if (typeof getAccounts === 'function') {
            let freshAcc = getAccounts().find(a => String(a.empId).toLowerCase() === String(storedEmpId).toLowerCase());
            if (freshAcc) {
                tempUser.roleLevel = freshAcc.roleLevel;
                tempUser.assignedRoles = freshAcc.assignedRoles || [];
                tempUser.manageableMenus = freshAcc.manageableMenus || [];
                tempUser.canEditOthers = freshAcc.canEditOthers || false;
                tempUser.defaultPages = freshAcc.defaultPages || {};
                tempUser.loginCount = typeof freshAcc.loginCount === 'number' ? freshAcc.loginCount : parseInt(freshAcc.loginCount) || 0;
                tempUser.lastLoginTime = freshAcc.lastLoginTime || null;
            } else {
                // 若本地 accounts 還未同步該帳號（例如模擬新帳號初次進站、或 AutoProvision 自動開戶中），
                // 優先保留 localStorage 既有身分並立即回傳 true 讓 UI 即時渲染上方導覽與工號，
                // 稍後背景執行的 tryAutoLogin -> WhoAmI / completeLoginAfterAuth 會無縫補齊並更新最新 DB 資料。
                tempUser.roleLevel = tempUser.roleLevel || 'user';
                tempUser.assignedRoles = tempUser.assignedRoles || [];
                tempUser.manageableMenus = tempUser.manageableMenus || [];
                tempUser.loginCount = tempUser.loginCount || 1;
            }
        }

        appState.currentUser = tempUser;
        localStorage.setItem('umc_current_user', JSON.stringify(appState.currentUser));

        const nameEl = document.getElementById('user-name');
        if (nameEl) nameEl.innerText = appState.currentUser.id || appState.currentUser.empId || '';
        return true;
    } catch (e) {
        appState.currentUser = null;
        return false;
    }
}

// 靜默攔截 VS Browser Link / dev tools 注入腳本的雜訊；不再盲吞 `toLowerCase` 錯誤 (Round-5)
//   舊版「msg.includes('toLowerCase')」會把真正的 root cause bug 也吞掉、永遠找不到。
//   現在只攔 browserLink 來源的錯誤；其餘讓它正常拋。
window.addEventListener('error', function (event) {
    const src = event.filename || '';
    if (src.includes('browserLink')) {
        event.preventDefault();
        event.stopImmediatePropagation();
    }
}, true);

// 全域事件委派 (Event Delegation) 處理 data-action，防止 XSS
document.addEventListener('click', function(e) {
    const toggleSubMenuBtn = e.target.closest('[data-action="toggle-submenu"]');
    if (toggleSubMenuBtn) {
        if (typeof window.toggleSubMenu === 'function') window.toggleSubMenu(e, toggleSubMenuBtn.getAttribute('data-target'), toggleSubMenuBtn);
        return;
    }
    const activateBtn = e.target.closest('[data-action="activate-menu"]');
    if (activateBtn) {
        if (typeof window.activateMenu === 'function') window.activateMenu(activateBtn.getAttribute('data-id'));
        return;
    }
    const openUrlBtn = e.target.closest('[data-action="open-url"]');
    if (openUrlBtn) {
        let url = openUrlBtn.getAttribute('data-url');
        let target = openUrlBtn.getAttribute('data-target') || 'blank';
        // ⚠️ 改用 safeExternalUrl：舊版只擋 startsWith('javascript:')，會被 `\tjavascript:` / `data:text/html` 等繞過
        const safe = (typeof window.safeExternalUrl === 'function') ? window.safeExternalUrl(url) : url;
        if (safe && safe !== '#') {
            if (target === 'fullscreen') {
                const w = screen.availWidth || window.screen.width || 1920;
                const h = screen.availHeight || window.screen.height || 1080;
                window.open(safe, '_blank', `width=${w},height=${h},top=0,left=0,resizable=yes,scrollbars=yes,status=yes`);
            } else if (target === 'popup') {
                const w = Math.min(1024, (screen.availWidth || 1280) - 100);
                const h = Math.min(768, (screen.availHeight || 800) - 100);
                const left = Math.round(((screen.availWidth || 1280) - w) / 2);
                const top = Math.round(((screen.availHeight || 800) - h) / 2);
                window.open(safe, '_blank', `width=${w},height=${h},top=${top},left=${left},resizable=yes,scrollbars=yes,status=yes`);
            } else {
                window.open(safe, '_blank', 'noopener,noreferrer');
            }
        }
        return;
    }
    const openIeBtn = e.target.closest('[data-action="open-ie"]');
    if (openIeBtn) {
        let url = openIeBtn.getAttribute('data-url');
        // 與 open-url 同層 XSS 防護：先過 safeExternalUrl 再交給 IE 協定
        const safeIe = (typeof window.safeExternalUrl === 'function') ? window.safeExternalUrl(url) : url;
        if (safeIe && safeIe !== '#' && typeof window.openInIE === 'function') {
            window.openInIE(safeIe);
        }
        return;
    }
    const openIframeBtn = e.target.closest('[data-action="open-iframe"]');
    if (openIframeBtn) {
        let url = openIframeBtn.getAttribute('data-url');
        let name = openIframeBtn.getAttribute('data-name');
        let target = openIframeBtn.getAttribute('data-target') || 'iframe';
        const safeIfr = (typeof window.safeExternalUrl === 'function') ? window.safeExternalUrl(url) : url;
        if (safeIfr && safeIfr !== '#') {
            const isFull = (target === 'iframe_fullscreen');
            if (typeof window.openDynamicIframe === 'function') window.openDynamicIframe(safeIfr, name, null, isFull);
        }
        return;
    }
    const editAppBtn = e.target.closest('[data-action="edit-app"]');
    if (editAppBtn) {
        e.stopPropagation();
        if (typeof window.openAppGridModal === 'function') window.openAppGridModal(editAppBtn.getAttribute('data-id'));
        return;
    }
    const deleteAppBtn = e.target.closest('[data-action="delete-app"]');
    if (deleteAppBtn) {
        e.stopPropagation();
        if (typeof window.deleteAppItem === 'function') window.deleteAppItem(deleteAppBtn.getAttribute('data-id'));
        return;
    }
    const addAppBtn = e.target.closest('[data-action="add-app"]');
    if (addAppBtn) {
        if (typeof window.openAppGridModal === 'function') window.openAppGridModal();
        return;
    }
});

document.addEventListener("DOMContentLoaded", async () => {
    // console.log("正在從資料庫載入資料...");
    const loadingOverlay = document.createElement('div');
    loadingOverlay.id = 'db-loading-overlay';
    loadingOverlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:9999; display:flex; flex-direction:column; justify-content:center; align-items:center; color:white; font-family:sans-serif;';
    loadingOverlay.innerHTML = '<div class="spinner-border text-info mb-3" style="width: 3rem; height: 3rem;" role="status"></div><h2>系統初始化中...</h2><p class="text-secondary">正在與資料庫連線同步資料</p>';
    document.body.appendChild(loadingOverlay);

    // Round-5 B13：fetchInitialDataFromDB 卡住 (DB 連線失敗 / 後端 hang) → loading 螢幕會永遠不收。
    //   15 秒 timeout，若還在顯示就把 spinner 換成錯誤訊息 + 重新整理按鈕，避免使用者乾瞪眼。
    const loadingTimeoutId = setTimeout(() => {
        if (document.body.contains(loadingOverlay)) {
            loadingOverlay.innerHTML = '<i class="fas fa-exclamation-triangle text-warning mb-3" style="font-size: 4rem;"></i>'
                + '<h3 class="text-warning">資料庫連線逾時</h3>'
                + '<p class="text-secondary mb-4">後端在 15 秒內沒有回應，可能是 DB 連線異常或網路問題。</p>'
                + '<button class="btn btn-info fw-bold px-4" onclick="location.reload()"><i class="fas fa-sync-alt me-2"></i>重新整理</button>';
        }
    }, 15000);

    try {
        let isDbLoaded = false;
        if (typeof fetchInitialDataFromDB === 'function') {
            // 冷啟動（尚無有效 cookie）時 GetInitialData 必然 401 → console 留下失敗噪音 + 一次無效重查詢。
            //   先用輕量 MyProfile 探測登入態：有效才抓 InitialData；無效直接走下方 tryAutoLogin，
            //   登入完成後 completeLoginAfterAuth 會自行補抓 InitialData（auth.js 已有該邏輯）。
            const probeUrl = window.toAppUrl ? window.toAppUrl('/api/Auth/MyProfile') : '/api/Auth/MyProfile';
            const authProbe = await fetch(`${probeUrl}?_t=${Date.now()}`, { cache: 'no-store', headers: { 'Pragma': 'no-cache', 'Cache-Control': 'no-cache' } }).catch(() => null);
            if (authProbe && authProbe.ok) {
                isDbLoaded = await fetchInitialDataFromDB();
            }
        }

        // ⭐️ 延後移除黑色 loading 遮罩：避免過早移除造成 WhoAmI 偵測期間畫面閃動或跳出登入視窗 (Zero FOUC)
        window.removeDbLoadingOverlay = function() {
            const ov = document.getElementById('db-loading-overlay');
            if (ov) ov.remove();
        };

        initModalInstances();

        if (isDbLoaded) {
            // 1) 有 DB 資料時，嘗試還原 localStorage 中既有的 appState.currentUser
            const restored = restoreLoginFromStorage();
            if (restored) {
                initDashboardUI();
                // ✅ 主畫面已經準備就緒，此時才移除黑色載入遮罩
                window.removeDbLoadingOverlay();
                // 即使從 localStorage 還原了快取帳號，依然需要向伺服器驗證當前桌機 Windows 身分 (WhoAmI)；
                // 如果桌機帳號已改變 (例如從 00058896 切換回 yu-ting)，會自動更新 localStorage 並刷新頁面。
                waitForTryAutoLogin(5000).then(ready => { if (ready) window.tryAutoLogin(); });
            } else {
                const ready = await waitForTryAutoLogin(5000);
                if (ready) {
                    await window.tryAutoLogin();
                } else {
                    console.error('tryAutoLogin 尚未載入（auth.js 載入順序/路徑可能有問題）');
                    window.removeDbLoadingOverlay();
                    if (typeof showLoginOverlay === 'function') showLoginOverlay('windows');
                }
            }
        } else {
            // 2) 無 DB 資料 (可能為 401 未登入)，保留載入遮罩一路等到 tryAutoLogin / WhoAmI 完成
            const ready = await waitForTryAutoLogin(5000);
            if (ready) {
                await window.tryAutoLogin();
            } else {
                console.error('tryAutoLogin 尚未載入（auth.js 載入順序/路徑可能有問題）');
                window.removeDbLoadingOverlay();
                if (typeof showLoginOverlay === 'function') showLoginOverlay('windows');
            }
        }
    } catch (error) {
        clearTimeout(loadingTimeoutId);
        if (!document.body.contains(loadingOverlay)) document.body.appendChild(loadingOverlay);
        loadingOverlay.innerHTML = '<i class="fas fa-times-circle text-danger" style="font-size: 4rem; margin-bottom: 20px;"></i><h2 class="text-danger">系統發生非預期錯誤</h2><p class="fs-5">' + error.message + '</p><div class="text-warning text-start" style="max-width:800px; overflow:auto; max-height:300px;"><pre>' + error.stack + '</pre></div>';
    }
});

function initModalInstances() {
    // ⭐️ 致命錯誤修復：完整補齊所有遺失的 Modal 宣告，這樣點擊編輯按鈕才會彈出視窗！
    if (typeof bootstrap !== 'undefined') {
        appState.modals.fab = initModalSafely('fabModal');
        appState.modals.role = initModalSafely('roleModal');
        appState.modals.acc = initModalSafely('accModal');
        appState.modals.webpage = initModalSafely('webpageModal');
        appState.modals.menuNode = initModalSafely('menuNodeModal');
        appState.modals.personalMenu = initModalSafely('personalMenuModal');
        appState.modals.appGrid = initModalSafely('appGridModal');
        appState.systemAlertModalObj = initModalSafely('systemAlertModal');
        appState.systemConfirmModalObj = initModalSafely('systemConfirmModal');
    }
}