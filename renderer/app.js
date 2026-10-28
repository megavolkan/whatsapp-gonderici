const $ = (id) => document.getElementById(id);

const DURUM_ETIKETLERI = {
    kapali: 'Bağlı değil',
    baslatiliyor: 'Başlatılıyor…',
    'qr-bekleniyor': 'QR kod bekleniyor',
    dogrulandi: 'Doğrulandı, hazırlanıyor…',
    yukleniyor: 'Sohbetler yükleniyor…',
    hazir: 'Bağlı ✓',
    koptu: 'Bağlantı koptu',
    hata: 'Hata',
};

const OGE_DURUMLARI = {
    bekliyor: 'Bekliyor',
    gonderiliyor: 'Gönderiliyor…',
    basarili: 'Gönderildi ✓',
    hata: 'Hata',
    'onceden-gonderildi': 'Önceden gönderildi',
};

let ogeler = [];
let oturumHazir = false;
let gonderimSuruyor = false;
let senaryo = 'kisisel-dosya';
let listeYuklendi = false;
let dosyaSecildi = false;
let listeAlanAdlari = [];

function aktifSenaryo() {
    return document.querySelector('input[name="senaryo"]:checked')?.value ?? 'kisisel-dosya';
}

function kayitYaz(mesaj) {
    const kayit = $('kayit');
    const zaman = new Date().toLocaleTimeString('tr-TR');
    kayit.textContent += `[${zaman}] ${mesaj}\n`;
    kayit.scrollTop = kayit.scrollHeight;
}

function butonlariGuncelle() {
    const gonderilecekVar = ogeler.some((o) => o.durum !== 'onceden-gonderildi' && o.durum !== 'basarili');
    let gonderebilir = oturumHazir && gonderilecekVar && !gonderimSuruyor;

    if (senaryo === 'mesaj') {
        gonderebilir = gonderebilir && mesajMetniAl().trim() !== '';
    } else if (senaryo === 'ayni-dosya') {
        gonderebilir = gonderebilir && dosyaSecildi;
    }

    $('btn-gonder').disabled = !gonderebilir;
    $('btn-iptal').disabled = !gonderimSuruyor;
    $('btn-cikis').disabled = !oturumHazir;
    $('btn-baglan').disabled = gonderimSuruyor;
    $('btn-json-sec').disabled = gonderimSuruyor;
    $('btn-dosya-sec').disabled = gonderimSuruyor;
    $('mesaj-metni').contentEditable = gonderimSuruyor ? 'false' : 'true';
    document.querySelectorAll('input[name="senaryo"]').forEach((r) => {
        r.disabled = gonderimSuruyor;
    });
    ['esleme-numara', 'esleme-ad', 'esleme-dosya'].forEach((id) => {
        $(id).disabled = gonderimSuruyor;
    });
}

/**
 * Chip editörünün içeriğini, arka ucun beklediği düz metne çevirir:
 * chip'ler {sütunAdı} token'ına, satır sonları \n'e dönüşür. Böylece
 * gönderim/önizleme tarafı hiç değişmeden çalışır.
 */
function mesajMetniAl() {
    const serile = (node) => {
        let metin = '';
        node.childNodes.forEach((cocuk) => {
            if (cocuk.nodeType === Node.TEXT_NODE) {
                metin += cocuk.nodeValue;
            } else if (cocuk.nodeType === Node.ELEMENT_NODE) {
                if (cocuk.classList?.contains('chip')) {
                    metin += `{${cocuk.dataset.alan}}`;
                } else if (cocuk.tagName === 'BR') {
                    metin += '\n';
                } else {
                    if (metin !== '' && !metin.endsWith('\n')) {
                        metin += '\n';
                    }
                    metin += serile(cocuk);
                }
            }
        });
        return metin;
    };

    return serile($('mesaj-metni')).replace(/\u00A0/g, ' ');
}

/**
 * Silinebilir bir değişken chip'i (ör. {isim}) oluşturur. contentEditable
 * false olduğundan metin içinde tek parça (emoji gibi) davranır.
 */
function chipOlustur(alan) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.contentEditable = 'false';
    chip.dataset.alan = alan;
    chip.textContent = alan;

    const sil = document.createElement('button');
    sil.type = 'button';
    sil.className = 'chip-sil';
    sil.textContent = '×';
    sil.addEventListener('click', (olay) => {
        olay.preventDefault();
        chip.remove();
        onizlemeGuncelle();
        butonlariGuncelle();
    });

    chip.appendChild(sil);
    return chip;
}

