const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

/**
 * Bu uzantılar sohbette görüntülü önizlemeyle (fotoğraf/video) gönderilir;
 * diğer tüm dosya türleri WhatsApp'a belge olarak gider.
 */
const RESIM_UZANTILARI = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const VIDEO_UZANTILARI = ['.mp4'];

const BUYUK_DOSYA_ESIGI = 64 * 1024 * 1024;

/**
 * Gönderim senaryoları. Değerleri dosya adında da kullanıldığından
 * (senaryoya özel sonuç dosyası) dosya-güvenli tutulur.
 *   mesaj        → herkese yalnızca yazılı mesaj (dosya yok)
 *   ayni-dosya   → herkese tek bir ortak dosya (mesaj isteğe bağlı)
 *   kisisel-dosya→ herkese listedeki kendi dosyası (mesaj isteğe bağlı)
 */
const SENARYOLAR = {
    mesaj: 'mesaj',
    ayniDosya: 'ayni-dosya',
    kisiselDosya: 'kisisel-dosya',
};

/**
 * Tek bir dosyayı gönderim için denetler; türünü (belge mi) ve boyut
 * uyarısını döndürür. "Aynı dosya" senaryosunda arayüzden seçilen dosya
 * için kullanılır.
 *
 * @return {{gecerli: boolean, hata?: string, belgeMi?: boolean, buyuk?: boolean}}
 */
function dosyaDenetle(dosyaYolu) {
    const uzanti = path.extname(dosyaYolu).toLowerCase();

    if (uzanti === '') {
        return { gecerli: false, hata: 'Dosya uzantısız; türü belirlenemedi.' };
    }

    if (!fs.existsSync(dosyaYolu)) {
        return { gecerli: false, hata: 'Dosya bulunamadı.' };
    }

    return {
        gecerli: true,
        belgeMi: !RESIM_UZANTILARI.includes(uzanti) && !VIDEO_UZANTILARI.includes(uzanti),
        buyuk: fs.statSync(dosyaYolu).size > BUYUK_DOSYA_ESIGI,
    };
}

/**
 * Aynı bilgiye farklı sütun adlarıyla erişilebilsin diye eş anlamlı gruplar.
 * Kayıt çözümlemede, {değişken} yerleştirmede ve Excel başlık satırını
 * bulmada kullanılır; karşılaştırmalar büyük/küçük harf duyarsızdır.
 */
const ALAN_GRUPLARI = {
    numara: ['numara', 'telefon', 'tel', 'gsm', 'cep'],
    // "id" ve "img" üye export'ları için: hangisinin dosya adı taşıdığı
    // export sürümüne göre değişir; otomatikEsleme() örnek değerlere bakarak
    // dosya adına benzeyeni (uzantılı, URL olmayan) tercih eder.
    dosya: ['resim', 'dosya', 'id', 'img'],
    ad: ['ad', 'name', 'isim'],
};

const TUM_TAKMA_ADLAR = Object.values(ALAN_GRUPLARI).flat();

/**
 * "0532...", "532...", "+90 532..." gibi girişleri 90XXXXXXXXXX biçimine
 * çevirir. Türkiye numaraları önceliklidir; başka ülke koduyla başlayan
 * uzun numaralar olduğu gibi bırakılır.
 */
function numaraNormallestir(ham) {
    const rakamlar = String(ham).replace(/\D/g, '');

    if (rakamlar.length === 10 && rakamlar.startsWith('5')) {
        return `90${rakamlar}`;
    }

    if (rakamlar.length === 11 && rakamlar.startsWith('05')) {
        return `9${rakamlar}`;
    }

    return rakamlar;
}

/**
 * Sonuç/devam dosyası senaryoya göre ayrılır: aynı listeyle önce mesaj,
 * sonra dosya gönderimi yapıldığında birbirini "gönderildi" sanıp
 * atlamasın diye her senaryonun kendi kaydı olur.
 */
