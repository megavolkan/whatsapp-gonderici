# WhatsApp Gönderici

JSON veya Excel listesinden kişiye özel dosyaları (resim, PDF, Word, ZIP…), normal (ücretsiz) bir WhatsApp hesabı üzerinden gönderen masaüstü uygulaması. Windows ve Mac'te çalışır; Electron + [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) üzerine kuruludur.

> ⚠️ **Ban riski:** Bu uygulama WhatsApp'ın resmi API'sini kullanmaz; telefonunuzdaki hesabı WhatsApp Web gibi eşleştirerek çalışır. Normal hesaptan toplu gönderim WhatsApp kullanım koşullarına aykırıdır ve **numaranızın kalıcı olarak banlanmasına** yol açabilir. Önlemler:
> - Gecikme aralığını düşürmeyin (varsayılan 20–45 saniye).
> - Günde birkaç yüz mesajı aşmayın; ilk günlerde küçük partilerle ilerleyin.
> - Mümkünse asıl numaranız yerine ayrı bir numara kullanın.

## Gereksinimler

| Ortam | Gereken |
|---|---|
| Kullanım (paketlenmiş uygulama) | Chromium tabanlı bir tarayıcı: Google Chrome, Microsoft Edge, Brave veya Chromium. Windows'ta Edge hazır geldiği için genellikle ek kurulum gerekmez. |
| Geliştirme / paket üretme | Node.js 18+ ve npm |

Uygulama tarayıcıyı kendisi indirmez; sistemde kurulu olanı bulur. Tarayıcı standart dışı bir konumdaysa `WA_CHROME_PATH` ortam değişkeniyle tam yol verilebilir.

## Kurulum

### Hazır paketle (son kullanıcı)

1. GitHub'daki **Releases** sayfasından son sürümün dosyasını indirip çalıştırın: Mac'te `WhatsApp-Gonderici-<sürüm>-arm64.dmg`, Windows'ta `WhatsApp-Gonderici-<sürüm>-kurulum.exe`.
2. İmzasız uygulama uyarısı alırsanız: Mac'te uygulamaya sağ tıklayıp **Aç** deyin, Windows'ta SmartScreen uyarısında **Ek bilgi → Yine de çalıştır** seçin.

### Portable (kurulumsuz, yalnızca Windows)

`WhatsApp-Gonderici-<sürüm>-portable.exe` dosyası kurulum gerektirmez; USB bellekten dahi doğrudan çalıştırılabilir.

- Oturum verileri ve eşleştirmeler AppData'ya değil, exe'nin yanındaki `WhatsAppGondericiVerileri` klasörüne yazılır. Böylece exe'yi klasörüyle birlikte başka bir bilgisayara taşıdığınızda **QR'ı yeniden okutmanız gerekmez**.
- ⚠️ Bu klasör WhatsApp oturum kimliğinizi içerir — exe'yi taşıdığınız ortamı (özellikle USB belleği) güvenli tutun; hesabı bırakırken klasörü silin.
- Her açılışta kendini geçici klasöre açtığı için ilk açılış kurulu sürüme göre birkaç saniye daha yavaştır.

### Kaynak koddan (geliştirme)

```bash
git clone <repo-adresi>
cd whatsapp-gonderici
npm install
npm start
```

### Paket üretme

```bash
npm run dist:mac   # Mac için .dmg üretir (dist/ klasörüne)
npm run dist:win   # Windows için kurulum (Setup .exe) + portable .exe üretir
```

Not: Windows paketini Mac üzerinde de üretebilirsiniz; electron-builder bunu destekler.

### Sürüm yayınlama (otomatik)

`.github/workflows/release.yml`: `package.json`'daki `version` için henüz etiket yoksa, `master`'a yapılan gönderimde macOS ve Windows paketleri GitHub Actions'ta derlenir, `v<sürüm>` etiketi oluşturulur ve `.dmg`, kurulum `.exe` ve portable `.exe` bir GitHub sürümü (Release) olarak yayınlanır. Yeni sürüm için `version` alanını artırıp (ör. `npm version patch --no-git-tag-version`) gönderim yapmak yeterlidir; sürüm değişmeyen gönderimlerde derleme yapılmaz. Actions sekmesinden elle çalıştırma (Run workflow) yayınlamadan deneme derlemesi yapar.