/**
 * Chip'i (ardından bir boşlukla) imlecin bulunduğu yere ekler; imleç
 * editör içinde değilse metnin sonuna ekler.
 */
function chipEkle(alan) {
    const editor = $('mesaj-metni');
    editor.focus();

    const secim = window.getSelection();
    let aralik;
    if (secim.rangeCount > 0 && editor.contains(secim.anchorNode)) {
        aralik = secim.getRangeAt(0);
        aralik.deleteContents();
    } else {
        aralik = document.createRange();
        aralik.selectNodeContents(editor);
        aralik.collapse(false);
    }

    const chip = chipOlustur(alan);
    const bosluk = document.createTextNode(' ');
    aralik.insertNode(bosluk);
    aralik.insertNode(chip);

    aralik.setStartAfter(bosluk);
    aralik.collapse(true);
    secim.removeAllRanges();
    secim.addRange(aralik);

    onizlemeGuncelle();
    butonlariGuncelle();
}

/**
 * Yüklü listenin sütun adlarından tıklanabilir değişken paletini kurar.
 * Liste yoksa palet gizlenir.
 */
function paletiKur(alanAdlari) {
    const palet = $('degisken-palet');
    palet.querySelectorAll('.palet-tag').forEach((t) => t.remove());

    if (!alanAdlari || alanAdlari.length === 0) {
        palet.classList.add('gizli');
        return;
    }

    for (const alan of alanAdlari) {
        const tag = document.createElement('button');
        tag.type = 'button';
        tag.className = 'palet-tag';
        tag.textContent = alan;
        tag.addEventListener('click', () => chipEkle(alan));
        palet.appendChild(tag);
    }
    palet.classList.remove('gizli');
}

/**
 * Bir eşleştirme menüsünü liste sütunlarıyla doldurur ve seçili sütunu
 * işaretler. Zorunlu olmayan alanlar (isim, dosya) "— yok —" ile boş
 * bırakılabilir; zorunlu telefon alanında eşleşme yoksa "— seçin —"
 * yer tutucusu gösterilir.
 */
function eslemeSecimDoldur(select, secili, zorunlu) {
    select.innerHTML = '';

    if (!zorunlu || secili === null) {
        const bos = document.createElement('option');
        bos.value = '';
        bos.textContent = zorunlu ? '— seçin —' : '— yok —';
        if (zorunlu) {
            bos.disabled = true;
        }
        bos.selected = secili === null;
        select.appendChild(bos);
    }

    for (const alan of listeAlanAdlari) {
        const secenek = document.createElement('option');
        secenek.value = alan;
        secenek.textContent = alan;
        secenek.selected = alan === secili;
        select.appendChild(secenek);
    }
}

/**
 * Sütun eşleştirme panelini yüklü listenin sütunları ve fiilen kullanılan
 * eşlemeyle kurar. Dosya menüsü yalnızca kişisel-dosya senaryosunda görünür.
 */
function eslemePaneliKur(esleme) {
    const alan = $('esleme-alan');

    if (!listeYuklendi || listeAlanAdlari.length === 0) {
        alan.classList.add('gizli');
        return;
    }

    eslemeSecimDoldur($('esleme-numara'), esleme?.numara ?? null, true);
    eslemeSecimDoldur($('esleme-ad'), esleme?.ad ?? null, false);
    eslemeSecimDoldur($('esleme-dosya'), esleme?.dosya ?? null, false);

    $('esleme-dosya-kap').classList.toggle('gizli', senaryo !== 'kisisel-dosya');
    alan.classList.remove('gizli');
}

/**
 * Eşleştirme menülerindeki güncel seçimi, arka uca gönderilecek eşleme
 * isteğine çevirir (boş seçim → null, yani "bu alan yok").
 */
function eslemeAl() {
    if (!listeYuklendi) {
        return null;
    }

    return {
        numara: $('esleme-numara').value || null,
        ad: $('esleme-ad').value || null,
        dosya: $('esleme-dosya').value || null,
    };
}

/**
 * Seçili senaryoya göre arayüzü uyarlar: aynı-dosya alanı, mesaj zorunluluk
 * uyarısı ve dosya sütununun görünürlüğü. Liste zaten yüklüyse, doğrulama
 * senaryoya bağlı olduğu için liste yeniden doğrulanır.
 */