function sonucDosyaYolu(listeYolu, senaryo) {
    return `${listeYolu}.${senaryo}.sonuclar.json`;
}

function sonuclariOku(listeYolu, senaryo) {
    const dosya = sonucDosyaYolu(listeYolu, senaryo);

    if (!fs.existsSync(dosya)) {
        return {};
    }

    try {
        return JSON.parse(fs.readFileSync(dosya, 'utf8'));
    } catch {
        return {};
    }
}

function sonuclariYaz(listeYolu, senaryo, sonuclar) {
    fs.writeFileSync(sonucDosyaYolu(listeYolu, senaryo), JSON.stringify(sonuclar, null, 2));
}

/**
 * exceljs hücre değerleri sayı, tarih, formül sonucu, zengin metin ya da
 * köprü nesnesi olabilir; hepsini düz metne indirger.
 */
function hucreMetni(deger) {
    if (deger === null || deger === undefined) {
        return '';
    }

    if (deger instanceof Date) {
        return deger.toLocaleDateString('tr-TR');
    }

    if (typeof deger === 'object') {
        if (Array.isArray(deger.richText)) {
            return deger.richText.map((parca) => parca.text).join('');
        }
        if (deger.text !== undefined) {
            return String(deger.text);
        }
        if (deger.result !== undefined) {
            return hucreMetni(deger.result);
        }
        return String(deger);
    }

    return String(deger);
}

function jsonSatirlariOku(dosyaYolu) {
    const icerik = JSON.parse(fs.readFileSync(dosyaYolu, 'utf8'));
    const satirlar = Array.isArray(icerik) ? icerik : icerik.gonderimler;

    if (!Array.isArray(satirlar)) {
        throw new Error('Beklenen biçim: bir dizi ya da { "gonderimler": [...] } nesnesi.');
    }

    return satirlar;
}

const BASLIK_ARAMA_SINIRI = 10;

/**
 * Sütun başlık satırı, ilk satırlar içinde bilinen bir sütun adı (tel,
 * telefon, isim, resim, dosya…) barındıran ilk satır olarak aranır.
 * Numbers/LibreOffice export'ları en üste "Tablo 1" gibi bir ad satırı
 * koyar; bu satırlar böylece kendiliğinden atlanır. Bilinen ad hiç yoksa
 * en az iki dolu hücresi olan ilk satır başlık kabul edilir (sütunlar
 * sonra arayüzden elle eşleştirilebilir). Başlık satırından sonraki her
 * satır bir kayda dönüşür; tamamen boş satırlar atlanır.
 */
async function excelSatirlariOku(dosyaYolu) {
    const calisma = new ExcelJS.Workbook();
    await calisma.xlsx.readFile(dosyaYolu);

    const sayfa = calisma.worksheets[0];
    if (!sayfa) {
        throw new Error('Excel dosyasında sayfa bulunamadı.');
    }

    let baslikSatirNo = 0;
    const basliklar = [];

    const aramaSiniri = Math.min(sayfa.rowCount, BASLIK_ARAMA_SINIRI);
    const satirHucreleri = new Map();
    for (let satirNo = 1; satirNo <= aramaSiniri && !baslikSatirNo; satirNo++) {
        const hucreler = new Map();
        sayfa.getRow(satirNo).eachCell({ includeEmpty: false }, (hucre, sutun) => {
            const metin = hucreMetni(hucre.value).trim();
            if (metin !== '') {
                hucreler.set(sutun, metin);
            }
        });
        satirHucreleri.set(satirNo, hucreler);

        if ([...hucreler.values()].some((metin) => TUM_TAKMA_ADLAR.includes(kucukHarf(metin)))) {
            baslikSatirNo = satirNo;
        }
    }

    if (!baslikSatirNo) {
        // Bilinen sütun adı yok; en az iki dolu hücreli ilk satırı başlık
        // say ki kullanıcı sütunları arayüzden elle eşleştirebilsin.
        for (const [satirNo, hucreler] of satirHucreleri) {
            if (hucreler.size >= 2) {
                baslikSatirNo = satirNo;
                break;
            }
        }
    }

    if (!baslikSatirNo) {
        throw new Error(
            `Sütun başlık satırı bulunamadı. İlk ${aramaSiniri} satır içinde sütun adlarını `
            + `içeren bir başlık satırı olmalı (örn. "${ALAN_GRUPLARI.numara.join('", "')}").`,
        );
    }

    for (const [sutun, metin] of satirHucreleri.get(baslikSatirNo)) {
        basliklar[sutun] = metin;
    }

    const satirlar = [];
    sayfa.eachRow({ includeEmpty: false }, (satir, satirNo) => {
        if (satirNo <= baslikSatirNo) {
            return;
        }

        const kayit = {};
        let dolu = false;
        satir.eachCell({ includeEmpty: false }, (hucre, sutun) => {
            const baslik = basliklar[sutun];
            if (!baslik) {
                return;
            }
            const deger = hucreMetni(hucre.value).trim();
            kayit[baslik] = deger;
            if (deger !== '') {
                dolu = true;
            }
        });

        if (dolu) {
            satirlar.push(kayit);
        }
    });

    return satirlar;
}

