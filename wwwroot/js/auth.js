// === auth.js - 雙模式登入流程：Windows 自動偵測 + 手動帳密 ===
// 公開全域：
//   window.tryAutoLogin()    - 主流程進入點 (main.js DOMContentLoaded 會呼叫)
//   window.doWindowsLogin()  - 「以此身份進入」按鈕
//   window.doLogin()         - 手動 tab 的 submit
//   window.retryWhoAmI()     - 「重試偵測」按鈕
//   window.logout()          - 右上頭像下拉的登出

import { getAccounts } from './config.js?v=20260719';
import { fetchInitialDataFromDB } from './api.js?v=20260607k';
import { initDashboardUI, restoreLoginFromStorage } from './main.js?v=20260719';
import { customAlert } from './ui/dialogs.js?v=20260607k';
import { appState } from './store.js?v=20260607k';


// 「使用者主動登出 → 別再自動登入」旗標
//   ⚠️ 改用 sessionStorage（不是 localStorage）— 只在「同一個 tab 內 logout 後的下一次重整」生效。
//   關閉 tab / 開新 tab → flag 自動清掉 → 視為新 session、再次自動偵測登入。
//   這對齊使用者需求：「直接輸入網址 → 自動偵測為主；除非剛剛 logout 才停留在登入頁讓我切換」。
const FORCE_MANUAL_KEY = 'umc_force_manual_login';

// 暫存 whoami 結果（給 doWindowsLogin 用，避免再打一次 API）
let _whoamiResult = null;

// 防 auto-login 同時被觸發多次（fetchWhoAmI 可能從 tryAutoLogin / tab 切換 / 重試按鈕 三處呼叫）
let _autoLoginInProgress = false;

// =============================================================
// 0) 取得後端 Auth 設定 (allowManualLogin 等)；UI 依此決定要不要藏掉手動 tab
// =============================================================
window._authConfig = { allowManualLogin: true };  // 預設值，fetch 失敗時退回 true
window._csrfToken = null;

export async function fetchAuthConfig() {
    try {
        const csrfResp = await fetch('/api/Auth/CsrfToken', { credentials: 'include' });
        if (csrfResp.ok) {
            const csrfData = await csrfResp.json();
            window._csrfToken = csrfData.token;
        }
    } catch (e) { console.warn('CsrfToken 取得失敗:', e); }

    try {
        const resp = await fetch('/api/Auth/Config', { credentials: 'include' });
        if (resp.ok) {
            const c = await resp.json();
            if (c) window._authConfig = { allowManualLogin: c.allowManualLogin !== false };
        }
    } catch (e) { console.warn('Auth/Config 失敗:', e); }
    applyAuthConfigToUI(window._authConfig);
    return window._authConfig;
}

export function applyAuthConfigToUI(config) {
    const manualTabBtn = document.getElementById('tab-manual');
    const manualTabLi = manualTabBtn ? manualTabBtn.closest('li') : null;
    const winTabBtn = document.getElementById('tab-windows');
    if (!config.allowManualLogin) {
        // 藏掉手動 tab，強制使用 Windows 自動偵測
        if (manualTabLi) manualTabLi.style.display = 'none';
        if (winTabBtn && window.bootstrap?.Tab) {
            try { bootstrap.Tab.getOrCreateInstance(winTabBtn).show(); } catch (e) { }
        }
    } else {
        if (manualTabLi) manualTabLi.style.display = '';
    }
}

