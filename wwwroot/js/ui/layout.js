import { getCustomMenus } from '../config.js?v=20260719';


import { renderSidebarMenus } from '../render/sidebar.js?v=20260719';
import { goDefaultHome, navTo } from './navigation.js?v=20260719';
import { appState } from '../store.js?v=20260607k';


﻿// === ui/layout.js - 版面切換、側邊欄、全螢幕、釘選 ===
// 切換側邊欄
export function toggleSidebar() {
    let hasChildren = false;
    if (appState.currentActiveTopMenuId === 'system_settings') {
        hasChildren = true;
    } else if (appState.currentActiveTopMenuId) {
        const cTargetId = window.cleanId(appState.currentActiveTopMenuId);
        const menus = getCustomMenus();
        const children = menus.filter(m => window.cleanId(m.parentId) === cTargetId || (m.parentIds || []).map(window.cleanId).includes(cTargetId));
        if (children.length > 0) hasChildren = true;
    }

    if (!hasChildren) {
        document.body.classList.add('sidebar-hidden');
        return;
    }
    document.body.classList.toggle('sidebar-hidden');
}

// 全域釘選狀態（對齊 TEST：預設固定）
appState.isPinned = (typeof appState.isPinned === 'boolean') ? appState.isPinned : true;

export function togglePin() {
    appState.isPinned = !appState.isPinned;

    const btnPin = document.getElementById('btn-pin');

    if (appState.isPinned) {
        // 固定模式：nav 一定顯示
        document.body.classList.remove('nav-hidden');

        // 只有「有子選單 / 系統設定」才展開 sidebar（對齊 TEST）
        let hasChildren = false;
        try {
            if (appState.currentActiveTopMenuId === 'system_settings') {
                hasChildren = true;
            } else if (appState.currentActiveTopMenuId && typeof getCustomMenus === 'function') {
                const cTargetId = window.cleanId(appState.currentActiveTopMenuId);
                const menus = getCustomMenus() || [];
                const children = menus.filter(m =>
                    window.cleanId(m.parentId) === cTargetId ||
                    (m.parentIds || []).map(window.cleanId).includes(cTargetId)
                );
                if (children.length > 0) hasChildren = true;
            } else {
                hasChildren = true; // 無資料可判斷時保守展開
            }
        } catch (e) {
            hasChildren = true;
        }

        if (hasChildren) document.body.classList.remove('sidebar-hidden');
        else document.body.classList.add('sidebar-hidden');

        if (btnPin) {
            btnPin.classList.add('is-pinned');
            btnPin.innerHTML = '<i class="fa-solid fa-thumbtack text-danger" style="font-size: 0.9rem;"></i>';
            btnPin.style.background = 'transparent';
            btnPin.style.color = 'inherit';
        }
    } else {
        // 對齊舊版：取消釘選後不立即隱藏，等滑鼠移出 navbar/sidebar 才由 mouseleave 監聽器接手
        if (btnPin) {
            btnPin.classList.remove('is-pinned');
            btnPin.innerHTML = '<i class="fa-solid fa-unlock text-white-50" style="font-size: 0.9rem;"></i>';
            btnPin.style.background = 'transparent';
            btnPin.style.color = 'inherit';
        }
    }
}

// 讓 index.html 的 onclick="togglePin()" 一定能呼叫到
window.togglePin = togglePin;

// 切換全螢幕
export function toggleFullscreen() {
    document.body.classList.toggle('fullscreen-mode');
    if (document.body.classList.contains('fullscreen-mode')) {
        if (document.documentElement.requestFullscreen) { document.documentElement.requestFullscreen().catch(err => console.log(err)); }
    } else {
        if (document.fullscreenElement) { document.exitFullscreen().catch(err => console.log(err)); }
    }
}