/**
 * Kayıttaki tüm alanları {değişken} yerleştirmede kullanılmak üzere
 * düz metin değerli bir nesneye çevirir.
 */
function alanlariHazirla(satir) {
    const alanlar = {};
    for (const [anahtar, deger] of Object.entries(satir)) {
        if (typeof anahtar === 'string' && anahtar.trim() !== '') {
            alanlar[anahtar.trim()] = hucreMetni(deger).trim();
        }
    }
    return alanlar;
}

/**
 * Karşılaştırma amaçlı küçük harfe çevirir. Türkçe'de "ISIM"ın küçüğü
 * "ısım" olduğundan (noktasız ı) "isim" ile eşleşmez; bu yüzden ı→i
 * katlanır. Yalnızca eşleştirme/tekilleştirmede kullanılır, görüntüleme
 * için kullanılmaz.
 */
function kucukHarf(metin) {
    return String(metin).toLocaleLowerCase('tr').replace(/ı/g, 'i');
}

/**
 * Kayıttan, belirtilen sütunun dolu değerini döndürür. Sütun adı
 * büyük/küçük harf duyarsız eşleşir ("TEL", "Tel", "tel" hepsi geçerli).
 * Sütun yoksa ya da değer boşsa undefined döner.
 */
function sutunDegeri(satir, sutun) {
    if (!sutun) {
        return undefined;
    }

    const aranan = kucukHarf(String(sutun).trim());
    const anahtar = Object.keys(satir).find((a) => kucukHarf(String(a).trim()) === aranan);

    if (anahtar === undefined) {
        return undefined;
    }

    const deger = satir[anahtar];
    if (deger === null || deger === undefined || hucreMetni(deger).trim() === '') {
        return undefined;
    }

    return deger;
}

/**
 * Verilen adın listedeki gerçek sütun adı karşılığını (orijinal yazımıyla)
 * bulur; yoksa null döner.
 */
function sutunBul(alanAdlari, ad) {
    if (ad === null || ad === undefined || String(ad).trim() === '') {
        return null;
    }
    const aranan = kucukHarf(String(ad).trim());
    return alanAdlari.find((a) => kucukHarf(a) === aranan) ?? null;
}

/**
 * Değer yerel bir dosya adına benziyor mu? (uzantısı var ve web adresi
 * değil) Otomatik eşlemede "id" mi "img" mi dosya taşıyor ayrımı için
 * kullanılır.
 */
function dosyayaBenziyor(deger) {
    const metin = hucreMetni(deger).trim();
    return metin !== '' && !/^https?:\/\//i.test(metin) && path.extname(metin) !== '';
}

/**
 * Sütunun ilk dolu değerini örnek olarak döndürür; hiç yoksa undefined.
 */
