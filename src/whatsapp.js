const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const { findChrome } = require('./chrome');

/**
 * Tek bir WhatsApp oturumunu yönetir. Oturum kimlik bilgileri LocalAuth ile
 * userData altına kaydedilir; QR kod her hesap için yalnızca ilk eşleştirmede
 * gerekir.
 */
const ENJEKSIYON_DENEME_LIMITI = 3;

class SessionManager {
    constructor(dataDir, onEvent) {
        this.dataDir = dataDir;
        this.onEvent = onEvent;
        this.client = null;
        this.sessionName = null;
        this.status = 'kapali';
        this.hazirZamanlayici = null;
        this.durumYoklayici = null;
        this.enjeksiyonDenemesi = 0;
        this.enjeksiyonSuruyor = false;
    }

    setStatus(status, extra = {}) {
        this.status = status;
        this.onEvent({ type: 'durum', durum: status, oturum: this.sessionName, ...extra });
    }

    /**
     * Oturumu "hazır" olarak işaretler. Hem resmi "ready" olayı hem de durum
     * yoklaması buradan geçer; yalnızca ilk çağrı etkilidir.
     */
    hazirlandi() {
        clearTimeout(this.hazirZamanlayici);
        clearInterval(this.durumYoklayici);

        if (this.status === 'hazir') {
            return;
        }

        const numara = this.client?.info?.wid?.user ?? null;
        this.setStatus('hazir', { numara });
    }

    /**
     * whatsapp-web.js 1.34.x, güncel WhatsApp Web ile bazı istemcilerde
     * "ready" olayını hiç tetiklemiyor (kimlik doğrulanıp yükleme %100'e
     * ulaşsa bile). Bağlantı durumu CONNECTED olduğunda oturum gerçekte
     * kullanılabilir olduğundan, "ready"i beklemek yerine durumu yoklayıp
     * bağlanınca devam ederiz.
     */
    durumYoklamayaBasla() {
        clearInterval(this.durumYoklayici);

        this.durumYoklayici = setInterval(async () => {
            if (!this.client || this.status === 'hazir') {
                clearInterval(this.durumYoklayici);
                return;
            }

            let durum;
            try {
                durum = await this.client.getState();
            } catch {
                return; // Sayfa henüz hazır değil; sonraki yoklamada tekrar denenir.
            }

            if (durum !== 'CONNECTED') {
                return;
            }

            // Soketin CONNECTED olması yetmez: whatsapp-web.js'in sayfaya
            // enjekte ettiği yardımcı kod (window.WWebJS) yüklenmemişse
            // gönderim "Cannot read properties of undefined (reading
            // 'getChat')" ile düşer. Enjeksiyon tamamlanmadan hazır demeyiz.
            let enjekte;
            try {
                enjekte = await this.client.pupPage.evaluate('typeof window.WWebJS !== "undefined"');
            } catch {
                return;
            }

            if (!enjekte) {
                await this.enjeksiyonuTamamla();
                return;
            }

            this.onEvent({ type: 'bilgi', mesaj: 'Bağlantı kuruldu (durum yoklaması ile).' });
            this.hazirlandi();
        }, 4000);
    }

    /**
     * whatsapp-web.js, kimlik doğrulamayı bildiren geri çağırmanın devamında
     * yardımcı kodunu sayfaya enjekte eder; WhatsApp Web'in bazı (A/B)
     * sürümlerinde bu adım hata verip sessizce yarıda kalıyor. Bağlantı
     * CONNECTED göründüğü halde window.WWebJS tanımsız kalır ve gönderim
     * çalışmaz. Burada kütüphanenin yarıda kalan adımları (LoadUtils,
     * bağlantı bilgisi, olay dinleyicileri) elle tamamlanır; başarısız
     * olursa gerçek hata günlüğe yazılır.
     */
    async enjeksiyonuTamamla() {
        if (this.enjeksiyonSuruyor || this.enjeksiyonDenemesi >= ENJEKSIYON_DENEME_LIMITI) {
            return;
        }

        this.enjeksiyonSuruyor = true;
        this.enjeksiyonDenemesi += 1;

        try {
            const { LoadUtils } = require('whatsapp-web.js/src/util/Injected/Utils');
            await this.client.pupPage.evaluate(LoadUtils);

            // Bağlantı bilgisi (numara göstermek için); alınamazsa gönderimi engellemez.
            try {
                const { ClientInfo } = require('whatsapp-web.js/src/structures');
                const bilgi = await this.client.pupPage.evaluate(() => ({
                    ...window.require('WAWebConnModel').Conn.serialize(),
                    wid: window.require('WAWebUserPrefsMeUser').getMaybeMePnUser()
                        || window.require('WAWebUserPrefsMeUser').getMaybeMeLidUser(),
                }));
                this.client.info = new ClientInfo(this.client, bilgi);
            } catch {
                // Yalnızca numara gösterilemez; devam edilir.
            }

            await this.client.attachEventListeners();
            this.onEvent({ type: 'bilgi', mesaj: 'Yarıda kalan WhatsApp enjeksiyonu elle tamamlandı.' });
        } catch (error) {
            if (this.enjeksiyonDenemesi >= ENJEKSIYON_DENEME_LIMITI) {
                clearInterval(this.durumYoklayici);
                this.setStatus('hata', {
                    mesaj: 'WhatsApp bağlandı ancak gönderim için gerekli modüller yüklenemedi: '
                        + `${error.message}. WhatsApp Web'in bu hesaba sunulan sürümü kütüphaneyle uyumsuz görünüyor; `
                        + 'oturumu kapatıp yeniden bağlanmayı deneyin.',
                });
            } else {
                this.onEvent({
                    type: 'bilgi',
                    mesaj: `WhatsApp enjeksiyonu tamamlanamadı (deneme ${this.enjeksiyonDenemesi}/${ENJEKSIYON_DENEME_LIMITI}): ${error.message}`,
                });
            }
        } finally {
            this.enjeksiyonSuruyor = false;
        }
    }