// =============================================================
// 1) 主進入點：先抓 config → 嘗試 whoami → 能自動就自動，不能就顯示登入框
// =============================================================
export async function tryAutoLogin() {
    const config = await fetchAuthConfig();
    // FORCE_MANUAL_KEY 改用 sessionStorage（不是 localStorage）— 上方變數註解有說明
    //   同時清掉 localStorage 上舊版可能殘留的旗標，避免使用者升級後第一次仍卡 manual
    try { localStorage.removeItem(FORCE_MANUAL_KEY); } catch (e) { }
    // allowManualLogin=false（純自動偵測模式）時，FORCE_MANUAL_KEY 失去意義：
    //   它原本是「logout 後本 tab 第一次重整停留在 manual」用的，但無 manual 可停留。
    //   若不清掉，logout 設下的旗標會永久殘留 → fetchWhoAmI 的 auto-login 閘門
    //   （要求 FORCE_MANUAL_KEY !== '1'）永遠被擋 → 每次進站都卡在「以此身份進入」需手動點。
    //   故在此模式下一律先清掉，讓自動登入得以進行（除非帳號無權限，見下方 fetchWhoAmI）。
    if (!config.allowManualLogin) {
        try { sessionStorage.removeItem(FORCE_MANUAL_KEY); } catch (e) { }
    }
    const forceManual = sessionStorage.getItem(FORCE_MANUAL_KEY) === '1';

    if (forceManual && config.allowManualLogin) {
        // logout 後同 tab 內的第一次重整 → 停留在 manual tab 讓使用者切換帳號
        showLoginOverlay('manual');
        sessionStorage.removeItem(FORCE_MANUAL_KEY); // 清掉，下次重整就走自動偵測
        return false;
    }

    // 自動偵測；fetchWhoAmI 內部成功時會自動觸發 completeLoginAfterAuth（不需要外層再呼叫）
    //   ⚠️ 只有「初次進入點」(tryAutoLogin) 才允許自動登入 → 對齊「直接輸入網址=自動偵測為主」。
    //      其餘呼叫 (tab 切換 / 重試 / overlay 內部) 一律 allowAutoLogin=false：只顯示偵測結果 + 啟用
    //      「以此身份進入」按鈕，讓使用者在登入框內主動選擇，不會「點一下自動偵測 tab 就被登入」。
    const whoamiData = await fetchWhoAmI(true);

    // 若 fetchWhoAmI 內已成功 auto-login，appState.currentUser 已被設置
    if (appState.currentUser) return true;

    // ⚡ B2 修正：WhoAmI 完成後若帳號無效（刪除、無權限）且頁面上有殘留 localStorage 快取身分，
    //   必須優雅清除快取，避免被刪帳號的使用者能永久停留在頁面（後端所有 [Authorize] API 會 403，
    //   但 UI 仍會正常渲染造成混淆）。只在 whoamiData 明確回傳 success:false 才清除，
    //   網路斷線 / 逾時等場景（data.success undefined）不清除，避免誤殺。
    if (whoamiData && whoamiData.success === false && appState.currentUser) {
        // WhoAmI 明確表示此身分無效 → 清除快取並踢到登入畫面
        appState.currentUser = null;
        try { localStorage.removeItem('umc_current_user'); } catch (e) { }
    }

    // 自動偵測失敗 / 拿到工號但無權限 → 顯示登入框
    //   allowManualLogin=false 時，使用者只能按重試或請聯絡管理員
    showLoginOverlay('windows');
    return false;
}
window.tryAutoLogin = tryAutoLogin;