async function senaryoUiGuncelle() {
    senaryo = aktifSenaryo();

    $('ayni-dosya-alan').classList.toggle('gizli', senaryo !== 'ayni-dosya');
    $('mesaj-zorunlu-not').classList.toggle('gizli', senaryo !== 'mesaj');

    const mesajZorunlu = senaryo === 'mesaj';
    $('degisken-ipucu').textContent = mesajZorunlu
        ? 'Bu mesaj her alıcıya gönderilir. Yukarıdaki değişken etiketlerine tıklayarak listedeki bilgileri mesaja ekleyebilirsiniz (örn. "Sayın {name},").'
        : 'Bu metin her alıcıya dosyanın açıklaması olarak eklenir; tamamen silerseniz yalnızca dosya gönderilir. Yukarıdaki değişken etiketlerine tıklayarak listedeki bilgileri ekleyebilirsiniz.';

    if (listeYuklendi) {
        const sonuc = await window.api.listeYenidenDogrula(senaryo, eslemeAl());
        if (sonuc) {
            listeSonucunuUygula(sonuc, false);
        }
    }

    tabloyuCiz();
    butonlariGuncelle();
    onizlemeGuncelle();
}

let onizlemeZamanlayici = null;

async function onizlemeGuncelle() {
    const onizlemeAlani = $('mesaj-onizleme');
    const uyariAlani = $('mesaj-uyarilar');

    if (ogeler.length === 0) {
        onizlemeAlani.classList.add('gizli');
        uyariAlani.classList.add('gizli');
        return;
    }

    const sonuc = await window.api.mesajOnizle(mesajMetniAl());
    if (!sonuc) {
        onizlemeAlani.classList.add('gizli');
        uyariAlani.classList.add('gizli');
        return;
    }

    onizlemeAlani.textContent = sonuc.onizleme === ''
        ? `Önizleme (${sonuc.kime}): — mesaj boş, yalnızca dosya gönderilecek —`
        : `Önizleme (${sonuc.kime}): ${sonuc.onizleme}`;
    onizlemeAlani.classList.remove('gizli');

    if (sonuc.uyarilar.length > 0) {
        uyariAlani.textContent = `⚠️ ${sonuc.uyarilar.join(' ')}`;
        uyariAlani.classList.remove('gizli');
    } else {
        uyariAlani.classList.add('gizli');
    }
}

function onizlemeyiPlanla() {
    clearTimeout(onizlemeZamanlayici);
    onizlemeZamanlayici = setTimeout(onizlemeGuncelle, 300);
}

function ozetGuncelle() {
    const say = (durumlar) => ogeler.filter((o) => durumlar.includes(o.durum)).length;
    $('ozet-hazir').textContent = `${say(['bekliyor', 'gonderiliyor'])} bekliyor`;
    $('ozet-onceden').textContent = `${say(['onceden-gonderildi', 'basarili'])} gönderildi`;
    $('ozet-hata').textContent = `${say(['hata'])} hatalı`;
    $('liste-ozet').classList.remove('gizli');
}

function tabloyuCiz() {
    const dosyaGoster = senaryo === 'kisisel-dosya';
    $('th-dosya').classList.toggle('gizli', !dosyaGoster);

    const tbody = $('liste-tablo').querySelector('tbody');
    tbody.innerHTML = '';

    for (const oge of ogeler) {
        const tr = document.createElement('tr');
        tr.dataset.numara = oge.numara;
        tr.dataset.durum = oge.durum;

        const hucreler = [
            { metin: oge.sira },
            { metin: oge.ad ?? '' },
            { metin: oge.numara },
        ];
        if (dosyaGoster) {
            hucreler.push({ metin: oge.dosya ?? '', baslik: oge.dosyaYolu });
        }
        hucreler.push({ metin: OGE_DURUMLARI[oge.durum] ?? oge.durum, sinif: 'durum-hucre' });

        for (const hucre of hucreler) {
            const td = document.createElement('td');
            td.textContent = hucre.metin;
            if (hucre.baslik) td.title = hucre.baslik;
            if (hucre.sinif) td.className = hucre.sinif;
            tr.appendChild(td);
        }

        tbody.appendChild(tr);
    }

    $('tablo-kap').classList.toggle('gizli', ogeler.length === 0);
    ozetGuncelle();
}

/**
 * Liste yükleme/yeniden doğrulama sonucunu arayüze uygular. logla=false
 * olduğunda (senaryo değişiminde yeniden doğrulama) kayıt alanına yeniden
 * özet yazılmaz.
 */
