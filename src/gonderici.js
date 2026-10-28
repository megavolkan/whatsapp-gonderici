const { MessageMedia } = require('whatsapp-web.js');
const { SENARYOLAR, sonuclariOku, sonuclariYaz, mesajiOlustur } = require('./liste');

function rastgeleGecikmeSn(min, max) {
    return min + Math.random() * Math.max(0, max - min);
}

/**
 * Gönderim kuyruğunu yönetir. Ban riskini azaltmak için gönderimler arasında
 * rastgele gecikme uygular; her sonucu anında diske yazar, böylece uygulama
 * kapansa bile kaldığı yerden devam edilebilir.
 */
class Gonderici {
    constructor(sessionManager, onProgress) {
        this.sessionManager = sessionManager;
        this.onProgress = onProgress;
        this.iptalEdildi = false;
        this.calisiyor = false;
    }

    iptal() {
        this.iptalEdildi = true;
    }

    async beklenebilirGecikme(saniye) {
        const bitis = Date.now() + saniye * 1000;
        while (Date.now() < bitis && !this.iptalEdildi) {
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
    }

    /**
     * Bir alıcıya senaryoya göre gönderim yapar.
     *   mesaj        → yalnızca metin (boşsa hata)
     *   ayni-dosya   → ayarlardaki ortak dosya + isteğe bağlı açıklama
     *   kisisel-dosya→ kaydın kendi dosyası + isteğe bağlı açıklama
     */
    async ogeGonder(client, oge, ayarlar, mesaj) {
        const kayit = await client.getNumberId(oge.numara);
        if (!kayit) {
            throw new Error('Bu numara WhatsApp\'ta kayıtlı değil.');
        }

        if (ayarlar.senaryo === SENARYOLAR.mesaj) {
            if (mesaj === '') {
                throw new Error('Bu kayıt için gönderilecek mesaj metni boş.');
            }
            await client.sendMessage(kayit._serialized, mesaj);
            return;
        }

        const dosyaYolu = ayarlar.senaryo === SENARYOLAR.ayniDosya ? ayarlar.dosyaYolu : oge.dosyaYolu;
        const belgeMi = ayarlar.senaryo === SENARYOLAR.ayniDosya ? ayarlar.belgeMi : oge.belgeMi;

        const media = MessageMedia.fromFilePath(dosyaYolu);
        if (!media.mimetype) {
            media.mimetype = 'application/octet-stream';
        }
        await client.sendMessage(kayit._serialized, media, {
            caption: mesaj !== '' ? mesaj : undefined,
            sendMediaAsDocument: belgeMi || undefined,
        });
    }

    async calistir(listeYolu, ogeler, ayarlar) {
        if (this.calisiyor) {
            throw new Error('Gönderim zaten sürüyor.');
        }
        if (!this.sessionManager.isReady()) {
            throw new Error('WhatsApp oturumu hazır değil.');
        }

        this.calisiyor = true;
        this.iptalEdildi = false;

        const client = this.sessionManager.client;
        const sonuclar = sonuclariOku(listeYolu, ayarlar.senaryo);
        const bekleyenler = ogeler.filter((o) => o.durum !== 'onceden-gonderildi');
        // Şablondaki {sütunAdı} ifadeleri her alıcı için kendi kaydından
        // doldurulur; sonuç boşsa (dosya senaryolarında) yalnızca dosya gider.
        const sablon = String(ayarlar.mesaj ?? '');
        // Sonuç kaydında dosya adı: kişisel senaryoda kaydın kendi dosyası,
        // aynı-dosya senaryosunda ortak dosya, mesaj senaryosunda yok.
        let gonderilen = 0;

        try {
            for (let i = 0; i < bekleyenler.length; i++) {
                if (this.iptalEdildi) {
                    break;
                }

                const oge = bekleyenler[i];
                const dosyaAdi = ayarlar.senaryo === SENARYOLAR.kisiselDosya
                    ? (oge.dosya ?? null)
                    : (ayarlar.dosyaAdi ?? null);
                this.onProgress({ numara: oge.numara, durum: 'gonderiliyor' });

                try {
                    const mesaj = mesajiOlustur(sablon, oge).trim();
                    await this.ogeGonder(client, oge, ayarlar, mesaj);

                    gonderilen++;
                    sonuclar[oge.numara] = {
                        durum: 'basarili',
                        uye: oge.ad ?? null,
                        dosya: dosyaAdi,
                        zaman: new Date().toISOString(),
                    };
                    this.onProgress({ numara: oge.numara, durum: 'basarili' });
                } catch (error) {
                    sonuclar[oge.numara] = {
                        durum: 'hata',
                        uye: oge.ad ?? null,
                        dosya: dosyaAdi,
                        hata: error.message,
                        zaman: new Date().toISOString(),
                    };
                    this.onProgress({ numara: oge.numara, durum: 'hata', hata: error.message });
                }

                sonuclariYaz(listeYolu, ayarlar.senaryo, sonuclar);

                if (i < bekleyenler.length - 1 && !this.iptalEdildi) {
                    const saniye = rastgeleGecikmeSn(ayarlar.minGecikme, ayarlar.maxGecikme);
                    this.onProgress({ durum: 'bekleme', saniye: Math.round(saniye) });
                    await this.beklenebilirGecikme(saniye);
                }
            }
        } finally {
            this.calisiyor = false;
        }

        return { gonderilen, iptalEdildi: this.iptalEdildi };
    }
}

module.exports = { Gonderici };