// =============================================================
// 2) whoami 呼叫 + 把結果填到 Windows tab 的狀態區塊
// =============================================================
export async function fetchWhoAmI(allowAutoLogin = false) {
    const statusEl = document.getElementById('whoami-status');
    const btn = document.getElementById('btn-windows-continue');
    const config = window._authConfig || { allowManualLogin: true };
    const fallbackHint = '<div class="small text-muted mt-1">請聯繫網頁管理員</div>';

    if (statusEl) {
        statusEl.className = 'alert alert-light border text-center py-3 mb-3';
        statusEl.innerHTML = '<div class="spinner-border spinner-border-sm text-primary me-2" role="status"></div>正在偵測桌機登入者...';
    }
    if (btn) btn.disabled = true;

    try {
        const resp = await fetch('/api/Auth/WhoAmI', {
            method: 'GET',
            credentials: 'include'
        });

        if (resp.status === 401) {
            const data = { success: false, authenticated: false, message: '未偵測到 Windows 登入身份' };
            _whoamiResult = data;
            if (statusEl) {
                statusEl.className = 'alert alert-light border text-center py-3 mb-3';
                statusEl.innerHTML = '<i class="fas fa-info-circle me-1 text-muted"></i> ' + window.escapeHTML(data.message) + fallbackHint;
            }
            return data;
        }

        if (!resp.ok) {
            const data = { success: false, authenticated: false, message: `WhoAmI HTTP ${resp.status}` };
            _whoamiResult = data;
            if (statusEl) {
                statusEl.className = 'alert alert-light border text-center py-3 mb-3';
                statusEl.innerHTML = '<i class="fas fa-times-circle me-1 text-danger"></i> ' + window.escapeHTML(data.message) + fallbackHint;
            }
            return data;
        }

        const data = await resp.json();
        _whoamiResult = data;

        if (statusEl) {
            if (data.success && data.authenticated && data.empId) {
                statusEl.className = 'alert alert-success border text-center py-3 mb-3';
                statusEl.innerHTML = `<i class="fas fa-user-check me-1"></i> 偵測到 Windows 帳號：<b>${window.escapeHTML(data.empId)}</b>`;
                if (btn) btn.disabled = false;

                // ✅ 偵測成功 → 自動登入（僅限「初次進入點」tryAutoLogin 帶 allowAutoLogin=true）
                //   tab 切換 / 重試 / overlay 內部呼叫一律 allowAutoLogin=false → 只顯示偵測結果 +
                //   啟用「以此身份進入」按鈕，避免「點一下自動偵測 tab 就被自動登入」造成切換不順。
                //   防護：
                //     - allowAutoLogin 只有初次進入點為 true
                //     - _autoLoginInProgress 防雙重觸發 (Round-5 B2 的 LoginCount +2 問題)
                const currId = window.cleanId ? window.cleanId(appState.currentUser?.id || appState.currentUser?.empId || '') : String(appState.currentUser?.id || appState.currentUser?.empId || '').trim().toLowerCase();
                const targetId = window.cleanId ? window.cleanId(data.empId || '') : String(data.empId || '').trim().toLowerCase();
                const isUserMismatch = Boolean(appState.currentUser && targetId && currId && currId !== targetId);

                if (allowAutoLogin 
                    && !_autoLoginInProgress
                    && (!appState.currentUser || isUserMismatch)
                    && sessionStorage.getItem(FORCE_MANUAL_KEY) !== '1') {
                    _autoLoginInProgress = true;
                    try {
                        const ok = await completeLoginAfterAuth(data.empId, 'windows', data.account || null);
                        if (ok && isUserMismatch) {
                            window.location.reload();
                            return;
                        }
                    } finally {
                        _autoLoginInProgress = false;
                    }
                }
            } else {
                statusEl.className = 'alert alert-light border text-center py-3 mb-3';
                const msg = data.message || '未偵測到 Windows 登入帳號';
                statusEl.innerHTML = '<i class="fas fa-info-circle me-1 text-muted"></i> ' + window.escapeHTML(msg) + fallbackHint;
                if (btn) btn.disabled = true;
            }
        }
        return data;

    } catch (e) {
        // ⚠️ 原本這裡有 `clearTimeout(timer)` 但 `timer` 從未宣告 → ReferenceError 會讓整段 catch 中斷、
        //   UI 永遠卡在 spinner、btn 也不會 enable。Round-5 移除。
        const msg = (e && e.name === 'AbortError')
            ? '偵測逾時（請確認瀏覽器/站台 Windows Auth 設定）'
            : '無法連線到伺服器';

        if (statusEl) {
            statusEl.className = 'alert alert-light border text-center py-3 mb-3';
            statusEl.innerHTML = '<i class="fas fa-times-circle me-1 text-danger"></i> ' + window.escapeHTML(msg) + fallbackHint;
        }
        return { success: false, authenticated: false };
    }
}

export function retryWhoAmI() {
    fetchWhoAmI();
}
window.retryWhoAmI = retryWhoAmI;