function ornekDeger(satirlar, sutun) {
    for (const satir of satirlar) {
        if (satir === null || typeof satir !== 'object') {
            continue;
        }
        const deger = sutunDegeri(satir, sutun);
        if (deger !== undefined) {
            return deger;
        }
    }
    return undefined;
}

/**
 * Sütunları takma adlara göre kendiliğinden eşler. Dosya alanında birden
 * fazla aday varsa (örn. hem "id" hem "img"), örnek değeri dosya adına
 * benzeyen (uzantılı, URL olmayan) aday tercih edilir; yoksa takma ad
 * sırası geçerlidir.
 */
function otomatikEsleme(alanAdlari, satirlar) {
    const esleme = { numara: null, ad: null, dosya: null };

    for (const [alan, grup] of Object.entries(ALAN_GRUPLARI)) {
        const adaylar = grup
            .map((takmaAd) => sutunBul(alanAdlari, takmaAd))
            .filter((sutun) => sutun !== null);

        if (adaylar.length === 0) {
            continue;
        }

        if (alan === 'dosya' && adaylar.length > 1) {
            const dosyaGibi = adaylar.find((sutun) => dosyayaBenziyor(ornekDeger(satirlar, sutun)));
            esleme[alan] = dosyaGibi ?? adaylar[0];
        } else {
            esleme[alan] = adaylar[0];
        }
    }

    return esleme;
}

/**
 * Kullanıcının arayüzden seçtiği eşlemeyi otomatik eşlemeyle birleştirir.
 * İstekte bulunan alanlar aynen kullanılır (geçersiz sütun adı → null,
 * boş dize → bilerek "yok" seçilmiş); istekte olmayan alanlar otomatik
 * eşlemeden gelir.
 */
function eslemeCoz(istek, alanAdlari, satirlar) {
    const otomatik = otomatikEsleme(alanAdlari, satirlar);

    if (istek === null || istek === undefined || typeof istek !== 'object') {
        return otomatik;
    }

    const esleme = {};
    for (const alan of Object.keys(otomatik)) {
        esleme[alan] = alan in istek ? sutunBul(alanAdlari, istek[alan]) : otomatik[alan];
    }
    return esleme;
}

/**
 * İstenen alanın değerini kayıttan bulur; sütun adı ve eş anlamlıları
 * büyük/küçük harf duyarsız aranır. Sütun hiç yoksa null, varsa (boş olsa
 * bile) metin döner.
 */
function alanDegeri(oge, alan) {
    const aranan = kucukHarf(alan.trim());
    const anahtarlar = new Map(
        Object.keys(oge.alanlar).map((anahtar) => [kucukHarf(anahtar), anahtar]),
    );

    const adaylar = [aranan];
    for (const grup of Object.values(ALAN_GRUPLARI)) {
        if (grup.includes(aranan)) {
            adaylar.push(...grup.filter((a) => a !== aranan));
        }
    }

    for (const aday of adaylar) {
        if (anahtarlar.has(aday)) {
            return oge.alanlar[anahtarlar.get(aday)];
        }
    }

    return null;
}

const YER_TUTUCU_DESENI = /\{([^{}|]+)(?:\|([^{}]*))?\}/g;

/**
 * Mesaj şablonundaki {sütunAdı} ifadelerini kaydın değerleriyle doldurur.
 * {sütunAdı|yedek ifade} yazımıyla boş değerler için yedek verilebilir.
 * Bilinmeyen sütun adları (muhtemel yazım hatası) olduğu gibi bırakılır;
 * sablonUyarilari() bunları önceden raporlar.
 */
function mesajiOlustur(sablon, oge) {
    return String(sablon).replace(YER_TUTUCU_DESENI, (tam, alan, yedek) => {
        const deger = alanDegeri(oge, alan);

        if (deger === null) {
            return yedek !== undefined ? yedek : tam;
        }

        if (deger === '') {
            return yedek !== undefined ? yedek : '';
        }

        return deger;
    });
}