function listeSonucunuUygula(sonuc, logla) {
    ogeler = sonuc.ogeler;
    listeYuklendi = true;
    listeAlanAdlari = sonuc.alanAdlari;
    $('json-yolu').textContent = sonuc.listeYolu;
    eslemePaneliKur(sonuc.esleme);

    const hataListesi = $('hata-listesi');
    hataListesi.innerHTML = '';
    if (sonuc.hatalar.length > 0) {
        for (const hata of sonuc.hatalar) {
            const li = document.createElement('li');
            li.textContent = hata;
            hataListesi.appendChild(li);
        }
        hataListesi.classList.remove('gizli');
    } else {
        hataListesi.classList.add('gizli');
    }

    paletiKur(sonuc.alanAdlari);

    if (logla) {
        kayitYaz(`Liste yüklendi: ${ogeler.length} kayıt, ${sonuc.hatalar.length} sorun.`);
        if (sonuc.esleme) {
            const e = sonuc.esleme;
            const dosyaBilgi = senaryo === 'kisisel-dosya' ? `, dosya: ${e.dosya ?? '—'}` : '';
            kayitYaz(`Sütun eşleştirme — telefon: ${e.numara ?? '—'}, isim: ${e.ad ?? '—'}${dosyaBilgi} (gerekirse "Sütun eşleştirme" bölümünden düzeltin).`);
        }
        if (sonuc.alanAdlari.length > 0) {
            kayitYaz(`Mesajda kullanılabilir değişkenler: ${sonuc.alanAdlari.map((a) => `{${a}}`).join(', ')}`);
        }
    }
}

function ogeDurumGuncelle(numara, durum, hata) {
    const oge = ogeler.find((o) => o.numara === numara);
    if (oge) {
        oge.durum = durum;
    }

    const tr = document.querySelector(`tr[data-numara="${numara}"]`);
    if (tr) {
        tr.dataset.durum = durum;
        tr.querySelector('.durum-hucre').textContent =
            durum === 'hata' && hata ? `Hata: ${hata}` : (OGE_DURUMLARI[durum] ?? durum);
        tr.scrollIntoView({ block: 'nearest' });
    }

    ozetGuncelle();
}

function ilerlemeGuncelle() {
    const toplam = ogeler.length;
    const biten = ogeler.filter((o) => ['basarili', 'hata', 'onceden-gonderildi'].includes(o.durum)).length;
    $('ilerleme-kap').classList.remove('gizli');
    $('ilerleme-dolgu').style.width = toplam ? `${(biten / toplam) * 100}%` : '0';
    $('ilerleme-metin').textContent = `${biten} / ${toplam}`;
}

$('btn-baglan').addEventListener('click', () => {
    window.api.oturumBaslat($('oturum-adi').value);
    kayitYaz(`"${$('oturum-adi').value}" oturumu başlatılıyor…`);
});

$('btn-cikis').addEventListener('click', async () => {
    await window.api.oturumKapat();
    kayitYaz('Oturum kapatıldı.');
});

$('btn-json-sec').addEventListener('click', async () => {
    const sonuc = await window.api.listeSec(senaryo);
    if (!sonuc) {
        return;
    }

    listeSonucunuUygula(sonuc, true);
    tabloyuCiz();
    butonlariGuncelle();
    onizlemeGuncelle();
});

$('btn-dosya-sec').addEventListener('click', async () => {
    const sonuc = await window.api.dosyaSec();
    if (!sonuc) {
        return;
    }

    if (sonuc.hata) {
        dosyaSecildi = false;
        $('dosya-adi').textContent = `Seçilemedi: ${sonuc.hata}`;
        kayitYaz(`Dosya seçilemedi: ${sonuc.hata}`);
    } else {
        dosyaSecildi = true;
        const tur = sonuc.belgeMi ? 'belge' : 'fotoğraf/video';
        $('dosya-adi').textContent = `${sonuc.ad} (${tur})`;
        kayitYaz(`Gönderilecek dosya: ${sonuc.ad}${sonuc.buyuk ? ' — ⚠️ 64 MB üstü, gönderim yavaş olabilir' : ''}`);
    }

    butonlariGuncelle();
});

document.querySelectorAll('input[name="senaryo"]').forEach((radio) => {
    radio.addEventListener('change', senaryoUiGuncelle);
});

['esleme-numara', 'esleme-ad', 'esleme-dosya'].forEach((id) => {
    $(id).addEventListener('change', async () => {
        const sonuc = await window.api.listeYenidenDogrula(senaryo, eslemeAl());
        if (!sonuc) {
            return;
        }
        listeSonucunuUygula(sonuc, false);
        kayitYaz(`Sütun eşleştirmesi güncellendi, liste yeniden doğrulandı: ${sonuc.ogeler.length} kayıt, ${sonuc.hatalar.length} sorun.`);
        tabloyuCiz();
        butonlariGuncelle();
        onizlemeGuncelle();
    });
});