// =============================================================
// 3) 「以此身份進入」按鈕 (Windows 自動偵測通過後)
// =============================================================
export async function doWindowsLogin() {
    if (!_whoamiResult || !_whoamiResult.success || !_whoamiResult.empId) {
        customAlert('尚未偵測到可用的 Windows 帳號');
        return;
    }
    // Windows 模式：直接以 empId 走 completeLoginAfterAuth，不打 /api/Auth/Login（避免又被擋密碼）
    // 後端的 cookie 我們仍然用 Login 一次來發 — 但用「特殊 source」識別。
    // 簡化：直接打 Login 帶 empId 與一個固定密碼 'WINDOWS_AUTH'？不太好。
    // 改採：另開一個 SignIn 端點。為了不增加複雜度，這裡直接複用前端 appState.currentUser，
    //   cookie 不發 — 任何後端 API 都不檢查 cookie（目前後端的 controller 都是 [AllowAnonymous]）。
    const ok = await completeLoginAfterAuth(_whoamiResult.empId, 'windows');
    if (!ok) customAlert('登入失敗');
}
window.doWindowsLogin = doWindowsLogin;

// =============================================================
// 4) 手動 tab 的登入 (走 /api/Auth/Login → LDAP 驗證)
// =============================================================
export async function doLogin() {
    const empIdInput = document.getElementById('empId');
    const pwdInput = document.getElementById('empPwd');
    const errEl = document.getElementById('manual-login-error');

    const empId = (empIdInput?.value || '').trim();
    const password = pwdInput?.value || '';

    if (!empId) {
        showManualError('請輸入工號');
        return;
    }

    showManualError('');

    let authResult = null;
    try {
        const loginResp = await fetch('/api/Auth/Login', {
            method: 'POST',
            credentials: 'include',
            headers: { 
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({ empId, password })
        });

        if (loginResp.ok) {
            authResult = await loginResp.json();
        } else {
            const err = await safeJson(loginResp);
            showManualError(err?.message || `登入失敗 (HTTP ${loginResp.status})`);
            return;
        }
    } catch (e) {
        console.error('登入 API 呼叫失敗:', e);
        showManualError('無法連線到伺服器');
        return;
    }

    if (!authResult || !authResult.success) {
        showManualError(authResult?.message || '登入失敗');
        return;
    }

    // 清除強制手動旗標（既然手動成功，就允許下次 whoami 嘗試）
    localStorage.removeItem(FORCE_MANUAL_KEY);

    // 後端會回 account 物件 — 當 admin/user 等 TestAccount 不在 DB Accounts 表時，
    // 直接用這個 fallback 才不會卡在「無法載入您的權限設定檔」。
    const apiFallback = authResult.account || null;
    const ok = await completeLoginAfterAuth(authResult.empId || empId, authResult.source || 'manual', apiFallback);
    if (!ok) showManualError('權限資料載入失敗');
}
window.doLogin = doLogin;

export function showManualError(msg) {
    const el = document.getElementById('manual-login-error');
    if (!el) return;
    if (!msg) { el.classList.add('d-none'); el.textContent = ''; return; }
    el.classList.remove('d-none');
    el.textContent = msg;
}

// =============================================================
// 5) 完成後續登入流程：對 appState 撈 Account、更新 LoginCount、寫 localStorage、進主畫面
//    fallbackAccount: 後端 Login API 回傳的 account 物件 (TestAccount 用)
// =============================================================
export async function completeLoginAfterAuth(empId, source, fallbackAccount) {
    // 登入後使用者身分已改變（WhoAmI / Login 已 SignInAsync 設好 cookie），而 antiforgery token
    //   綁定登入者身分 → 頁面初次載入時取得的「匿名 token」此刻已失效。先主動刷新，後續寫入
    //   （UpdateLoginStats、看板/帳號 CRUD…）才不會被擋 "CSRF validation failed: Invalid Token"。
    if (typeof window.refreshCsrfToken === 'function') {
        try { await window.refreshCsrfToken(); } catch (e) { /* 失敗有 api.js 自我修復重試兜底 */ }
    }

    // ⚠️ appState.accounts 只有在 fetchInitialDataFromDB 成功時才會被賦值；匿名載入頁面時
    //    GetInitialData 回 401 → 該函式提前 return false、accounts 仍為 undefined。
    //    這裡若直接讀 .length 會 TypeError 中斷整個登入流程，故須容錯為「未載入」。
    if ((!window.appState.accounts || window.appState.accounts.length === 0) && typeof fetchInitialDataFromDB === 'function') {
        const ok = await fetchInitialDataFromDB();
        if (!ok) {
            if (typeof customAlert === 'function') customAlert("無法載入資料庫，請重新整理網頁");
            return false;
        }
    }

    const lowerId = String(empId).toLowerCase();

    // 從 appState 撈完整帳號資訊（appState 在 main.js 進入點時就已經 fetch 過）
    let acc = null;
    try {
        acc = getAccounts().find(a => String(a.empId || a.EmpId || '').toLowerCase() === lowerId);
    } catch (e) {
        console.error('讀取本地帳號資料失敗:', e);
    }

    // 沒撈到 → 使用後端 Login 提供的 fallback (TestAccounts: admin/admin、user/user 等情境)
    if (!acc && fallbackAccount) {
        acc = {
            empId: fallbackAccount.empId || empId,
            name: fallbackAccount.name || empId,
            department: fallbackAccount.department || '',
            roleLevel: fallbackAccount.roleLevel || 'user',
            assignedRoles: fallbackAccount.assignedRoles || [],
            manageableMenus: fallbackAccount.manageableMenus || [],
            canEditOthers: fallbackAccount.canEditOthers === true,
            defaultPages: fallbackAccount.defaultPages || {}
        };
    }

    // 最後一層 fallback：純前端 admin 兜底（後端如果掛了還是能進）
    if (!acc && lowerId === 'admin') {
        acc = {
            empId: 'admin', name: '系統管理員(臨時)', department: '系統救援',
            roleLevel: 'admin', assignedRoles: [], manageableMenus: [],
            canEditOthers: true, defaultPages: {}
        };
    }

    if (!acc) {
        customAlert(`工號 [${empId}] 未在系統建立，請聯絡管理員。`);
        return false;
    }

    const accEmpId = acc.empId || acc.EmpId || '';
    const now = new Date();
    const lastKnownDbCount = parseInt(acc.loginCount || acc.LoginCount || 0) || 0;
    const lastKnownDbTime = acc.lastLoginTime || acc.LastLoginTime || null;
    let displayLoginCount = lastKnownDbCount;
    // ✅ O8 修正：初始顯示「上次登入時間」(DB 值)，而非本地 now。
    //   背景 UpdateLoginStats 完成後才更新為最新次數與時間，避免前後兩次渲染因伺服器/本地時區差異
    //   而造成右上角「本次登入時間」在數秒內從本地時間跳動至 DB 時間（視覺閃跳）。
    let displayLoginTime = lastKnownDbTime ? formatLoginTimeFromDb(lastKnownDbTime) : formatLoginTime(now);

    // ⚡ 即時先以現有已知的帳號資訊設定 appState.currentUser 並立即渲染 UI（右上方帳號與看板 0 秒就位）
    appState.currentUser = {
        id: accEmpId,
        empId: accEmpId,
        name: acc.name || acc.Name || '',
        department: acc.department || acc.Department || '',
        roleLevel: acc.roleLevel || acc.RoleLevel || 'user',
        assignedRoles: acc.assignedRoles || acc.AssignedRoles || [],
        manageableMenus: acc.manageableMenus || acc.ManageableMenus || [],
        canEditOthers: acc.canEditOthers || acc.CanEditOthers || false,
        loginCount: displayLoginCount,
        currentLoginTime: displayLoginTime,
        defaultPages: acc.defaultPages || acc.DefaultPages || {},
        loginSource: source || 'manual'  // 'windows' / 'manual' / 'emergency'
    };
    const slimUser = { id: appState.currentUser.id, empId: appState.currentUser.empId, name: appState.currentUser.name, department: appState.currentUser.department, roleLevel: appState.currentUser.roleLevel, loginSource: appState.currentUser.loginSource };
    localStorage.setItem('umc_current_user', JSON.stringify(slimUser));

    hideLoginOverlay();
    if (typeof initDashboardUI === 'function') initDashboardUI();

    // ⚡ 背景非同步更新 DB 的 LoginCount / LastLoginTime，完全不阻塞畫面初次顯示
    fetch('/Settings/UpdateLoginStats', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({ empId: accEmpId })
    }).then(async resp => {
        if (resp.ok) {
            const result = await resp.json();
            if (result && result.success) {
                if (typeof result.loginCount === 'number' && result.loginCount > 0) {
                    displayLoginCount = result.loginCount;
                }
                if (result.lastLoginTime) {
                    displayLoginTime = formatLoginTimeFromDb(result.lastLoginTime);
                }
                if (window.appState && window.appState.accounts) {
                    const a = window.appState.accounts.find(x => String(x.empId).toLowerCase() === accEmpId.toLowerCase());
                    if (a) {
                        a.loginCount = displayLoginCount;
                        a.lastLoginTime = new Date().toISOString();
                    }
                }
                if (appState.currentUser && String(appState.currentUser.empId).toLowerCase() === accEmpId.toLowerCase()) {
                    appState.currentUser.loginCount = displayLoginCount;
                    appState.currentUser.currentLoginTime = displayLoginTime;
                    if (typeof window.renderUserDropdown === 'function') window.renderUserDropdown();
                }
            } else {
                console.warn('UpdateLoginStats 後端拒絕：', result && result.message);
            }
        } else {
            console.warn('UpdateLoginStats HTTP 失敗：', resp.status);
        }
    }).catch(e => {
        console.warn('UpdateLoginStats 連線失敗：', e);
    });

    return true;
}

