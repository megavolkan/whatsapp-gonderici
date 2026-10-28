const path = require('path');
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { SessionManager } = require('./src/whatsapp');
const { Gonderici } = require('./src/gonderici');
const { SENARYOLAR, listeYukle, dosyaDenetle, mesajiOlustur, sablonUyarilari } = require('./src/liste');

let pencere = null;
let session = null;
let gonderici = null;
let aktifListe = { listeYolu: null, ogeler: [], senaryo: SENARYOLAR.kisiselDosya, esleme: null };
let aktifDosya = null;

/**
 * Portable (kurulumsuz) Windows sürümünde electron-builder bu ortam
 * değişkenini exe'nin bulunduğu klasöre ayarlar. Oturum verilerini
 * AppData yerine exe'nin yanına yazarız ki eşleştirme, uygulama başka
 * bir bilgisayara/USB belleğe taşındığında da geçerli kalsın.
 */
if (process.env.PORTABLE_EXECUTABLE_DIR) {
    app.setPath('userData', path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'WhatsAppGondericiVerileri'));
}

function rendereraGonder(kanal, veri) {
    if (pencere && !pencere.isDestroyed()) {
        pencere.webContents.send(kanal, veri);
    }
}

function createWindow() {
    pencere = new BrowserWindow({
        width: 1000,
        height: 760,
        minWidth: 820,
        minHeight: 600,
        title: 'WhatsApp Gönderici',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    pencere.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    if (process.env.SMOKE_TEST) {
        pencere.webContents.once('did-finish-load', () => {
            console.log('SMOKE_OK');
            app.quit();
        });
    }
}

app.whenReady().then(() => {
    session = new SessionManager(app.getPath('userData'), (olay) => {
        rendereraGonder('wa-olay', olay);
    });

    gonderici = new Gonderici(session, (ilerleme) => {
        rendereraGonder('gonderim-ilerleme', ilerleme);
    });

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    app.quit();
});

app.on('before-quit', async () => {
    if (gonderici) {
        gonderici.iptal();
    }
    if (session) {
        await session.stop();
    }
});

ipcMain.handle('oturum-baslat', async (_e, oturumAdi) => {
    const ad = String(oturumAdi || 'varsayilan').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    session.start(ad);
});

ipcMain.handle('oturum-kapat', async () => {
    await session.logout();
});

function senaryoNormalize(deger) {
    return Object.values(SENARYOLAR).includes(deger) ? deger : SENARYOLAR.kisiselDosya;
}

ipcMain.handle('liste-sec', async (_e, senaryoHam) => {
    const secim = await dialog.showOpenDialog(pencere, {
        title: 'Gönderim listesi seçin (JSON veya Excel)',
        filters: [
            { name: 'Liste dosyaları', extensions: ['json', 'xlsx'] },
            { name: 'JSON', extensions: ['json'] },
            { name: 'Excel', extensions: ['xlsx'] },
        ],
        properties: ['openFile'],
    });

    if (secim.canceled || secim.filePaths.length === 0) {
        return null;
    }

    const senaryo = senaryoNormalize(senaryoHam);
    const listeYolu = secim.filePaths[0];
    // Yeni dosya seçildiğinde eşleme sıfırlanır (otomatik tespit).
    const { ogeler, hatalar, alanAdlari, esleme } = await listeYukle(listeYolu, senaryo);
    aktifListe = { listeYolu, ogeler, senaryo, esleme };

    return { listeYolu, ogeler, hatalar, alanAdlari, esleme };
});

ipcMain.handle('liste-yeniden-dogrula', async (_e, senaryoHam, eslemeIstegi) => {
    if (!aktifListe.listeYolu) {
        return null;
    }

    const senaryo = senaryoNormalize(senaryoHam);
    const istek = eslemeIstegi ?? aktifListe.esleme;
    const { ogeler, hatalar, alanAdlari, esleme } = await listeYukle(aktifListe.listeYolu, senaryo, istek);
    aktifListe = { listeYolu: aktifListe.listeYolu, ogeler, senaryo, esleme };

    return { listeYolu: aktifListe.listeYolu, ogeler, hatalar, alanAdlari, esleme };
});

ipcMain.handle('dosya-sec', async () => {
    const secim = await dialog.showOpenDialog(pencere, {
        title: 'Herkese gönderilecek dosyayı seçin',
        properties: ['openFile'],
    });

    if (secim.canceled || secim.filePaths.length === 0) {
        return null;
    }

    const yolu = secim.filePaths[0];
    const denetim = dosyaDenetle(yolu);

    if (!denetim.gecerli) {
        aktifDosya = null;
        return { hata: denetim.hata };
    }

    aktifDosya = { yolu, ad: path.basename(yolu), belgeMi: denetim.belgeMi };
    return { ad: aktifDosya.ad, belgeMi: denetim.belgeMi, buyuk: denetim.buyuk };
});

ipcMain.handle('mesaj-onizle', (_e, sablon) => {
    if (aktifListe.ogeler.length === 0) {
        return null;
    }

    const oge = aktifListe.ogeler.find((o) => o.durum !== 'onceden-gonderildi')
        ?? aktifListe.ogeler[0];

    return {
        kime: oge.ad ?? oge.numara,
        onizleme: mesajiOlustur(String(sablon ?? ''), oge).trim(),
        uyarilar: sablonUyarilari(String(sablon ?? ''), aktifListe.ogeler),
    };
});

ipcMain.handle('gonderim-baslat', async (_e, ayarlar) => {
    if (!aktifListe.listeYolu) {
        throw new Error('Önce bir liste dosyası seçin.');
    }

    const senaryo = aktifListe.senaryo;
    const minGecikme = Math.max(3, Number(ayarlar?.minGecikme) || 20);
    const maxGecikme = Math.max(minGecikme, Number(ayarlar?.maxGecikme) || 45);
    const mesaj = typeof ayarlar?.mesaj === 'string' ? ayarlar.mesaj : '';

    if (senaryo === SENARYOLAR.mesaj && mesaj.trim() === '') {
        throw new Error('Sadece mesaj senaryosunda mesaj metni boş olamaz.');
    }

    const gonderimAyarlari = { senaryo, minGecikme, maxGecikme, mesaj };

    if (senaryo === SENARYOLAR.ayniDosya) {
        if (!aktifDosya) {
            throw new Error('Aynı dosya senaryosunda önce gönderilecek dosyayı seçin.');
        }
        gonderimAyarlari.dosyaYolu = aktifDosya.yolu;
        gonderimAyarlari.dosyaAdi = aktifDosya.ad;
        gonderimAyarlari.belgeMi = aktifDosya.belgeMi;
    }

    return gonderici.calistir(aktifListe.listeYolu, aktifListe.ogeler, gonderimAyarlari);
});

ipcMain.handle('gonderim-iptal', () => {
    gonderici.iptal();
});