## Kullanım

### 1. Ne yapmak istiyorsunuz? (senaryo seçimi)

Uygulama açılışında en üstteki karttan gönderim türünü seçin:

1. **Sadece yazılı mesaj** — Herkese metin gönderilir (dosya yok). `{sütunAdı}` ile kişiselleştirilebilir; mesaj zorunludur. Bayram/duyuru mesajı gibi.
2. **Herkese AYNI DOSYA** — Tek bir dosya seçip listedeki herkese gönderirsiniz. Mesaj isteğe bağlıdır.
3. **Herkese KİŞİSELLEŞTİRİLMİŞ AYRI DOSYALAR** — Her alıcıya listedeki kendi dosyası gönderilir. Mesaj isteğe bağlıdır.

Senaryo, liste doğrulamasını ve her senaryonun kendi devam kaydını (`.<senaryo>.sonuclar.json`) belirler; aynı listeyle önce mesaj sonra dosya göndermek istediğinizde birbirini "gönderildi" sanıp atlamaz. Liste yükledikten sonra senaryoyu değiştirirseniz liste otomatik yeniden doğrulanır.

### 2. WhatsApp hesabını bağlama

1. Uygulamayı açın, **Hesap (oturum) adı** girin (örn. `kampanya1`) ve **Bağlan**'a tıklayın.
2. Ekrana gelen QR kodu telefonunuzda **WhatsApp → Ayarlar → Bağlı Cihazlar → Cihaz Bağla** yolunu izleyerek okutun.
3. Durum rozeti **Bağlı ✓** olduğunda hazırsınız.

Oturum bilgisi diske kaydedilir; aynı oturum adıyla sonraki açılışlarda **QR gerekmez**. Farklı oturum adlarıyla birden fazla hesap eşleştirebilir, gönderen numarayı oturum adını değiştirerek seçebilirsiniz. **Oturumu Kapat** düğmesi hesabın eşleşmesini tamamen siler (yeniden QR gerekir).

### 3. Gönderim listesini hazırlama

Gönderilecek dosyalarla aynı klasöre bir JSON (**.json**) ya da Excel (**.xlsx**) listesi koyun (örnekler: [ornek/liste.json](ornek/liste.json), [ornek/liste.xlsx](ornek/liste.xlsx)).

**Excel:** İlk sayfadaki sütun başlık satırı otomatik bulunur: bilinen bir sütun adı (`tel`, `isim`, `resim` vb.) içeren ilk satır başlık kabul edilir, sonraki her satır bir alıcıdır. Numbers/LibreOffice export'larının en üste eklediği "Tablo 1" gibi ad satırları kendiliğinden atlanır. Bilinen ad hiç yoksa en az iki dolu hücreli ilk satır başlık sayılır (sütunları sonra uygulamada elle eşleştirirsiniz). Başlıklar büyük/küçük harf duyarsızdır (`TEL`, `Isim` vb. geçerli).

**JSON:**

```json
[
    { "resim": "gorsel_1.jpg", "ad": "Ahmet Yılmaz", "numara": "+905321234567" },
    { "resim": "resimler/mehmet.jpg", "ad": "Mehmet Kaya", "numara": "0544 111 22 33" }
]
```

