const fs = require('fs');
const path = require('path');

/**
 * whatsapp-web.js'in çalışması için Chromium tabanlı bir tarayıcı gerekir.
 * Kurulum boyutunu küçük tutmak için tarayıcıyı pakete gömmek yerine
 * sistemde kurulu Chrome / Edge / Brave / Chromium aranır.
 */
const MAC_PATHS = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

const WIN_RELATIVE_PATHS = [
    ['Google', 'Chrome', 'Application', 'chrome.exe'],
    ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
    ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'],
    ['Chromium', 'Application', 'chrome.exe'],
];

function windowsCandidates() {
    const roots = [
        process.env['PROGRAMFILES'],
        process.env['PROGRAMFILES(X86)'],
        process.env['LOCALAPPDATA'],
    ].filter(Boolean);

    const candidates = [];
    for (const root of roots) {
        for (const parts of WIN_RELATIVE_PATHS) {
            candidates.push(path.join(root, ...parts));
        }
    }
    return candidates;
}

function findChrome() {
    if (process.env.WA_CHROME_PATH && fs.existsSync(process.env.WA_CHROME_PATH)) {
        return process.env.WA_CHROME_PATH;
    }

    const candidates = process.platform === 'darwin' ? MAC_PATHS : windowsCandidates();

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}

module.exports = { findChrome };
