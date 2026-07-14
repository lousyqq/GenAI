import { enforceSystemModeUI } from './layout.js?v=20260607k';
import { changeLanguage, renderLangSwitcher } from './navigation.js?v=20260607k';
import { appState } from '../store.js?v=20260607k';


﻿// === ui/dialogs.js - 同步按鈕、自訂 Alert/Confirm、語系更新 ===
export function generateIconHtml(iconVal, colorCls, extraCls, isFolder = false) {
    if (!iconVal) return `<i class="fas ${isFolder ? 'fa-folder text-warning' : 'fa-file-alt text-muted'} ${extraCls}"></i>`;
    // 圖片來源 = data: URI 或任何含 '/' 的路徑（/images/icons/... 實體檔、舊 icon/...）；FA class 永不含 '/'
    if (iconVal.startsWith('data:') || iconVal.includes('/')) return `<img src="${iconVal}" class="custom-icon ${extraCls}" alt="icon">`;
    return `<i class="${iconVal} ${colorCls} ${extraCls}"></i>`;
}

// 更新同步按鈕狀態 UI
export function updateSyncButtonUI() {
    const btn = document.getElementById('btn-sync-excel');
    if (btn) {
        if (appState.hasUnsavedChanges) { btn.classList.remove('d-none'); btn.classList.add('d-inline-flex'); }
        else { btn.classList.add('d-none'); btn.classList.remove('d-inline-flex'); }
    }
}

// === Alert 防重複 / 匯入訊息控管 ===
window.__alertState = window.__alertState || {
    lastHtml: null,
    lastAt: 0
};

// 預設：不讓「匯入結果」在每次一般儲存時一直彈出
window.__allowImportResultAlert = window.__allowImportResultAlert || false;

// 提供一個工具：只允許接下來 1 次匯入結果訊息彈出
window.allowNextImportResultAlert = function () {
    window.__allowImportResultAlert = true;
    // 10 秒後自動關掉，避免忘記關
    setTimeout(() => { window.__allowImportResultAlert = false; }, 10000);
};


export function customAlert(msg, isHtml = false) {
    const msgEl = document.getElementById('systemAlertMsg');

    // 轉成字串
    let rawStr = (typeof msg === 'object' && msg !== null)
        ? (msg.message || JSON.stringify(msg))
        : String(msg ?? '');

    const safeHtml = isHtml ? rawStr : (window.escapeHtml ? window.escapeHtml(rawStr) : rawStr.replace(/</g, "&lt;").replace(/>/g, "&gt;"));

    // 1) 若是「匯入結果」訊息：預設不彈，避免你每次編輯/儲存都一直跳
    const isImportResult =
        safeHtml.includes('匯入完畢') ||
        safeHtml.includes('成功同步至資料庫') ||
        safeHtml.includes('略過異常') ||
        safeHtml.includes('全部資料');

    if (isImportResult && window.__allowImportResultAlert !== true) {
        // 直接忽略
        return;
    }

    // 2) 防止同一訊息短時間內重複彈出
    const now = Date.now();
    if (window.__alertState.lastHtml === safeHtml && (now - window.__alertState.lastAt) < 1500) {
        return;
    }
    window.__alertState.lastHtml = safeHtml;
    window.__alertState.lastAt = now;

    if (msgEl) msgEl.innerHTML = safeHtml;
    if (typeof appState.systemAlertModalObj !== 'undefined' && appState.systemAlertModalObj) appState.systemAlertModalObj.show();

    // 匯入結果只允許彈一次就關掉
    if (isImportResult) window.__allowImportResultAlert = false;
}

export function customConfirm(msg, callback, isHtml = false) {
    const msgEl = document.getElementById('systemConfirmMsg');
    if (msgEl) {
        let rawStr = (typeof msg === 'object' && msg !== null) ? (msg.message || JSON.stringify(msg)) : String(msg ?? '');
        msgEl.innerHTML = isHtml ? rawStr : (window.escapeHtml ? window.escapeHtml(rawStr) : rawStr.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
    }
    appState.confirmActionCallback = callback;
    if (appState.systemConfirmModalObj) appState.systemConfirmModalObj.show();
}

// 4. 綁定 MutationObserver 監視器
// 限縮在 #dynamic-sidebar-menus，避免在 DataTable/Modal 渲染時被全域觸發造成效能瓶頸
if (typeof window !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        const target = document.getElementById('dynamic-sidebar-menus');
        if (!target) return;
        const observer = new MutationObserver(() => {
            requestAnimationFrame(() => enforceSystemModeUI());
        });
        observer.observe(target, { childList: true, subtree: true });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // ✅ 初始化：先渲染語言下拉（active + 打勾）
    if (typeof renderLangSwitcher === 'function') renderLangSwitcher();
    // ✅ 初始化：同步釘選圖示（避免 icon 空白）
    if (typeof syncPinButtonUI === 'function') syncPinButtonUI();
    const contentZone = document.getElementById('main-content');
    const triggerTop = document.getElementById('trigger-top');
    const triggerLeft = document.getElementById('trigger-left');
    const topNavbar = document.getElementById('top-navbar');
    const sidebar = document.getElementById('sidebar');

    if (contentZone) {
        contentZone.addEventListener('mouseenter', () => {
            if (!appState.isPinned) document.body.classList.add('nav-hidden', 'sidebar-hidden');
        });
    }

    if (topNavbar) {
        topNavbar.addEventListener('mouseleave', () => {
            if (!appState.isPinned) document.body.classList.add('nav-hidden');
        });
    }

    if (sidebar) {
        sidebar.addEventListener('mouseleave', () => {
            if (!appState.isPinned) document.body.classList.add('sidebar-hidden');
        });
    }

    if (triggerTop) {
        triggerTop.addEventListener('mouseenter', () => {
            if (!appState.isPinned) document.body.classList.remove('nav-hidden');
        });
    }

    if (triggerLeft) {
        triggerLeft.addEventListener('mouseenter', () => {
            if (!appState.isPinned) document.body.classList.remove('sidebar-hidden');
        });
    }
});


export function syncPinButtonUI() {
    const btnPin = document.getElementById('btn-pin');
    if (!btnPin) return;

    const pinned = (typeof appState.isPinned !== 'undefined') ? appState.isPinned : (appState.isPinned ?? true);

    btnPin.innerHTML = pinned
        ? '<i class="fa-solid fa-thumbtack text-danger" style="font-size: 0.9rem;"></i>'
        : '<i class="fa-solid fa-unlock text-white-50" style="font-size: 0.9rem;"></i>';
}

// =========================================================================
// ⭐️ 新增：語言切換 Dropdown UI 更新與聯動邏輯
// =========================================================================
window.updateLangUI = function (langCode) {
    // 直接呼叫核心語言切換函式（所有 UI 更新邏輯已集中在 changeLanguage 裡）
    if (typeof changeLanguage === 'function') {
        changeLanguage(langCode);
    }

    // 自動滑順收合 Bootstrap 下拉選單
    const dropdownBtn = document.getElementById('langDropdown');
    if (dropdownBtn && typeof bootstrap !== 'undefined') {
        const bsDropdown = bootstrap.Dropdown.getInstance(dropdownBtn) || new bootstrap.Dropdown(dropdownBtn);
        if (bsDropdown) bsDropdown.hide();
    }
};

// Expose for HTML inline handlers
window.generateIconHtml = generateIconHtml;
window.updateSyncButtonUI = updateSyncButtonUI;
window.customAlert = customAlert;
window.customConfirm = customConfirm;
window.syncPinButtonUI = syncPinButtonUI;

