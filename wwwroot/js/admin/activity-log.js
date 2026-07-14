// === admin/activity-log.js — 操作紀錄查詢頁 (admin only) ===
//
// 對應後端：GET /api/ActivityLogs   DELETE /api/ActivityLogs/Purge?days=N
// 對應頁面：#page-activity-log
//

import { customAlert, customConfirm } from '../ui/dialogs.js?v=20260607k';
import { appState } from '../store.js?v=20260607k';


window._activityLogPage = 1;
window._activityLogPageSize = 50;
window._activityLogTotal = 0;

export async function loadActivityLogs() {
    // ⚠️ 不能用 appState.currentUser — config.js 用 `let appState.currentUser` 宣告，不會掛到 window
    if (!appState.currentUser || String(appState.currentUser.roleLevel || '').toLowerCase() !== 'admin') {
        if (typeof customAlert === 'function') customAlert('僅管理員可查看操作紀錄');
        return;
    }

    const tbody = document.getElementById('activityLogBody');
    const stats = document.getElementById('activityLogStats');
    if (tbody) tbody.innerHTML = '<tr><td colspan="12" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-1"></i> 查詢中...</td></tr>';

    const params = new URLSearchParams();
    const empId = document.getElementById('alEmpId')?.value?.trim();
    const category = document.getElementById('alCategory')?.value;
    const from = document.getElementById('alFrom')?.value;
    const to = document.getElementById('alTo')?.value;
    const keyword = document.getElementById('alKeyword')?.value?.trim();
    const success = document.getElementById('alSuccess')?.value;
    if (empId) params.set('empId', empId);
    if (category) params.set('category', category);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (keyword) params.set('keyword', keyword);
    if (success) params.set('successOnly', success);
    params.set('page', window._activityLogPage);
    params.set('pageSize', window._activityLogPageSize);

    try {
        const resp = await fetch('/api/ActivityLogs?' + params.toString());
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        window._activityLogTotal = data.total || 0;

        if (!data.rows || data.rows.length === 0) {
            if (tbody) tbody.innerHTML = '<tr><td colspan="12" class="text-center text-muted py-4">無符合條件的紀錄</td></tr>';
        } else {
            const html = [];
            for (const r of data.rows) {
                html.push(renderActivityRow(r));
            }
            if (tbody) tbody.innerHTML = html.join('');
        }

        // 分頁狀態
        const totalPages = Math.max(1, Math.ceil(window._activityLogTotal / window._activityLogPageSize));
        document.getElementById('alPageInfo').innerText = `${window._activityLogPage} / ${totalPages}`;
        document.getElementById('alPrev').disabled = window._activityLogPage <= 1;
        document.getElementById('alNext').disabled = window._activityLogPage >= totalPages;
        if (stats) stats.innerText = `總筆數 ${window._activityLogTotal}，本頁顯示 ${data.rows?.length || 0} 筆`;
    } catch (e) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="12" class="text-center text-danger py-4">查詢失敗：${window.escapeHTML(e.message || e)}</td></tr>`;
    }
}

export function renderActivityRow(r) {
    const tsLocal = r.timestampUtc ? new Date(r.timestampUtc + (r.timestampUtc.endsWith('Z') ? '' : 'Z')) : null;
    const tsStr = tsLocal ? tsLocal.toLocaleString('zh-TW', { hour12: false }) : '';
    const isSuccess = r.isSuccess;
    const statusBadge = isSuccess === true
        ? `<span class="badge bg-success bg-opacity-25 text-success border border-success border-opacity-50">${r.statusCode ?? '✓'}</span>`
        : isSuccess === false
            ? `<span class="badge bg-danger bg-opacity-25 text-danger border border-danger border-opacity-50">${r.statusCode ?? '✗'}</span>`
            : `<span class="badge bg-secondary bg-opacity-25 text-secondary">${r.statusCode ?? '—'}</span>`;
    const sourceBadge = r.loginSource
        ? `<span class="badge bg-light text-dark border">${window.escapeHTML(r.loginSource)}</span>`
        : '';
    const detailHtml = r.detail || r.errorMessage
        ? `<small class="text-muted">${window.escapeHTML(r.errorMessage || r.detail || '').slice(0, 120)}</small>`
        : '';

    return `<tr>
        <td class="small">${window.escapeHTML(tsStr)}</td>
        <td class="small fw-bold">${window.escapeHTML(r.empId || '—')}</td>
        <td class="small">${window.escapeHTML(r.empName || '')}</td>
        <td class="small">${sourceBadge}</td>
        <td class="small"><span class="badge bg-info bg-opacity-15 text-primary border">${window.escapeHTML(r.category || '')}</span></td>
        <td class="small">${window.escapeHTML(r.action || '')}</td>
        <td class="small text-muted">${window.escapeHTML(r.httpMethod || '')}</td>
        <td class="small text-muted" style="max-width:300px; overflow:hidden; text-overflow:ellipsis;" title="${window.escapeHTML(r.path || '')}">${window.escapeHTML(r.path || '')}</td>
        <td class="small">${statusBadge}</td>
        <td class="small text-end">${r.durationMs != null ? r.durationMs : ''}</td>
        <td class="small text-muted">${window.escapeHTML(r.ipAddress || '')}</td>
        <td class="text-start" style="max-width:280px; white-space:normal;">${detailHtml}</td>
    </tr>`;
}

export function changeActivityPage(delta) {
    const totalPages = Math.max(1, Math.ceil(window._activityLogTotal / window._activityLogPageSize));
    const newPage = window._activityLogPage + delta;
    if (newPage < 1 || newPage > totalPages) return;
    window._activityLogPage = newPage;
    loadActivityLogs();
}

export async function purgeActivityLogs() {
    if (!appState.currentUser || String(appState.currentUser.roleLevel || '').toLowerCase() !== 'admin') return;
    if (typeof customConfirm === 'function') {
        customConfirm('確定要清除 90 天前的所有操作紀錄？(此操作無法復原)', async () => {
            try {
                const resp = await fetch('/api/ActivityLogs/Purge?days=90', { method: 'DELETE' });
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const data = await resp.json();
                if (typeof customAlert === 'function') customAlert(`已清除 ${data.deleted || 0} 筆紀錄`);
                window._activityLogPage = 1;
                loadActivityLogs();
            } catch (e) {
                if (typeof customAlert === 'function') customAlert('清除失敗：' + (e.message || e));
            }
        });
    }
}

// Expose for HTML inline handlers
window.loadActivityLogs = loadActivityLogs;
window.renderActivityRow = renderActivityRow;
window.changeActivityPage = changeActivityPage;
window.purgeActivityLogs = purgeActivityLogs;