/**
 * Gönderim öncesi şablondaki değişkenleri denetler: hiçbir kayıtta olmayan
 * sütunlar ve boş değer sayıları için kullanıcıya uyarı üretir.
 *
 * @return string[]
 */
function sablonUyarilari(sablon, ogeler) {
    const uyarilar = [];
    const bekleyenler = ogeler.filter((o) => o.durum !== 'onceden-gonderildi');

    if (bekleyenler.length === 0) {
        return uyarilar;
    }

    const alanlar = new Set(
        [...String(sablon).matchAll(YER_TUTUCU_DESENI)].map((eslesme) => eslesme[1].trim()),
    );

    for (const alan of alanlar) {
        const bilinmeyen = bekleyenler.filter((o) => alanDegeri(o, alan) === null).length;
        const bos = bekleyenler.filter((o) => alanDegeri(o, alan) === '').length;

        if (bilinmeyen === bekleyenler.length) {
            uyarilar.push(`"{${alan}}" listede böyle bir sütun yok; metin olduğu gibi gönderilir.`);
        } else if (bos > 0) {
            uyarilar.push(`${bos} kayıtta "${alan}" değeri boş; yedek ifade ({${alan}|yedek}) tanımlanmadıysa boş geçilir.`);
        }
    }

    return uyarilar;
}

/**
 * JSON ya da Excel (.xlsx) listesini okuyup doğrular.
 *
 * Sütunlar önce takma adlarla kendiliğinden eşlenir (büyük/küçük harf
 * duyarsız): numara|telefon|tel|gsm|cep, resim|dosya|id|img, ad|name|isim.
 * `eslemeIstegi` ile ({numara, ad, dosya} → sütun adı ya da null) bu eşleme
 * arayüzden elle değiştirilebilir; dönen `esleme` fiilen kullanılan eşlemedir.
 * Kayıttaki tüm sütunlar {değişken} olarak mesaj şablonunda kullanılabilir.
 * Mesaj metni uygulama arayüzünden alınır. Dosya yolları liste dosyasının
 * bulunduğu klasöre göre çözülür; resim ve video dışındaki türler WhatsApp'a
 * belge olarak gönderilir.
 *
 * Senaryo dosya doğrulamasını belirler: yalnızca "kisisel-dosya"da her
 * kaydın kendi dosyası zorunludur ve denetlenir. "mesaj" ve "ayni-dosya"
 * senaryolarında liste yalnızca numara (ve isteğe bağlı değişkenler) taşır.
 */