// =============================================================
// 6) Overlay 顯示 / 隱藏
// =============================================================
export function showLoginOverlay(defaultTab) {
    const ov = document.getElementById('login-overlay');
    if (!ov) return;
    ov.style.setProperty('display', 'flex', 'important');

    // ⭐ 每次顯示登入框都重新套用 Auth 設定，確保「手動輸入」tab 的顯示/隱藏永遠與
    //    AllowManualLogin 一致 —— 不只初次載入。否則登出後（logout() 直接呼叫本函式、
    //    未經 tryAutoLogin）手動帳密 tab/輸入頁會殘留可見。
    const _cfg = window._authConfig || { allowManualLogin: true };
    try { applyAuthConfigToUI(_cfg); } catch (e) { }

    // ⭐ 停用手動輸入時，任何要求停在 'manual' 的呼叫（含 logout 的硬編碼 'manual'）一律
    //    強制改回 'windows'，避免切到被隱藏的手動 tab 卻仍顯示其帳號/密碼輸入面板。
    if (!_cfg.allowManualLogin && defaultTab === 'manual') {
        defaultTab = 'windows';
    }

    // （2026-07-03 移除「帳號已被系統管理員移除」彈窗：main.js restoreLoginFromStorage
    //   查無帳號時已改為靜默清 localStorage → tryAutoLogin 重登，不再設 hint 旗標。
    //   企業內部員工桌機開頁不應被提示視窗打斷 —— 勿再加回。）

    // 切到指定 tab
    try {
        const tabBtn = (defaultTab === 'manual')
            ? document.getElementById('tab-manual')
            : document.getElementById('tab-windows');
        if (tabBtn && window.bootstrap?.Tab) {
            bootstrap.Tab.getOrCreateInstance(tabBtn).show();
        }
    } catch (e) { }

    // 若停留在 Windows tab 卻還沒 whoami 過，主動觸發一次
    if (defaultTab !== 'manual' && (!_whoamiResult || _whoamiResult.success !== true)) {
        fetchWhoAmI();
    }
}