    async start(sessionName) {
        if (this.client) {
            await this.stop();
        }

        const chromePath = findChrome();
        if (!chromePath) {
            this.setStatus('hata', {
                mesaj: 'Chromium tabanlı tarayıcı bulunamadı. Lütfen Google Chrome veya Microsoft Edge yükleyin.',
            });
            return;
        }

        this.sessionName = sessionName;
        this.enjeksiyonDenemesi = 0;
        this.enjeksiyonSuruyor = false;
        this.setStatus('baslatiliyor', { mesaj: `Tarayıcı: ${chromePath}` });

        this.client = new Client({
            authStrategy: new LocalAuth({
                clientId: sessionName,
                dataPath: path.join(this.dataDir, 'oturumlar'),
            }),
            puppeteer: {
                headless: true,
                executablePath: chromePath,
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
            },
        });

        this.client.on('qr', async (qr) => {
            const dataUri = await QRCode.toDataURL(qr, { width: 320, margin: 1 });
            this.setStatus('qr-bekleniyor', { qr: dataUri });
        });

        this.client.on('authenticated', () => {
            this.setStatus('dogrulandi');

            // "ready" olayı bazı istemcilerde hiç gelmediğinden, doğrulama
            // sonrası bağlantı durumunu yoklamaya başlarız.
            this.durumYoklamayaBasla();

            // Yine de makul sürede bağlanamazsa kullanıcıyı bilgilendir.
            this.hazirZamanlayici = setTimeout(() => {
                if (this.status !== 'hazir') {
                    this.onEvent({
                        type: 'durum',
                        durum: this.status,
                        oturum: this.sessionName,
                        mesaj: 'Bağlantı 3 dakikadır hazırlanıyor. İlk eşleştirmede sohbet senkronu uzun sürebilir; '
                            + 'yükleme yüzdesi ilerliyorsa bekleyin. İlerlemiyorsa oturumu kapatıp yeniden QR okutmayı deneyin.',
                    });
                }
            }, 3 * 60 * 1000);
        });

        this.client.on('loading_screen', (yuzde, mesaj) => {
            this.setStatus('yukleniyor', { mesaj: `WhatsApp yükleniyor: %${yuzde}${mesaj ? ` (${mesaj})` : ''}` });
        });

        this.client.on('change_state', (state) => {
            this.onEvent({ type: 'bilgi', mesaj: `Bağlantı durumu: ${state}` });
        });

        this.client.on('ready', () => {
            this.hazirlandi();
        });

        this.client.on('auth_failure', (msg) => {
            this.setStatus('hata', { mesaj: `Kimlik doğrulama başarısız: ${msg}` });
        });

        this.client.on('disconnected', (reason) => {
            this.setStatus('koptu', { mesaj: `Bağlantı koptu: ${reason}` });
        });

        try {
            await this.client.initialize();
        } catch (error) {
            this.setStatus('hata', { mesaj: `Başlatma hatası: ${error.message}` });
            this.client = null;
        }
    }

    isReady() {
        return this.client !== null && this.status === 'hazir';
    }

    async stop() {
        clearTimeout(this.hazirZamanlayici);
        clearInterval(this.durumYoklayici);

        if (!this.client) {
            return;
        }

        try {
            await this.client.destroy();
        } catch {
            // Tarayıcı zaten kapanmış olabilir; yok sayılır.
        }

        this.client = null;
        this.setStatus('kapali');
    }

    async logout() {
        if (!this.client) {
            return;
        }

        try {
            await this.client.logout();
        } catch {
            // Oturum zaten kapanmış olabilir; yok sayılır.
        }

        await this.stop();
    }
}

module.exports = { SessionManager };