async function listeYukle(dosyaYolu, senaryo = SENARYOLAR.kisiselDosya, eslemeIstegi = null) {
    const hatalar = [];
    let ham;

    try {
        ham = path.extname(dosyaYolu).toLowerCase() === '.xlsx'
            ? await excelSatirlariOku(dosyaYolu)
            : jsonSatirlariOku(dosyaYolu);
    } catch (error) {
        return {
            ogeler: [],
            hatalar: [`Dosya okunamadı: ${error.message}`],
            alanAdlari: [],
            esleme: { numara: null, ad: null, dosya: null },
        };
    }

    const kisiselDosya = senaryo === SENARYOLAR.kisiselDosya;
    const klasor = path.dirname(dosyaYolu);
    const oncekiSonuclar = sonuclariOku(dosyaYolu, senaryo);
    const gorulenNumaralar = new Set();
    const ogeler = [];

    const alanAdlari = [];
    for (const satir of ham) {
        if (satir === null || typeof satir !== 'object') {
            continue;
        }
        for (const anahtar of Object.keys(satir)) {
            const ad = String(anahtar).trim();
            if (ad !== '' && !alanAdlari.some((mevcut) => kucukHarf(mevcut) === kucukHarf(ad))) {
                alanAdlari.push(ad);
            }
        }
    }

    const esleme = eslemeCoz(eslemeIstegi, alanAdlari, ham);

    if (!esleme.numara) {
        hatalar.push('Telefon numarası sütunu bulunamadı. "Sütun eşleştirme" bölümünden numaraların bulunduğu sütunu seçin.');
        return { ogeler, hatalar, alanAdlari, esleme };
    }

    if (kisiselDosya && !esleme.dosya) {
        hatalar.push('Gönderilecek dosya sütunu bulunamadı. "Sütun eşleştirme" bölümünden dosya adlarının bulunduğu sütunu seçin.');
        return { ogeler, hatalar, alanAdlari, esleme };
    }

    ham.forEach((satir, i) => {
        const sira = i + 1;
        if (satir === null || typeof satir !== 'object') {
            hatalar.push(`Satır ${sira}: kayıt biçimi tanınamadı, atlandı.`);
            return;
        }

        const alanlar = alanlariHazirla(satir);

        const numaraHam = sutunDegeri(satir, esleme.numara);
        const resimHam = kisiselDosya ? sutunDegeri(satir, esleme.dosya) : undefined;
        const adHam = sutunDegeri(satir, esleme.ad);
        const ad = adHam !== undefined ? hucreMetni(adHam).trim() : null;
        const kimlik = ad ? ` (${ad})` : '';

        if (!numaraHam || String(numaraHam).trim() === '') {
            hatalar.push(`Satır ${sira}${kimlik}: telefon numarası ("${esleme.numara}" sütunu) boş, kayıt atlandı.`);
            return;
        }

        const numara = numaraNormallestir(numaraHam);
        if (numara.length < 11) {
            hatalar.push(`Satır ${sira}${kimlik}: "${numaraHam}" geçerli bir telefon numarası değil.`);
            return;
        }

        if (gorulenNumaralar.has(numara)) {
            hatalar.push(`Satır ${sira}${kimlik}: ${numara} listede birden fazla kez geçiyor, ilki kullanılacak.`);
            return;
        }
        gorulenNumaralar.add(numara);

        const oge = {
            sira,
            numaraHam: String(numaraHam),
            numara,
            ad: ad || null,
            alanlar,
            durum: (oncekiSonuclar[numara]?.durum === 'basarili') ? 'onceden-gonderildi' : 'bekliyor',
        };

        if (kisiselDosya) {
            if (!resimHam) {
                hatalar.push(`Satır ${sira}${kimlik}: gönderilecek dosya ("${esleme.dosya}" sütunu) belirtilmemiş, kayıt atlandı.`);
                return;
            }

            const dosyaMetni = hucreMetni(resimHam).trim();

            if (/^https?:\/\//i.test(dosyaMetni)) {
                hatalar.push(`Satır ${sira}${kimlik}: "${dosyaMetni}" bir web adresi; gönderim için yerel dosya adı gerekir (dosyalar liste ile aynı klasörde olmalı). Kayıt atlandı.`);
                return;
            }

            const kayitDosyaYolu = path.isAbsolute(dosyaMetni) ? dosyaMetni : path.join(klasor, dosyaMetni);
            const denetim = dosyaDenetle(kayitDosyaYolu);

            if (!denetim.gecerli) {
                hatalar.push(`Satır ${sira}${kimlik}: "${dosyaMetni}" — ${denetim.hata} Kayıt atlandı.`);
                return;
            }

            if (denetim.buyuk) {
                hatalar.push(`Satır ${sira}${kimlik}: "${dosyaMetni}" 64 MB'tan büyük; gönderim yavaş olabilir ya da WhatsApp tarafından reddedilebilir.`);
            }

            oge.dosya = dosyaMetni;
            oge.dosyaYolu = kayitDosyaYolu;
            oge.belgeMi = denetim.belgeMi;
        }

        ogeler.push(oge);
    });

    return { ogeler, hatalar, alanAdlari, esleme };
}

module.exports = {
    SENARYOLAR,
    listeYukle,
    dosyaDenetle,
    sonuclariOku,
    sonuclariYaz,
    numaraNormallestir,
    mesajiOlustur,
    sablonUyarilari,
};