export function hideLoginOverlay() {
    const ov = document.getElementById('login-overlay');
    if (ov) ov.style.setProperty('display', 'none', 'important');
}

// =============================================================
// 7) 登出 — 設旗標 → 後端清 cookie → 顯示登入框
//    （AllowManualLogin=true 時停在手動 tab；停用手動輸入時 showLoginOverlay 會自動改停 Windows 自動偵測 tab）
// =============================================================
export async function logout() {
    try {
        await fetch('/api/Auth/Logout', { 
            method: 'POST', 
            credentials: 'include',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
    } catch (e) {
        console.error('登出 API 呼叫失敗', e);
    }

    // 設旗標：「同一 tab 內」下次進入時不要又被 Windows Auth 自動拉進來
    //   sessionStorage = 關掉 tab 就清掉 → 新開 tab / 新分頁 = 視為新 session 自動登入
    try { sessionStorage.setItem(FORCE_MANUAL_KEY, '1'); } catch (e) { }
    try { localStorage.removeItem(FORCE_MANUAL_KEY); } catch (e) { } // 順手清舊版殘留

    localStorage.removeItem('umc_current_user');

    // Round-5 B10：把所有「使用者個人」快取一併清掉，避免共用電腦切換帳號時讀到上一個人的舊資料。
    //   會清：umc_user_stats_<empId>、umc_user_personal_<empId> 等所有 umc_user_* 前綴；
    //   FORCE_MANUAL_KEY 上面才剛設、要保留。
    try {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('umc_user_')) keysToRemove.push(k);
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch (e) { /* localStorage 無法讀寫時靜默忽略 */ }

    appState.currentUser = null;
    _whoamiResult = null;
    appState.currentActiveTopMenuId = null;
    appState.currentActiveSidebarMenuId = null;

    // 傳 'manual' 為「允許手動時」的偏好；若 AllowManualLogin=false，showLoginOverlay 內部
    //   會強制改回 'windows'（自動偵測），不會顯示帳號/密碼輸入頁。
    showLoginOverlay('manual');
}
window.logout = logout;

// =============================================================
// 工具
// =============================================================
export function formatLoginTime(d) {
    const pad = (n) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatLoginTimeFromDb(dbStr) {
    try {
        const d = new Date(dbStr.replace(' ', 'T'));
        if (!isNaN(d.getTime())) return formatLoginTime(d);
    } catch (e) { }
    return dbStr;
}

export async function safeJson(resp) {
    try { return await resp.json(); } catch (e) { return null; }
}

document.addEventListener('DOMContentLoaded', () => {
    const winTabBtn = document.getElementById('tab-windows');
    const manualTabBtn = document.getElementById('tab-manual');

    if (winTabBtn) {
        winTabBtn.addEventListener('shown.bs.tab', () => {
            // 每次切到 Windows tab 都重新偵測一次
            _whoamiResult = null;
            fetchWhoAmI();
            // 切走手動 tab → 清掉手動登入的殘留錯誤訊息，避免下次切回來還看到舊紅字
            showManualError('');
        });
    }

    if (manualTabBtn) {
        manualTabBtn.addEventListener('shown.bs.tab', () => {
            // 切回手動 tab → 一律先清掉上一輪殘留的錯誤訊息，畫面乾淨
            showManualError('');
        });
    }
});

// Expose for HTML inline handlers
window.fetchAuthConfig = fetchAuthConfig;
window.applyAuthConfigToUI = applyAuthConfigToUI;
window.tryAutoLogin = tryAutoLogin;
window.fetchWhoAmI = fetchWhoAmI;
window.retryWhoAmI = retryWhoAmI;
window.doWindowsLogin = doWindowsLogin;
window.doLogin = doLogin;
window.showManualError = showManualError;
window.completeLoginAfterAuth = completeLoginAfterAuth;
window.showLoginOverlay = showLoginOverlay;
window.hideLoginOverlay = hideLoginOverlay;
window.logout = logout;
window.formatLoginTime = formatLoginTime;
window.formatLoginTimeFromDb = formatLoginTimeFromDb;
window.safeJson = safeJson;