- **numara** (zorunlu — takma adlar: `telefon`, `tel`, `gsm`, `cep`): `0532...`, `+90 532...`, `905...` biçimlerinin hepsi kabul edilir. Türkiye dışı numaralar ülke koduyla yazılmalıdır. Numarası boş olan kayıtlar adıyla birlikte raporlanır ve atlanır.
- **resim** (kişiselleştirilmiş dosya senaryosunda zorunlu — takma adlar: `dosya`, `id`, `img`; "sadece mesaj" ve "aynı dosya" senaryolarında gerekmez): Gönderilecek dosyanın liste dosyasının bulunduğu klasöre göre yolu. Alt klasör (`resimler/mehmet.jpg`) ve mutlak yol da kullanılabilir. **Her dosya türü gönderilebilir:** resimler (`.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`) fotoğraf, `.mp4` video, diğer tüm türler (PDF, Word, Excel, ZIP…) belge olarak gider. Uzantısız dosyalar atlanır; 64 MB üstü dosyalar için uyarı gösterilir.
- **ad** (isteğe bağlı — takma adlar: `name`, `isim`): Alıcının adı soyadı; tablodaki **Üye** sütununda ve gönderim kayıtlarında gösterilir.
- Aynı bilginin sütun adı tüm kayıtlarda aynı olmalıdır (bir kayıtta `tel`, diğerinde `numara` kullanmayın); telefon/isim/dosya için yukarıdaki takma adlardan herhangi biri seçilebilir.
- Tanınmayan alanlar kayıt doğrulamada yok sayılır ama mesaj değişkeni olarak kullanılabilir. Liste `{ "gonderimler": [...] }` şeklinde bir nesne içinde de verilebilir.

**Sütun eşleştirme:** Liste yüklendiğinde uygulama hangi sütunu telefon, isim ve dosya olarak kullandığını kayıt alanına yazar ve tablo üstünde bir **Sütun eşleştirme** paneli gösterir. Otomatik eşleştirme yanlış sütunu seçtiyse (örn. hem `id` hem `img` varken) ya da sütunlarınız bilinen adlarla eşleşmiyorsa, buradaki açılır menülerden doğru sütunu seçmeniz yeterlidir; liste anında yeniden doğrulanır. Dosya sütununda birden fazla aday varsa, değeri dosya adına benzeyen (uzantılı, web adresi olmayan) sütun kendiliğinden tercih edilir — tigader-filament üye export'u (`id`/`name`/`img`/`tel`) bu sayede değiştirilmeden doğrudan kullanılabilir.

### Mesajı kişiselleştirme: değişkenler

Mesaja, her alıcı için o kaydın kendi değeriyle dolacak **değişkenler** ekleyebilirsiniz. Listedeki **her sütun** kullanılabilir:

> `Sayın {ad}, {resim} adlı görseliniz ektedir.`
> → `Sayın Ahmet Yılmaz, gorsel_1.jpg adlı görseliniz ektedir.`

- **Kolay ekleme:** Liste yükledikten sonra mesaj kutusunun üstünde her sütun için birer değişken etiketi (`isim`, `tel`, …) çıkar. Bir etikete tıklayınca değişken, imlecin bulunduğu yere silinebilir bir "rozet" olarak eklenir (emoji gibi tek parça; üstündeki × ile ya da Backspace ile silinir). Aralara normal metin yazmaya devam edersiniz.
- İsterseniz elle de `{sütunAdı}` yazabilirsiniz. Sütun adları büyük/küçük harfe duyarsızdır; eş anlamlılar da çalışır (`{ad}` ↔ `{name}` ↔ `{isim}`, `{numara}` ↔ `{tel}` ↔ `{telefon}` ↔ `{gsm}` ↔ `{cep}`).
- **Boş değerler için yedek ifade:** elle `{name|üyemiz}` yazarsanız, ad boş olan alıcıya "üyemiz" yazılır.
- Mesaj kutusunun altında ilk alıcı üzerinden **canlı önizleme** gösterilir; yazım hatası olan bir sütun adı varsa uyarı orada belirir.

### 4. Gönderim