function listeBilgiKapat() {
    $('liste-bilgi-modal').classList.add('gizli');
}

$('btn-liste-bilgi').addEventListener('click', () => {
    $('liste-bilgi-modal').classList.remove('gizli');
});

$('btn-liste-bilgi-kapat').addEventListener('click', listeBilgiKapat);

$('liste-bilgi-modal').addEventListener('click', (olay) => {
    if (olay.target === $('liste-bilgi-modal')) {
        listeBilgiKapat();
    }
});

document.addEventListener('keydown', (olay) => {
    if (olay.key === 'Escape' && !$('liste-bilgi-modal').classList.contains('gizli')) {
        listeBilgiKapat();
    }
});

$('mesaj-metni').addEventListener('input', () => {
    // Chromium boş contenteditable'da <br> bırakabilir; placeholder'ın
    // görünmesi için tamamen boşsa içeriği temizle.
    const editor = $('mesaj-metni');
    if (editor.textContent.trim() === '' && !editor.querySelector('.chip')) {
        editor.innerHTML = '';
    }
    onizlemeyiPlanla();
    butonlariGuncelle();
});

$('btn-gonder').addEventListener('click', async () => {
    gonderimSuruyor = true;
    butonlariGuncelle();
    ilerlemeGuncelle();
    kayitYaz('Gönderim başladı.');

    try {
        const sonuc = await window.api.gonderimBaslat({
            minGecikme: Number($('min-gecikme').value),
            maxGecikme: Number($('max-gecikme').value),
            mesaj: mesajMetniAl(),
        });
        kayitYaz(sonuc.iptalEdildi
            ? `Gönderim durduruldu. Bu turda ${sonuc.gonderilen} mesaj gönderildi.`
            : `Gönderim tamamlandı. Bu turda ${sonuc.gonderilen} mesaj gönderildi.`);
    } catch (error) {
        kayitYaz(`Gönderim hatası: ${error.message}`);
    }

    gonderimSuruyor = false;
    butonlariGuncelle();
});

$('btn-iptal').addEventListener('click', () => {
    window.api.gonderimIptal();
    kayitYaz('Durdurma istendi, mevcut mesaj tamamlanıyor…');
});

window.api.onWaOlay((olay) => {
    if (olay.type === 'bilgi') {
        kayitYaz(olay.mesaj);
        return;
    }

    if (olay.type !== 'durum') {
        return;
    }

    const rozet = $('durum-rozet');
    rozet.dataset.durum = olay.durum;
    rozet.textContent = DURUM_ETIKETLERI[olay.durum] ?? olay.durum;

    oturumHazir = olay.durum === 'hazir';
    $('bagli-numara').textContent = oturumHazir && olay.numara ? `+${olay.numara}` : '';

    if (olay.durum === 'qr-bekleniyor' && olay.qr) {
        $('qr-resim').src = olay.qr;
        $('qr-alan').classList.remove('gizli');
    } else {
        $('qr-alan').classList.add('gizli');
    }

    if (olay.mesaj) {
        kayitYaz(olay.mesaj);
    }
    if (olay.durum === 'hazir') {
        kayitYaz(`WhatsApp bağlantısı hazır (+${olay.numara ?? '?'}).`);
    }

    butonlariGuncelle();
});

window.api.onIlerleme((ilerleme) => {
    if (ilerleme.durum === 'bekleme') {
        kayitYaz(`Sonraki mesaj için ${ilerleme.saniye} sn bekleniyor…`);
        return;
    }

    const oge = ogeler.find((o) => o.numara === ilerleme.numara);
    const kim = oge?.ad ? `${oge.ad} (${ilerleme.numara})` : ilerleme.numara;

    if (ilerleme.durum === 'gonderiliyor') {
        kayitYaz(`${kim} → gönderiliyor…`);
    } else if (ilerleme.durum === 'basarili') {
        kayitYaz(`${kim} → gönderildi ✓`);
    } else if (ilerleme.durum === 'hata') {
        kayitYaz(`${kim} → HATA: ${ilerleme.hata}`);
    }

    ogeDurumGuncelle(ilerleme.numara, ilerleme.durum, ilerleme.hata);
    ilerlemeGuncelle();
});

$('mesaj-metni').textContent = 'Sayın üyemiz, kira oran görseliniz ektedir. İyi çalışmalar dileriz.';
senaryoUiGuncelle();
butonlariGuncelle();
