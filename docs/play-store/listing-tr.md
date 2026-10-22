# Play Store sayfası (Türkçe, varsayılan dil)

Play Console → Büyüme → Mağazadaki varlık → Ana mağaza girişi. Metinler kodda olan
özellikleri anlatır; bir özellik kodda yoksa buraya yazılmaz. Karakter sayıları en alttaki
komutla ölçüldü (Play Unicode karakter sayar; "–" ve Türkçe harfler birer karakterdir).

## Uygulama adı (en çok 30 karakter)

```
Engapp – İngilizce Kelime Kartları
```

**34 karakter: sınırı aşıyor.** Plandaki ad Play'in 30 karakter sınırına sığmıyor. Seçenekler
(hepsi sığar):

| Ad | Karakter |
| --- | --- |
| `Engapp: İngilizce Kelime Kartı` | 30 |
| `Engapp – İngilizce Kelimeler` | 28 |
| `Engapp – Kelime Kartları` | 24 |

Önerim **`Engapp – İngilizce Kelimeler`** (28): "İngilizce" ve "kelime" aramaları adda kalır.
Sahibinin seçmesi gerekir (ADR 0035, "Sapmalar").

## Kısa açıklama (en çok 80 karakter)

```
İngilizce kelimeleri aralıklı tekrarla öğren; okuduğun metinden kart çıkar.
```

75 karakter.

## Tam açıklama (en çok 4000 karakter)

```
Engapp, İngilizce kelime ve kalıpları kalıcı olarak öğrenmen için yapılmış bir kelime kartı uygulamasıdır. Her gün birkaç dakika tekrar edersin; uygulama hangi kartı ne zaman göstereceğini senin cevaplarına göre planlar.

AKILLI TEKRAR
• Kartlar aralıklı tekrar yöntemiyle (FSRS) planlanır: zorlandığın kelimeler sık, iyi bildiklerin seyrek gelir.
• Günlük hedefini ve yeni kart sayısını sen belirlersin; tekrarlar biriktiğinde yük günlere yayılır.
• Sürekli unuttuğun kelimeler ve birbirine karıştırdığın kelime çiftleri ayrıca işaretlenir.

KELİME EKLEME
• Kelimeyi elle ekle: anlamını, örnek cümleni ve notunu kendin yaz.
• Okuduğun bir İngilizce metni yapıştır ya da PDF yükle; AI metindeki kelime ve kalıpları seviyene göre aday olarak çıkarır. Eklemeden önce hepsini görür, düzeltir, istemediklerini çıkarırsın.
• Anki destelerini içe aktarabilirsin.

KARTLARDA NELER VAR
• Türkçe anlam, sözcük türü, seviye (A1–C2) ve örnek cümleler.
• Kelimenin ve cümlelerin sesli okunuşu.
• Kelimeyi akılda tutmana yardım eden hatırlatıcı notlar.
• Yanlış bulduğun AI içeriğini gizleyebilir ya da düzeltebilirsin.

İLERLEMENİ GÖR
• Günlük seri ve çalışma takvimi.
• İngilizceden Türkçeye ve Türkçeden İngilizceye ne kadar hatırladığın, kategorilere göre tutma oranı.
• 5 dakikalık seviye testi ve haftalık özet rapor.

İNTERNETSİZ DE ÇALIŞIR
• Tekrarlar internet olmadan da yapılır; bağlandığında senkronlanır.
• İstersen hesap açmadan misafir olarak kullan: bütün verin yalnızca cihazında kalır.
• Google ile giriş yaparsan kartların telefonun ve bilgisayarın arasında senkronlanır.
• Açarsan günde en fazla bir tekrar hatırlatması alırsın.

VERİLERİN SENİN
• Reklam yok, verilerini satmıyoruz, izleme aracı yok.
• Bütün verilerini istediğin an JSON olarak indirebilirsin.
• Hesabını ve verilerini uygulamadan ya da web'den silebilirsin.

Bilmen gerekenler: AI özellikleri (metinden kelime çıkarma gibi) için Google ile giriş ve internet gerekir; günlük kullanım sınırı vardır. AI ile işlenen metinler Google Gemini'ye gönderilir; gizli ya da kişisel bilgi içeren metin gönderme. AI'ın önerdiği anlamlar her zaman doğru olmayabilir, eklemeden önce kontrol et. Uygulama 18 yaş ve üzeri kullanıcılar içindir.
```

2.200 karakter (sınır 4000).

Bilerek yazılmayanlar: "en iyi", "1 numara", "garantili", kullanıcı sayısı, puan, fiyat ya da
"ücretsiz" vaadi (Play'in meta veri politikası ve ileride ücretli katman ihtimali). Görsel kartlar
(İP3) yayımlanınca "KARTLARDA NELER VAR" bölümüne bir satır eklenir.

## Grafikler

| Alan | Dosya |
| --- | --- |
| Uygulama simgesi (512×512) | `graphics/icon-512.png` |
| Öne çıkan grafik (1024×500) | `graphics/feature-graphic-1024x500.png` |
| Telefon ekran görüntüleri (1080×1920; Play en az 2, en çok 8 ister) | `screenshots/1-…6-*-light.png` sırayla; istersen iki koyu tema görüntüsü (ör. `2-review-front-dark.png`, `4-add-from-text-dark.png`) 7. ve 8. sıraya |

Ekran görüntüleri sahte bir demo hesabıyla (Deniz Yılmaz, deniz@example.com) ve tohumlanmış demo
verisiyle üretilir; gerçek kişi ya da gerçek veri yoktur. Yeniden üretmek için:

```
node scripts/store-shots.ts            # CHROMIUM_PATH ile önceden kurulu Chromium
```

## Diğer alanlar

- **Kategori:** Eğitim. **Etiketler:** Dil öğrenme, Kelime.
- **İletişim e-postası:** `VITE_CONTACT_EMAIL` ile aynı adres.
- **Web sitesi:** uygulamanın adresi (`<APP_URL>`).
- **Gizlilik politikası:** `<APP_URL>/gizlilik`.

## Karakter kontrolü

```
node -e 'for (const s of process.argv.slice(1)) console.log([...s].length, s)' "Engapp – İngilizce Kelimeler" "İngilizce kelimeleri aralıklı tekrarla öğren; okuduğun metinden kart çıkar."
```
