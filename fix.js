const fs = require('fs');
const path = require('path');

const targetDir = path.join(__dirname, 'wwwroot');
const newVersion = '20260727';

function processFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;

    // 1. Version bumps
    content = content.replace(/\?v=([a-zA-Z0-9_]+)/g, `?v=${newVersion}`);
    content = content.replace(/__APP_VER__\s*=\s*['"]([a-zA-Z0-9_]+)['"]/g, `__APP_VER__ = '${newVersion}'`);

    // 2. High contrast fixes (text-dark to text-body)
    const fileName = path.basename(filePath);
    
    if (fileName === 'index.html') {
        // Special case in index.html
        content = content.replace('<span class="badge bg-light text-dark border" id="statsDetailsCount">共 0 筆</span>', 
                                  '<span class="badge border border-secondary text-secondary" id="statsDetailsCount">共 0 筆</span>');
        content = content.replace(/text-dark/g, 'text-body');
    }
    
    if (fileName === 'modals.html' || fileName === 'account-ui.js' || fileName === 'stats-ui.js' || fileName === 'menu-manage.js') {
        content = content.replace(/text-dark/g, 'text-body');
    }

    if (fileName === 'tables.js') {
        content = content.replace('<span class="badge bg-light text-dark border"><i class="fas fa-check-double text-success me-1"></i>全系統所有選單</span>', 
                                  '<span class="badge border border-secondary text-secondary"><i class="fas fa-check-double text-success me-1"></i>全系統所有選單</span>');
        content = content.replace('<span class="badge bg-info text-dark">有 / 僅限自建內容</span>', 
                                  '<span class="badge border border-info text-info">有 / 僅限自建內容</span>');
        content = content.replace('<span class="badge border border-primary text-primary me-1 mb-1 bg-transparent">${window.escapeHTML(name)}</span>', 
                                  '<span class="badge border border-info text-info me-1 mb-1 bg-transparent">${window.escapeHTML(name)}</span>');
    }
    
    if (fileName === 'activity-log.js') {
        content = content.replace('<span class="badge bg-light text-dark border">${window.escapeHTML(r.loginSource)}</span>', 
                                  '<span class="badge border border-secondary text-secondary">${window.escapeHTML(r.loginSource)}</span>');
        content = content.replace('<span class="badge bg-info bg-opacity-10 text-dark border border-info border-opacity-25">${window.escapeHTML(r.category || \'\')}</span>', 
                                  '<span class="badge border border-info text-info">${window.escapeHTML(r.category || \'\')}</span>');
    }

    if (content !== original) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Fixed: ${fileName}`);
    }
}

function walkDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            walkDir(fullPath);
        } else if (fullPath.endsWith('.html') || fullPath.endsWith('.js')) {
            processFile(fullPath);
        }
    }
}

console.log('Starting safe update...');
walkDir(targetDir);
console.log('Done!');