1. **Liste Dosyası Seç** ile JSON ya da Excel listesini yükleyin. Sorunlu satırlar (eksik dosya, geçersiz numara, tekrar eden kayıt) satır numarası ve varsa üye adıyla listelenir; geçerli kayıtlar tabloda görünür. Sütunlar yanlış eşleştiyse **Sütun eşleştirme** panelinden düzeltin (yukarıya bakın).
2. "Aynı dosya" senaryosunu seçtiyseniz **Gönderilecek Dosyayı Seç** ile ortak dosyayı belirleyin.
3. Mesaj metni dosyanın açıklaması olarak eklenir ve değişken etiketleriyle kişiselleştirilebilir (yukarıya bakın). Dosya senaryolarında mesajı tamamen silerseniz yalnızca dosya gönderilir; "sadece mesaj" senaryosunda mesaj zorunludur.
4. İsterseniz gecikme aralığını ayarlayın (gönderimler arasında bu aralıkta rastgele beklenir).
5. **Gönderimi Başlat**'a tıklayın. İlerleme tabloda ve alttaki kayıt alanında canlı izlenir.
6. **Durdur** ile gönderim istediğiniz an güvenle durdurulabilir (o anki mesaj tamamlanır).

Gönderim öncesi her numaranın WhatsApp'ta kayıtlı olup olmadığı denetlenir; kayıtlı olmayanlar hata olarak işaretlenir ve diğerleri etkilenmez.

### Sonuç dosyası ve kaldığı yerden devam

Her sonuç anında, liste dosyasının yanına **senaryoya özel** bir dosyaya yazılır: `liste.json` + kişiselleştirilmiş dosya senaryosu için `liste.json.kisisel-dosya.sonuclar.json` gibi. Bu sayede:

- Uygulama kapansa ya da gönderim durdurulsa bile aynı liste tekrar seçildiğinde **o senaryoda başarılı gönderilenler atlanır**, kalanlardan devam edilir.
- Her senaryonun kendi kaydı olduğundan, aynı listeyle önce mesaj sonra dosya göndermek birbirini etkilemez.
- Hangi numaraya ne zaman, hangi sonuçla gönderim yapıldığının kaydı elinizde olur.
- Bir senaryoyu baştan göndermek isterseniz ilgili `.<senaryo>.sonuclar.json` dosyasını silmeniz yeterlidir.

## Sorun giderme

| Belirti | Çözüm |
|---|---|
| "Chromium tabanlı tarayıcı bulunamadı" | Chrome veya Edge yükleyin; ya da `WA_CHROME_PATH` ile tarayıcının tam yolunu verin. |
| "Bu numara WhatsApp'ta kayıtlı değil" | Numara yanlış yazılmış olabilir ya da o numarada WhatsApp hesabı yoktur; JSON'daki kaydı düzeltin. |
| Bağlantı sık sık kopuyor | Telefonun internete bağlı olduğundan emin olun; oturumu kapatıp yeniden QR okutun. |
| Eşleştirme hiç tutmuyor | WhatsApp Web arayüzü değişmiş olabilir; `npm install whatsapp-web.js@latest` ile kütüphaneyi güncelleyin. |
| "Doğrulandı, hazırlanıyor…"da takılıyor | whatsapp-web.js'in güncel WhatsApp Web ile bilinen sorunu: `ready` olayı bazen hiç gelmiyor. Uygulama bunu aşmak için bağlantı durumunu yoklar ve `CONNECTED` olunca kendiliğinden devam eder (birkaç saniye sürebilir). Yine de takılırsa oturumu kapatıp yeniden QR okutun. |

## Proje yapısı

```
main.js              Electron ana süreci, IPC uçları
preload.js           Renderer ↔ ana süreç köprüsü
src/whatsapp.js      Oturum yönetimi (QR, LocalAuth, durum olayları)
src/gonderici.js     Gönderim kuyruğu: gecikme, iptal, sonuç kaydı
src/liste.js         JSON/Excel okuma, doğrulama, numara normalleştirme, {değişken} yerleştirme
src/chrome.js        Sistemde kurulu Chromium tabanlı tarayıcıyı bulma
renderer/            Arayüz (HTML/CSS/JS, Türkçe)
ornek/               Örnek gönderim listeleri (liste.json, liste.xlsx)
```
