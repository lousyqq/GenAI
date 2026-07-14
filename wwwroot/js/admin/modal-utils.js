import { appState } from '../store.js?v=20260607k';
﻿// === admin/modal-utils.js - Modal 開關封裝 ===
// ====== 後台管理 CRUD 與 Drag & Drop 拖曳邏輯 ======

// Round-5 B9：非 admin 開啟 webpageModal / menuNodeModal 時，把 ACL 區段藏起來。
//   後端 Round-3 已強制 non-admin 的 AllowedEmpIds / DeniedEmpIds 寫入無效 — UI 上若還留著
//   會造成「使用者填了存了沒效」的鬼狀態。
export function applyAclVisibilityForCurrentRole(modalEl) {
    if (!modalEl) return;
    const isAdmin = !!(appState.currentUser && String(appState.currentUser.roleLevel || '').toLowerCase() === 'admin');
    modalEl.querySelectorAll('.admin-only-acl').forEach(el => {
        el.style.display = isAdmin ? '' : 'none';
    });
}

// ⭐️ 終極物理開窗模式：徹底繞過 Visual Studio Browser Link 的底層干擾
export function showModalSafely(modalId) {
    const el = document.getElementById(modalId);
    if (!el) {
        console.error("🚨 系統錯誤：找不到彈窗元素 [" + modalId + "]");
        return;
    }

    // Round-5 B9：開窗前先按身分套用 ACL 顯隱
    applyAclVisibilityForCurrentRole(el);

    try {
        // 先嘗試標準的 Bootstrap 開窗
        if (typeof bootstrap !== 'undefined') {
            bootstrap.Modal.getOrCreateInstance(el).show();
            return; // 成功就結束
        }
    } catch (error) {
        // ⭐️ 靜默處理 Visual Studio BrowserLink 衝突，移除 console.warn，讓右側視窗不再報錯
    }

    // --- 以下為【物理強制開窗模式】(當 Bootstrap 被干擾時的無敵備案) ---
    el.classList.add('show');
    el.style.display = 'block';
    el.removeAttribute('aria-hidden');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('role', 'dialog');
    document.body.classList.add('modal-open');
    document.body.style.overflow = 'hidden';

    // 建立背景黑罩
    if (!document.querySelector('.modal-backdrop.force-backdrop')) {
        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop fade show force-backdrop';
        document.body.appendChild(backdrop);
    }

    // 為視窗內的關閉按鈕，強加物理關窗事件
    const closeBtns = el.querySelectorAll('[data-bs-dismiss="modal"]');
    closeBtns.forEach(btn => {
        btn.onclick = function (e) {
            if (e && typeof e.preventDefault === 'function') e.preventDefault();
            e.stopPropagation();
            hideModalSafely(modalId);
        };
    });
}

export function hideModalSafely(modalId) {
    const el = document.getElementById(modalId);
    if (!el) return;

    // --- 1. 物理強制關閉 (無差別執行，保證畫面絕對乾淨，無懼任何套件或 BrowserLink 衝突) ---
    el.classList.remove('show');
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
    el.removeAttribute('aria-modal');
    el.removeAttribute('role');
    document.body.classList.remove('modal-open');
    document.body.style.overflow = '';

    // 2. 暴力清除所有卡住的背景黑罩
    document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());

    // 3. 為了維持 Bootstrap 內部狀態機正常，溫和地呼叫 hide() (不依賴它改變畫面，且移除 return 阻斷)
    try {
        if (typeof bootstrap !== 'undefined') {
            const inst = bootstrap.Modal.getInstance(el) || bootstrap.Modal.getOrCreateInstance(el);
            if (inst) inst.hide();
        }
    } catch (error) {
        // 靜默處理
    }
}

// Expose for HTML inline handlers
window.applyAclVisibilityForCurrentRole = applyAclVisibilityForCurrentRole;
window.showModalSafely = showModalSafely;
window.hideModalSafely = hideModalSafely;