// ============================================================================
// ⭐️ 重構：安全、精準補獲側邊欄「個人頁面管理」按鈕 (絕不影響主畫面 Table 內容)
// ============================================================================
let enforceTimer = null;
export function enforceSystemModeUI() {
    if (typeof appState.currentLayoutMode === 'undefined') return;

    if (enforceTimer) clearTimeout(enforceTimer);
    enforceTimer = setTimeout(() => {
        // ⭐️ 精準且安全地尋找「個人頁面管理」按鈕，避開 querySelectorAll('*') 對主畫面表格的干擾
        const personalBtn = document.querySelector('[data-bs-target="#personalMenuModal"]');
        if (personalBtn) {
            // 尋找其外層包裝容器 (如 border-top 分隔線或是 sidebar-footer 底部區塊)
            const wrapper = personalBtn.closest('li, .nav-item, .sidebar-footer, .mt-auto, .border-top') || personalBtn;

            if (appState.currentLayoutMode === 'system') {
                // 系統模式下：隱藏按鈕與其外層容器
                wrapper.style.setProperty('display', 'none', 'important');
            } else {
                // 自訂模式下：還原顯示狀態
                wrapper.style.removeProperty('display');
            }
        }
    }, 20); // 確保畫面渲染完成後再隱藏
}

// ⭐️ 核心修復：切換系統/自訂版面
// ===== 單一真實來源：切換系統/自訂版面（對齊 TEST_20260429.html，統一使用 'personal'）=====
export function switchLayoutMode(mode) {
    // normalize to: system / personal （與 TEST_20260429.html:2147 appState.currentLayoutMode='system' 一致）
    const m = String(mode ?? 'system').toLowerCase();
    const finalMode = (m.includes('custom') || m.includes('personal') || m.includes('自訂')) ? 'personal' : 'system';

    appState.currentLayoutMode = finalMode;

    // 同步 slider UI
    const wrapper = document.getElementById('layout-toggle-wrapper');
    const sysText = document.getElementById('btn-layout-system');
    const perText = document.getElementById('btn-layout-personal');
    if (wrapper) {
        if (finalMode === 'system') {
            wrapper.classList.remove('personal-active');
            sysText?.classList.add('active');
            perText?.classList.remove('active');
        } else {
            wrapper.classList.add('personal-active');
            sysText?.classList.remove('active');
            perText?.classList.add('active');
        }
    }

    try {
        const isInSystemSettings = (appState.currentActiveTopMenuId === 'system_settings');

        if (!isInSystemSettings) {
            appState.currentActiveTopMenuId = null;
            appState.currentActiveSidebarMenuId = null;
        }

        // 頂部頁籤已由 renderSidebarMenus 一併渲染，無需另外呼叫 renderTopMenus
        if (typeof renderSidebarMenus === 'function') renderSidebarMenus();

        if (isInSystemSettings) {
            // 留在系統設定，不要踢回首頁
            const personalPage = document.getElementById('page-personal-manage');
            if (finalMode === 'system' && personalPage && personalPage.classList.contains('active')) {
                if (typeof navTo === 'function') {
                    if (typeof appState.currentUser !== 'undefined' && appState.currentUser?.roleLevel === 'admin') navTo('page-account-manage', null, '帳號管理');
                    else navTo('page-apply', null, '需求申請');
                }
            }
        } else {
            // 對齊 TEST：切換模式一律導回「預設首頁」，不顯示 page-home
            if (typeof goDefaultHome === 'function') goDefaultHome();
        }
    } catch (e) {
        console.error("🚨 切換模式錯誤:", e);
    }

    if (typeof enforceSystemModeUI === 'function') enforceSystemModeUI();
}

// 讓 index.html 的 onclick="switchLayoutMode(...)" 一定能呼叫到
window.switchLayoutMode = switchLayoutMode;


// Expose for HTML inline handlers
window.toggleSidebar = toggleSidebar;
window.togglePin = togglePin;
window.toggleFullscreen = toggleFullscreen;
window.enforceSystemModeUI = enforceSystemModeUI;
window.switchLayoutMode = switchLayoutMode;

