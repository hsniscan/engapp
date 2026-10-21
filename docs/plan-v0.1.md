# ENG App v0.1 — Çekirdek Geliştirme Planı

Oct 21, 2026 · @Hasan Basri İşcan

Bu plan, Doc belgesindeki v0.1 sürümünün uygulanabilir adımlarıdır. Hedef: Hasan günlük kelime tekrarını tamamen bu uygulamada yapabilsin.

## Kapsam ve kabul ölçütleri

v0.1, tek kullanıcılı ve internetsiz çalışan bir web tekrar uygulamasıdır. Arayüz Türkçedir; çok dilli arayüz altyapısı baştan kurulur.

| v0.1'e girer | Sonraki sürüme kalır |
| --- | --- |
| FSRS tekrar oturumu, 3 kart tipi | Seviye testi ve kelime seviyesi (v0.2) |
| Elle kart ekleme, "AI ile doldur" butonu | Bağlam bazlı örnek cümle çeşitleri (v0.2) |
| Metin ve PDF'ten AI ile kelime/kalıp çıkarma + önizleme | Anki .apkg içe aktarma (v0.2) |
| Türkçe anlam, IPA, sesli okuma, kaynak cümle | İş yükü tahmini, telafi, tatil, bildirim (v0.3) |
| Misafir mod, Supabase hesabı, cihazlar arası senkron | Görseller (v0.4) |
| Süreklilik paneli | Native mobil, paylaş menüsü, URL içe aktarma (v0.5) |
| JSON yedek alma ve geri yükleme, CSV dışa aktarma | Cümle kurma, telaffuz, hikâyeler (v0.6) |
| PWA kurulumu, karanlık mod, WCAG AA | Paylaşım, ücretli model (v1.0) |

**Kabul ölçütleri** (her biri ölçülebilir; hepsi geçmeden v0.1 bitmiş sayılmaz)

1. Hasan 14 gün üst üste günlük tekrarını yalnızca bu uygulamada yapar.
2. Uçak modunda tekrar, kart ekleme ve süreklilik paneli çalışır. Bağlantı gelince 1 dakika içinde senkron tamamlanır, hiçbir tekrar kaydı kaybolmaz.
3. Aynı kart iki cihazda çevrimdışıyken farklı cevaplanırsa iki tekrar kaydı da korunur ve kartın durumu kayıtlardan yeniden hesaplanır.
4. 1.000 kartlık veride oturum 1 saniyeden kısa sürede açılır, kart geçişi 100 ms'nin altındadır.
5. 20 sayfalık bir PDF'ten aday kart listesi, AI kotası dolmamışsa 60 saniye içinde gelir.
6. Alınan JSON yedeği boş bir tarayıcıya geri yüklendiğinde kartlar, tekrar geçmişi ve seri bilgisi birebir aynıdır.
7. Lighthouse'ta uygulama kurulabilir görünür ve erişilebilirlik puanı en az 95'tir.
8. Aynı metin ikinci kez yüklendiğinde hiç AI çağrısı yapılmaz. Ortak sözlükte bulunan bir kelime ve anlam için AI'dan içerik üretmesi istenmez; sözlükte aynı kelime ve anlam için ikinci bir kayıt oluşmaz.

## Proje kurulumu

Tek repo, pnpm, TypeScript `strict` modda. Node.js en az 20 olmalı; ts-fsrs bunu şart koşuyor ([ts-fsrs belgeleri](https://open-spaced-repetition.github.io/ts-fsrs)).

**Kütüphaneler**

| Amaç | Paket | Not |
| --- | --- | --- |
| Arayüz | react, react-dom, vite, typescript | Ajan kurulum günündeki son kararlı sürümü kullanır |
| Yönlendirme | react-router | Sayfa sayısı az, ek karmaşa gerekmez |
| Yerel veri | dexie 4.x, dexie-react-hooks | Kurulum günündeki son 4.x sürümü |
| Tekrar algoritması | ts-fsrs 5.x | FSRS-6 uygular; kurulum günündeki son 5.x sürümü |
| Sunucu | @supabase/supabase-js | Hesap, veritabanı, sunucu fonksiyonları |
| PDF | pdfjs-dist | Metin çıkarma bir Web Worker içinde |
| Doğrulama | zod | AI cevapları, yedek dosyaları ve FSRS parametreleri sınırda doğrulanır |
| Stil | Tailwind CSS + Radix UI | Radix erişilebilir temel bileşenler sağlar |
| Animasyon | motion (eski adıyla Framer Motion) | Süre kademeleri tasarım bölümünde |
| PWA | vite-plugin-pwa | Service worker ve manifest |
| Tarih | date-fns | Gün sınırı kullanıcının saat dilimine göre hesaplanır |
| Dil | i18next | Arayüz metinleri tek sözlükte |
| Test | vitest, @testing-library/react, fake-indexeddb, playwright | Ayrıntı test bölümünde |
| Kod kalitesi | eslint, prettier | CI'da zorunlu |

**Klasör yapısı**

```
eng-app/
  AGENTS.md
  docs/
    architecture.md  data-model.md  sync-strategy.md
    ai-pipeline.md   phases.md      decisions/   (ADR kayıtları)
  src/
    domain/      saf TypeScript: FSRS sarmalayıcı, seri hesabı, kart tipleri
    data/        Dexie şeması, depolar (repository), göç adımları
    sync/        senkron motoru, outbox, çakışma kuralları
    ai/          sunucu fonksiyonlarını çağıran istemci
    features/    review, cards, import, stats, settings, auth
    ui/          tasarım sistemi bileşenleri
    i18n/        tr.json, en.json
    app/         yönlendirme, sağlayıcılar, PWA kaydı
  supabase/
    migrations/  SQL şeması ve RLS politikaları
    functions/   ai-extract, ai-enrich
  tests/e2e/
```

`domain/` hiçbir zaman React, Dexie veya ağ koduna bağlanmaz. Böylece en kritik mantık (planlama, seri, çakışma çözümü) tarayıcısız test edilir.

**Ortam değişkenleri**

- İstemci: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (herkese açık olabilir, güvenlik RLS'tedir)
- Yalnızca Supabase gizli ayarlarında: `GEMINI_API_KEY`, `GEMINI_MODEL`

**CI**

GitHub Actions her push'ta: tip kontrolü, lint, birim testleri, derleme. Ana dala birleştirmeden önce Playwright testleri de çalışır.

## Mimari

Asıl veri cihazdaki IndexedDB'dedir; arayüz yalnızca onu okur ve yazar. Sunucu iki iş yapar: cihazlar arası senkron ve AI çağrılarında API anahtarını saklamak.

&#91;embedded content: mimari · cihaz ve sunucu katmanları\]

Arayüz hiçbir zaman sunucuyu doğrudan beklemez: senkron motoru ve AI istemcisi arka planda çalışır, sonuçlarını Dexie'ye yazar, arayüz de Dexie'deki değişikliği canlı olarak gösterir.

## Veri modeli

Bir kelime tek bir nottur; kelimenin anlamları notun altında ayrı satırlardır (1. banka, 2. kıyı). Tanıma kartı nota, üretme ve boşluk doldurma kartları anlama bağlıdır. Kelime ve anlam bilgisinin kendisi (Türkçe karşılık, IPA, kısa tanım) tüm kullanıcıların paylaştığı ortak sözlükte bir kez tutulur; kullanıcının notu yalnızca bu kayda bağlantıyı ve kişisel verisini (kaynak cümle, düzeltme, etiket) taşır. Tekrar kayıtları hiç değişmez, yalnızca eklenir; kartın FSRS durumu bu kayıtlardan her zaman yeniden hesaplanabilir.

**Ortak kurallar**

- Kimlikler istemcide üretilen UUID v7'dir; çevrimdışı oluşturulan kayıt sunucuda çakışmaz.
- Senkronlanan her satırda `user_id`, `created_at`, `updated_at`, `deleted_at` (silme işareti) ve `hlc` (hibrit mantıksal saat) bulunur.
- Silme gerçek silme değildir; `deleted_at` dolar, satır 30 gün sonra temizlenir.
- Tarihler UTC milisaniye olarak saklanır; "gün" hesabı kullanıcının saat dilimiyle yapılır.

**Yerel tablolar (Dexie)**

| Tablo | Ne tutar | Önemli alanlar ve indeksler | Senkron |
| --- | --- | --- | --- |
| notes | Kullanıcının kelimesi veya kalıbı; her terim bir kez | term, term\_norm (küçük harf, sözlük biçimi), lexicon\_term\_id, term\_type (word / phrase / pattern), tags\[\]; benzersiz (user\_id, term\_norm) | Evet |
| senses | Notun bir anlamı | note\_id, sense\_no (gösterim sırası), lexicon\_sense\_id, meaning\_tr\_override (Hasan düzelttiyse), source\_sentence, span, source\_id; benzersiz (note\_id, lexicon\_sense\_id) | Evet |
| cards | Bir kart | note\_id, sense\_id (tanıma kartında boş), card\_type (recognition / production / cloze), FSRS alanları (due, stability, difficulty, reps, lapses, state, last\_review), suspended; indeks \[state+due\], note\_id, sense\_id | Evet |
| review\_logs | Her cevap | card\_id, rating, reviewed\_at, duration\_ms, device\_id, undo\_of (geri alınan kaydın kimliği), shown\_sense\_id (tanıma kartında hangi anlamın cümlesi gösterildi); değişmez | Evet (yalnızca ekleme) |
| lexicon\_cache | Ortak sözlükten inen kayıtlar | lexicon\_sense\_id, lemma, pos, gloss\_en, meaning\_tr, ipa | Sunucudan yalnızca alınır |
| chunk\_cache | İşlenmiş metin parçalarının sonucu | chunk\_hash, result, created\_at | Hayır |
| sources | İçe aktarılan metin veya PDF | kind (text / pdf), title, file\_name, page\_count | Yalnızca üst bilgi |
| import\_jobs | AI çıkarma işi | source\_id, status (queued / processing / ready / failed / done), chunk\_total, chunk\_done, cache\_hits, error | Hayır |
| import\_candidates | Önizlemedeki aday | job\_id, term, term\_type, lexicon\_sense\_id, match (known\_sense / new\_sense / new\_term), source\_sentence, span, confidence, decision, user\_status (yeni / anlam ekle / zaten var) | Hayır |
| settings | Ayarlar | daily\_new\_limit, request\_retention, timezone, theme, fsrs\_params | Evet |
| outbox | Gönderilmeyi bekleyen değişiklik | table, row\_id, op (upsert / delete), payload, attempts | Hayır |
| daily\_activity | Gün bazında özet önbelleği | date (yerel YYYY-MM-DD), reviews, new\_cards, time\_ms; review\_logs'tan türetilir | Hayır |
| error\_log | Yakalanmayan hatalar | son 200 kayıt | Hayır |
| meta | Cihaz bilgisi | device\_id, sync\_cursor, lexicon\_cursor, schema\_version | Hayır |

**Sunucu tabloları (Supabase Postgres)**

- Kullanıcıya ait tablolar: `profiles`, `notes`, `senses`, `cards`, `review_logs`, `sources`, `settings`. Alanlar yerel karşılıklarıyla aynıdır.
- Her kullanıcı tablosunda `server_seq` sütunu: her yazmada bir sayaçtan artan sayı alır. Senkronda "son gördüğüm sıra numarasından sonrasını ver" sorgusu bununla yapılır; saat farkı sorunu olmaz.
- Satır düzeyi güvenlik (RLS): kullanıcı tablolarında yalnızca `user_id = auth.uid()` olan satırlar okunur ve yazılır. `review_logs` için yalnızca INSERT izni vardır.
- **Ortak sözlük:** `lexicon_terms` (lemma, lemma\_norm, term\_type; lemma\_norm benzersiz) ve `lexicon_senses` (term\_id, pos, gloss\_en, gloss\_key, meaning\_tr, ipa, created\_by\_model, created\_at; (term\_id, pos, gloss\_key) benzersiz). Giriş yapmış herkes okuyabilir, yalnızca sunucu fonksiyonları yazabilir. Kullanıcının kaynak cümlesi veya yüklediği metin buraya hiçbir zaman yazılmaz.
- Benzersizlik kuralları sayesinde aynı kelime ve anlam iki kez kaydedilemez; aynı anda gelen iki istekten ikincisi mevcut kaydı alır.
- v0.4'teki görseller ortak sözlükteki anlam kaydına (`lexicon_senses`) bağlanacak; şema bunu şimdiden mümkün kılar.

**Şema değişiklikleri**

Dexie sürüm numarası her şema değişikliğinde artar ve bir göç (upgrade) fonksiyonu yazılır. Supabase tarafında her değişiklik `supabase/migrations/` altında ayrı bir SQL dosyasıdır.

## Tekrar döngüsü

Planlamayı ts-fsrs yapar; uygulama yalnızca kuyruğu kurar, cevabı kaydeder ve kartı günceller. Bütün planlama kodu `domain/` içinde, saf fonksiyonlar olarak durur.

**FSRS başlangıç ayarları**

| Ayar | Değer | Açıklama |
| --- | --- | --- |
| request\_retention | 0.90 | Hedef hatırlama oranı; ayarlardan 0.80–0.95 arası değiştirilebilir |
| maximum\_interval | 36500 gün | Üst sınır |
| enable\_fuzz | açık | Aynı gün eklenen kartlar aynı güne yığılmaz |
| enable\_short\_term | açık | Öğrenme adımları kullanılır |
| learning\_steps | 1 dk, 10 dk | Yeni kart adımları |
| relearning\_steps | 10 dk | Unutulan kart adımı |

Kişisel parametre optimizasyonu, yeterli tekrar verisi biriktikten sonra sonraki bir sürüme bırakılır.

**Kart tipleri**

| Tip | Kaç tane | Ön yüz | Arka yüz | Ne zaman oluşur |
| --- | --- | --- | --- | --- |
| Tanıma (EN→TR) | Kelime başına 1 | İngilizce terim + anlamlarından birine ait cümle (her tekrarda sıradaki anlamın cümlesi), ses butonu | Tüm anlamlar numaralı (1. banka, 2. kıyı), cümledeki anlam vurgulu; IPA | Her notta |
| Üretme (TR→EN) | Anlam başına 1 | Türkçe anlam + kısa İngilizce tanım ipucu + ilk harf ("kıyı — the land beside a river → b\_\_\_") | Terim, IPA, ses | Tanıma kartı "Review" durumuna geçince açılır |
| Boşluk doldurma | Anlam başına 1 | Terimi boş bırakılmış kaynak cümle + Türkçe ipucu | Tam cümle, terim vurgulu | Yalnızca kaynak cümle varsa ve terimin cümledeki yeri biliniyorsa |

**Çok anlamlı kelimeler.** Bir kelimenin tüm anlamları tanıma kartında bir arada görülür. Tanıma kartına verilen cevap kelimenin geneli içindir; hangi anlamın unutulduğunu anlam başına üretilen üretme ve boşluk doldurma kartları takip eder. Notta tek anlam varsa arka yüz numarasız, düz gösterilir. Yalnızca Hasan'ın eklediği anlamlar karta girer; sözlükteki diğer anlamlar otomatik eklenmez.

Aynı notun kartları aynı gün gösterilmez (kardeş kart erteleme).

**Oturum kuralları**

1. Kuyruk sırası: önce vadesi gelmiş öğrenme adımları, sonra vadesi geçmiş tekrarlar (en eskiden yeniye), sonra yeni kartlar.
2. Yeni kartlar tekrarların arasına serpiştirilir: her 5 tekrardan sonra 1 yeni kart.
3. Günlük yeni kart limiti varsayılan 10; ayarlardan değiştirilir. Tekrar sayısında v0.1'de üst sınır yok.
4. Gün sınırı yerel saatle 04:00'tür; gece yarısından sonra yapılan tekrar önceki güne sayılır.
5. Dört cevap butonu: Tekrar, Zor, İyi, Kolay. Her butonun altında bir sonraki aralık gösterilir (`repeat` ile önizleme).
6. Klavye: boşluk kartı çevirir, 1–4 cevap verir, Z son cevabı geri alır.
7. Cevap süresi kart açılışından cevaba kadar ölçülür, en fazla 60 saniye sayılır.

**Geri alma**

Yalnızca oturumdaki son cevap geri alınabilir. Tekrar kaydı silinmez; `undo_of` alanı dolu yeni bir kayıt eklenir ve kart, geri alınmamış kayıtlardan yeniden hesaplanır. Böylece senkronda hiçbir kayıt değiştirilmemiş olur.

**Yeniden hesaplama**

Bir kartın tüm tekrar kayıtları tarih sırasına dizilip boş karttan başlanarak tekrar uygulanır. Bu fonksiyon üç yerde kullanılır: geri alma, senkron çakışması ve yedekten geri yükleme sonrası doğrulama.

**Sesli okuma**

Tarayıcının `speechSynthesis` özelliği kullanılır; İngilizce ses (en-US veya en-GB) ayarlardan seçilir. Cihazda çevrimdışı ses yoksa buton gri görünür.

## Kart oluşturma ve AI çıkarma hattı

Metin ve PDF istemcide işlenir, yalnızca temizlenmiş metin parçaları sunucu fonksiyonu üzerinden Gemini'ye gider. AI'ın döndürdüğü hiçbir şey doğrulanmadan ve Hasan onaylamadan kart olmaz.

**Adımlar**

1. **Giriş:** Metin yapıştırma alanı veya PDF yükleme. Kaynak `sources` tablosuna yazılır.
2. **PDF'ten metin:** pdf.js bir Web Worker içinde her sayfanın metnini çıkarır. Satır sonu tirelemeleri birleştirilir, sayfaların yarısından fazlasında tekrarlanan üst/alt bilgi satırları atılır. Metin çıkmazsa (taranmış PDF) "Bu PDF'te okunabilir metin yok" mesajı gösterilir; OCR v0.5'te gelir.
3. **Parçalama:** Metin `Intl.Segmenter` ile cümlelere bölünür, cümleler yaklaşık 6.000 karakterlik parçalarda toplanır. Bir cümle iki parçaya bölünmez.
4. **Parça önbelleği:** Her parçanın özeti (hash) hesaplanır. Aynı parça daha önce işlendiyse sonuç `chunk_cache`'ten gelir; AI çağrılmaz.
5. **Kuyruk:** Bir `import_jobs` kaydı açılır. Çevrimdışıysa iş "sırada" bekler, bağlantı gelince kendiliğinden başlar.
6. **Sözlük ön eşleştirme:** Sunucu fonksiyonu parçadaki kelimeleri ve kalıpları ortak sözlükte arar. Bulunan terimlerin mevcut anlamları (kimlik + kısa İngilizce tanım) isteme eklenir.
7. **Sunucu fonksiyonu `ai-extract`:** Oturum anahtarını doğrular, kullanıcı başına günlük çağrı sınırını uygular, Gemini'yi JSON şemalı çıktı isteyerek çağırır (sıcaklık 0.2, zaman aşımı 30 saniye, kota hatasında artan beklemeyle en fazla 3 deneme). AI her aday için ya mevcut bir anlamın kimliğini döndürür (yalnızca terim, cümle, konum ve kimlik) ya da "yeni anlam" der; Türkçe anlam, IPA ve tanımı yalnızca yeni anlamlar için üretir. Giriş tokenı ucuz, çıkış pahalı olduğu için bu düzen maliyetin büyük kısmını keser.
8. **Ortak sözlüğe yazma:** Yeni anlamlar `lexicon_senses` tablosuna eklenir. Benzersizlik kuralı, aynı anda gelen iki isteğin çift kayıt açmasını engeller; ikinci istek mevcut kaydı alır.
9. **Doğrulama:** Cevap zod ile kontrol edilir. Kaynak cümlesi parçada birebir geçmeyen aday atılır (uydurma kontrolü). Terimin cümledeki konumu doğrulanır.
10. **Kullanıcı kopyası kontrolü:** Not ve anlam zaten varsa aday "zaten var" işaretlenir ve seçilmez. Not var ama anlam yeniyse "yeni anlam olarak ekle" önerilir.
11. **Önizleme:** Adaylar listelenir; Hasan seçer, anlamı yerinde düzeltir, tipe göre süzer. Güven puanı 0.7'nin altındaki adaylar renkle işaretlenir.
12. **Onay:** Not yoksa açılır, anlam satırı nota eklenir, kartlar türetilir. Hepsi tek bir Dexie işleminde yapılır ve senkron kuyruğuna eklenir.

**AI'dan istenen alanlar (aday başına)**

| Alan | Ne zaman | Açıklama |
| --- | --- | --- |
| term | Her aday | Sözlük biçimi ("gave up" → "give up") |
| surface | Her aday | Metindeki hâli |
| term\_type | Her aday | word / phrase / pattern (phrasal verb, collocation, sabit ifade) |
| source\_sentence | Her aday | Metindeki cümle, birebir |
| span | Her aday | Terimin cümledeki başlangıç ve bitiş konumu |
| confidence | Her aday | 0–1 arası güven |
| lexicon\_sense\_id | Anlam sözlükte varsa | Eşleşen ortak sözlük kaydı |
| pos | Yalnızca yeni anlam | Sözcük türü |
| gloss\_en | Yalnızca yeni anlam | Anlamı ayırt eden kısa İngilizce tanım ("the land beside a river") |
| meaning\_tr | Yalnızca yeni anlam | Kısa Türkçe karşılık |
| ipa | Yalnızca yeni terim | Telaffuz |

İstem (prompt) şunları sabitler: parça başına en fazla 30 aday, kullanıcının ayarlardaki tahmini seviyesinin (v0.1'de elle seçilir, varsayılan B1) altındaki çok temel kelimeleri atlama, özel isimleri atlama, kalıpları tek kelimelere bölmeme.

**İkinci fonksiyon `ai-enrich`**

Elle eklenen terimde önce ortak sözlüğe bakılır. Anlamlar varsa AI çağrılmadan listelenir; Hasan bir veya birkaçını seçer, her biri ayrı anlam satırı olur. "Başka anlam ara" butonu yalnızca o zaman `ai-enrich` fonksiyonunu çağırır; dönen yeni anlamlar ortak sözlüğe yazılır. Çevrimdışıyken elle eklenen anlamın sözlük bağlantısı boş kalır; bağlantı gelince eşleştirilir.

**AI'a gitmeyen istekler**

| Durum | Ne olur |
| --- | --- |
| Aynı metin parçası ikinci kez işlenir | Sonuç parça önbelleğinden gelir |
| Kelime ve anlam ortak sözlükte var | Kayıt sözlükten çağrılır; AI yalnızca kimliği eşleştirir, içerik üretmez |
| Elle eklenen kelime sözlükte var | Anlamlar AI çağrılmadan listelenir |
| Aynı kelimeyi başka bir kullanıcı ekler (v1.0) | Aynı sözlük kaydı kullanılır |
| Görsel (v0.4) | Anlama bağlı görsel bir kez üretilir, herkes kullanır |

Her içe aktarma işinde önbellek isabet sayısı (`cache_hits`) tutulur; ayarlardaki geliştirici bölümünde AI çağrısı yapılmadan karşılanan isteklerin oranı görünür.

**Model ve kota**

- Model adı kodda değil, `GEMINI_MODEL` ayarında durur; model değiştirmek kod değişikliği gerektirmez.
- Gemini 2.5 serisi Eylül 2026'dan beri yalnızca onu daha önce kullanmış projelere açık; yeni proje güncel Flash-Lite sınıfı bir modelle başlamalı ([Gemini fiyatlandırma özeti](https://geotoolbox.ai/blog/gemini-api-pricing.md)).
- Ücretsiz katman sınırları artık tablo olarak yayımlanmıyor; proje başına AI Studio'da görünüyor. Parçalar sırayla, aralarında kısa beklemeyle gönderilir.

**Gizlilik uyarısı**

Ücretsiz katmanda Google, gönderilen metinleri modellerini geliştirmek için kullanabilir ve insan inceleyiciler okuyabilir (AB, İsviçre ve Birleşik Krallık hariç). Bu yüzden içe aktarma ekranında kalıcı bir not durur: "Gizli iş belgelerini yükleme." Gerekirse ücretli katmana geçiş, kod değişikliği olmadan yalnızca anahtar değişikliğiyle yapılır.

## Hesap ve senkron

Yerel veritabanı her zaman asıl kaynaktır; sunucu yedek ve cihazlar arası köprüdür. Uygulama hiçbir ekranda sunucu cevabını beklemez.

**Hesap**

- Giriş yöntemleri: e-posta + şifre ve Google ile giriş (Supabase Auth).
- Misafir mod: hesap olmadan tam kullanım; satırların `user_id` alanı boştur.
- Misafirden hesaba geçiş: tüm yerel satırlara `user_id` yazılır, hepsi gönderim kuyruğuna (outbox) eklenir, ilk gönderim yapılır.
- Hesapta zaten veri varsa (ikinci cihaz) üç seçenek sorulur: birleştir (varsayılan), yerel veriyi at, hesaptakini at. Birleştirmede aynı terime sahip notlar "olası kopya" olarak işaretlenir, silinmez.

**Gönderme (push)**

1. Her yerel değişiklik, aynı Dexie işlemi içinde outbox'a bir kayıt olarak eklenir.
2. Outbox 100'lük gruplar hâlinde `sync_push` sunucu fonksiyonuna gönderilir.
3. Sunucu notes, cards ve settings için `hlc` değeri büyük olanı kabul eder (son yazan kazanır). review\_logs aynı kimlikle ikinci kez gelirse sessizce yok sayılır.
4. Outbox kaydı yalnızca sunucu onayından sonra silinir. Hata olursa deneme sayısı artar ve bekleme süresi katlanır; 10 başarısız denemeden sonra arayüzde uyarı çıkar.

**Alma (pull)**

1. `sync_pull(since_seq)` çağrısı, son görülen sıra numarasından sonraki satırları 500'lük sayfalar hâlinde döndürür.
2. Gelen satırın `hlc` değeri yerel bekleyen değişiklikten küçükse yerel sürüm korunur, değilse üzerine yazılır.
3. Bir kart için yeni tekrar kayıtları geldiyse, kartın FSRS durumu tüm kayıtlardan yeniden hesaplanır. Böylece iki cihazda yapılan tekrarlar birleşir, hiçbiri kaybolmaz.
4. Sıra numarası (cursor), satırlarla aynı işlemde güncellenir; yarıda kesilen alma işlemi tekrarlandığında aynı sonucu verir.

**Ortak sözlük senkronu**

Ortak sözlük kullanıcı verisi gibi gönderilmez, yalnızca alınır. Cihaz, notlarında kullanılan sözlük kayıtlarını `lexicon_cursor` ile çeker ve `lexicon_cache` tablosunda saklar; böylece anlamlar çevrimdışı da görünür. Sözlükte bir kayıt düzeltilirse, o kaydı kullanan cihazlar bir sonraki senkronda güncel hâlini alır. Hasan'ın kendi düzeltmesi (`meaning_tr_override`) her zaman sözlük kaydının önüne geçer.

**Senkron ne zaman çalışır**

Uygulama açılışında, internet geri geldiğinde, oturum bitince, sayfa açıkken her 60 saniyede bir ve "Şimdi senkronla" butonuyla.

**Uç durumlar**

| Durum | Çözüm |
| --- | --- |
| Silinen kayıt (tombstone) | `deleted_at` dolu satır diğer cihazlara iletilir; sunucu 30 günden eski silme işaretlerini temizler |
| 30 günden uzun çevrimdışı kalan cihaz | Sunucu "tam yeniden senkron" işareti döner; cihaz önce kendi bekleyenlerini gönderir, sonra her şeyi baştan çeker |
| Aynı tarayıcıda birden çok sekme | Senkronu yalnızca bir sekme çalıştırır (Web Locks API); diğer sekmeler Dexie'nin canlı sorgularıyla güncellenir |
| İki sekmede aynı kart cevaplanırsa | İki kayıt da tutulur, kart yeniden hesaplanır |
| Kısmi senkron hatası | Gönderim ve alma tekrarlanabilir (aynı istek iki kez gelse de sonuç değişmez); onaylanmayan kayıt outbox'ta kalır |
| Cihaz saati yanlış | Sıralama sunucu sayacıyla yapılır; `hlc` cihaz saatini mantıksal sayaçla düzeltir |

**Senkron güvencesi**

Üst çubukta küçük bir durum göstergesi: "Senkronlandı", "12 değişiklik bekliyor" veya "Çevrimdışı — verilerin bu cihazda güvende". Son başarılı senkron zamanı ayarlarda görünür.

**Güvenlik**

Sunucu fonksiyonları `user_id` alanını istemciden almaz, oturumdan (`auth.uid()`) yazar. RLS kapalı tablo bırakılmaz; CI'da bunu kontrol eden bir SQL testi çalışır.

## Süreklilik paneli

Hasan her gün "kaç gündür devam ediyorum?" sorusunun cevabını ana ekranda görür. Ayrıntılar İstatistik sayfasındadır.

**Tanımlar**

| Ölçüt | Tanım |
| --- | --- |
| Aktif gün | Yerel saatle 04:00'ten ertesi 04:00'e kadar en az 1 tekrar yapılan gün |
| Tamamlanmış gün | O günün vadesi gelen tüm kartları bitirilmiş aktif gün |
| Toplam aktif gün | Hesap açıldığından beri aktif gün sayısı |
| Güncel seri | Bugünden geriye kesintisiz aktif gün sayısı. Bugün henüz tekrar yapılmadıysa sayım dünden başlar; seri ancak gün bitince kırılır |
| En uzun seri | Tüm zamanların en uzun kesintisiz aktif gün dizisi |
| Son 30 gün oranı | Son 30 gündeki aktif gün ÷ 30 (hesap 30 günden yeniyse hesap yaşına bölünür) |
| Günlük ortalama süre | Son 30 günde aktif günlerdeki toplam süre ÷ aktif gün sayısı |
| Tutma oranı | Son 30 günde "Review" durumundaki kartlara verilen cevaplardan "Tekrar" olmayanların oranı |
| Öğrenilen kart | Durumu "Review" olan kart sayısı |

Geri alınmış tekrar kayıtları hiçbir ölçüte girmez.

**Görünüm**

- Ana ekranın üstünde tek satır: "Seri: 12 gün · Bugün: 34 / 60 kart · En uzun: 21".
- İstatistik sayfasında son 26 haftanın takvim ısı haritası, üç kademe: boş, aktif, tamamlanmış. Renkler Okabe-Ito'dan tek tonun açık ve koyu hâli; her hücrenin ekran okuyucu etiketi vardır ("12 Ekim: 45 tekrar, tamamlandı").
- Altında ölçüt kartları: toplam aktif gün, güncel ve en uzun seri, son 30 gün oranı, ortalama süre, tutma oranı, öğrenilen kart.

**Hesaplama**

- Her cevapla birlikte, aynı Dexie işleminde `daily_activity` satırı güncellenir; panel bu önbellekten okur ve anında açılır.
- Senkrondan ve yedekten geri yüklemeden sonra önbellek `review_logs`'tan baştan hesaplanır.
- Bütün hesap fonksiyonları `domain/streak.ts` içinde saf fonksiyonlardır ve sabit tarih listeleriyle test edilir (yaz saati, yıl dönümü, gece 03:59 tekrarı gibi).

## Ekranlar ve tasarım sistemi

Sekiz ekran var; ana ekranda yalnızca seri bilgisi ve "Tekrara başla" butonu öne çıkar. Tasarım önce 360 px telefon genişliği için yapılır, sonra genişletilir.

**Ekranlar**

| Ekran | Adres | İçerik |
| --- | --- | --- |
| Ana ekran | `/` | Seri satırı, bugün vadesi gelen ve yeni kart sayısı, büyük "Tekrara başla" butonu, ikincil "Kart ekle" |
| Tekrar | `/review` | Tam ekran kart, ilerleme çubuğu, çevirme, 4 cevap butonu, ses butonu; menüde düzenle, askıya al, geri al. Sonunda oturum özeti |
| Kart ekle | `/add` | Üç sekme: Elle, Metin yapıştır, PDF yükle |
| Önizleme | `/import/:jobId` | AI adayları, seçim, yerinde düzeltme, süzme, onay |
| Kartlar | `/library` | Arama, tip/durum/etiket filtresi, not düzenleme, toplu askıya alma ve silme |
| İstatistik | `/stats` | Isı haritası ve süreklilik ölçütleri |
| Ayarlar | `/settings` | Hesap, senkron durumu, günlük yeni kart limiti, hedef hatırlama oranı, gün başlangıç saati, ses, tema, tahmini seviye, yedek al/geri yükle, CSV dışa aktar |
| Giriş | `/auth` | E-posta + şifre, Google ile giriş, "Misafir olarak devam et" |

Gezinme: dar ekranda alt çubukta dört öğe (Ana, Ekle, Kartlar, İstatistik), ayarlar sağ üstte. Geniş ekranda aynı öğeler sol kenarda.

**Renk**

- Vurgu renkleri Okabe-Ito paletinden: turuncu `#E69F00`, gök mavisi `#56B4E9`, mavimsi yeşil `#009E73`, mavi `#0072B2`, kırmızımsı turuncu `#D55E00`, mor `#CC79A7`.
- Cevap butonları: Tekrar kırmızımsı turuncu, Zor turuncu, İyi mavimsi yeşil, Kolay mavi. Anlam hiçbir zaman yalnızca renkle verilmez; her butonda yazı ve aralık bulunur.
- Renkli zemin üzerindeki her yazı WCAG AA kontrastını (normal metinde 4.5:1) geçmelidir; geçmeyen yerde renk kenarlık ve simgede kullanılır, yazı nötr kalır.
- Tema: Sistem / Açık / Koyu. Bütün renkler CSS değişkenleri olarak iki tema için tanımlanır.

**Yazı ve boşluk**

- Sistem yazı tipi ailesi; gövde 16 px, kart terimi 32–40 px, ikincil metin 14 px.
- Boşluk 4 px katları; köşe yarıçapı 12 px.

**Hareket**

- Mikro (buton basma, seçim): 100–150 ms
- Orta (kart çevirme, sayfa geçişi): 250–300 ms
- Büyük (oturum sonu özeti): 450–600 ms
- İşletim sisteminde "hareketi azalt" açıksa yalnızca kısa opaklık geçişleri kalır.

**Erişilebilirlik**

- Tüm uygulama yalnızca klavyeyle kullanılabilir, odak halkası her zaman görünür.
- Dokunma hedefleri en az 44 × 44 px.
- Kart çevrildiğinde arka yüz ekran okuyucuya otomatik okunur (`aria-live`).
- Isı haritası ve grafiklerin metin karşılığı vardır.

## Offline, PWA ve veri güvenliği

Uygulama bir kez açıldıktan sonra internetsiz tam çalışır; veriyi korumak için üç katman vardır: kalıcı depolama izni, sunucu senkronu ve elle alınan yedek.

**PWA**

- vite-plugin-pwa ile service worker: derlenen tüm uygulama dosyaları önceden önbelleğe alınır. Supabase ve AI çağrıları hiçbir zaman önbellekten cevaplanmaz.
- Güncelleme: yeni sürüm indiğinde "Yeni sürüm hazır — yenile" bildirimi çıkar. Tekrar oturumu ortasında sayfa kendiliğinden yenilenmez.
- Manifest: ad "ENG App", kısa ad "ENG", 192 ve 512 px simgeler (maskable dahil), `display: standalone`, dil `tr`.
- Kurulum: Android ve masaüstü Chrome'da ayarlarda "Uygulamayı yükle" butonu; iPhone'da Safari'nin "Ana Ekrana Ekle" adımını anlatan kısa yönerge.

**Kalıcı depolama**

- İlk kart eklendiğinde `navigator.storage.persist()` istenir; sonuç ayarlarda görünür.
- İzin verilmezse ve kullanıcı misafirse uyarı: "Hesap aç ya da yedek al; tarayıcı yer açmak için verileri silebilir."
- iPhone'da ana ekrana eklenmemiş sitelerin verileri bir süre kullanılmayınca silinebilir; bu yüzden iPhone kurulum yönergesi ilk açılışta gösterilir.
- Ayarlarda kullanılan alan (`navigator.storage.estimate()`) gösterilir.

**Yedek**

- JSON yedek: tüm senkronlanan tablolar + ayarlar, `schema_version` ve sağlama toplamıyla tek dosya.
- Geri yükleme: dosya zod ile doğrulanır, önce "x not, y kart, z tekrar" özeti gösterilir, sonra "üzerine yaz" veya "birleştir" seçilir. Bittiğinde kart durumları ve süreklilik önbelleği yeniden hesaplanır.
- CSV dışa aktarma: notlar (terim, anlam, IPA, cümle, etiketler, eklenme tarihi), Excel'de açılabilir biçimde (UTF-8 BOM, noktalı virgül ayraç).
- Ayarlarda "Son yedek: 9 gün önce" bilgisi; misafir kullanıcıda 7 günü geçince ana ekranda hatırlatma.

**Bütünlük kontrolü**

Açılışta hızlı bir kontrol çalışır: notu olmayan kart, kartı olmayan tekrar kaydı, outbox'ta takılı kalmış kayıt. Sorun bulunursa ayarlarda "Veri onarımı" butonu çıkar; onarım yeniden hesaplama fonksiyonlarını kullanır.

**Hata kaydı**

Yakalanmayan hatalar yerel bir hata tablosuna yazılır (en fazla son 200 kayıt), ayarlardan dosya olarak indirilebilir. Dış hata izleme servisi v0.1'de yok.

## Test planı

En çok test, veri kaybettirebilecek yerlere yazılır: yeniden hesaplama, senkron ve seri hesabı. Her kabul ölçütünün en az bir otomatik testi vardır.

| Katman | Araç | Neyi test eder |
| --- | --- | --- |
| Birim | vitest | Kuyruk sırası, yeni kart serpiştirme, kardeş erteleme, günlük limit; tanıma kartında anlam cümlelerinin sırayla dönmesi; seri ve oran hesapları (yaz saati geçişi, 03:59 tekrarı, yıl geçişi); HLC karşılaştırma; AI cevap doğrulama (uydurma cümlenin reddi) |
| Özellik tabanlı | vitest + fast-check | Aynı tekrar kayıtları hangi sırayla gelirse gelsin yeniden hesaplanan kart aynıdır; yedek → geri yükleme → yedek sonucu birebir aynıdır |
| Yerel veri | vitest + fake-indexeddb | Depolar, değişiklik ile outbox kaydının aynı işlemde yazılması, not–anlam–kart ilişkisi, şema göçleri |
| Senkron | vitest + yerel Supabase (Docker) | İki sanal cihaz senaryoları: ikisi de çevrimdışı düzenler; biri siler diğeri düzenler; 31 gün çevrimdışı kalan cihaz; aynı grup iki kez gönderilir; gönderim ortasında bağlantı kesilir |
| Ortak sözlük | vitest + yerel Supabase | Aynı parça ikinci kez işlenince AI çağrılmaz; sözlükte olan anlam için içerik üretilmez; aynı anda gelen iki istek tek kayıt açar; mevcut kelimeye yeni anlam aynı nota eklenir; sözlüğe kullanıcı cümlesi yazılmaz |
| Güvenlik | SQL testleri | Bir kullanıcı başkasının satırını okuyamaz ve yazamaz; review\_logs güncellenemez; ortak sözlüğe istemciden yazılamaz; RLS'siz tablo yoktur |
| AI fonksiyonları | vitest + kayıtlı örnek cevaplar | Şema hatası, eksik alan, kota hatası, zaman aşımı; gerçek API çağrılmaz |
| AI kalitesi | Elle, haftalık | 5 metinlik "altın set": beklenen terimlerin kaçı bulundu, kaç uydurma aday çıktı, mevcut anlamlar doğru eşleşti mi |
| Uçtan uca | Playwright | Misafir açılış → metin yapıştır → önizleme → onay → tekrar → seri 1; uçak modunda tekrar ve sonra senkron; yedek al ve boş tarayıcıya yükle |
| Performans | Playwright + sahte veri | 1.000 ve 10.000 kartta oturum açılış süresi ve kart geçişi |
| Erişilebilirlik | axe-core + Lighthouse CI | Kontrast, etiketler, klavye ile kullanım |

**Elle kabul testi**

Hasan 14 günlük kullanım boyunca her gün tek satır not tutar: ne takıldı, ne eksikti. Bu notlar v0.2 öncesi düzeltme listesine dönüşür.

## İş paketleri

Sekiz iş paketi (İP) sırayla yapılır. İP2 bittiğinde Hasan uygulamayı günlük kullanmaya başlar; sonraki paketler bu kullanımın üzerine eklenir. Her paketten önce ajan kabul kriterlerini önerir, Hasan onaylar.

&#91;embedded content: iş paketleri · sıra ve bağımlılık\]

İP3 ile İP4 birbirinden bağımsızdır ve aynı anda yürüyebilir; diğer paketler bir öncekinin üzerine kurulur.

### İP0 — Hazırlık

Bitti ölçütü: CI yeşil; boş uygulama açık ve koyu temada açılır.

- [ ] Spec'i ve bu planı repoya böl: AGENTS.md, docs/architecture.md, data-model.md, sync-strategy.md, ai-pipeline.md, phases.md
- [ ] Vite + React + TypeScript strict iskeleti, ESLint, Prettier, pnpm
- [ ] Klasör yapısı; `domain/` klasörünün React, Dexie ve ağ koduna bağlanmasını engelleyen lint kuralı
- [ ] GitHub Actions: tip kontrolü, lint, test, derleme
- [ ] Supabase bulut projesi ve yerel geliştirme ortamı
- [ ] Gemini API anahtarı ve model adı Supabase gizli ayarlarına
- [ ] Dil sözlüğü (tr.json) ve tema değişkenleri

### İP1 — Yerel veri ve temel yardımcılar

Bitti ölçütü: depo testleri geçer; her değişiklik outbox'a aynı işlemde yazılır.

- [ ] Dexie şeması sürüm 1 (bütün tablolar; not–anlam–kart ilişkisi dahil)
- [ ] UUID v7 ve HLC yardımcıları ve testleri
- [ ] notes, senses, cards, review\_logs, settings depoları
- [ ] Ayar varsayılanları
- [ ] Bütünlük kontrolü fonksiyonları

### İP2 — Tekrar döngüsü (ilk kullanılabilir sürüm)

Bitti ölçütü: Hasan 20 kartı elle ekleyip bir oturumu baştan sona tamamlar. Bu noktadan sonra günlük kullanım başlar.

- [ ] FSRS sarmalayıcı ve parametre doğrulama
- [ ] Kuyruk kurucu: sıra, serpiştirme, günlük limit, kardeş erteleme, 04:00 gün sınırı
- [ ] Yeniden hesaplama fonksiyonu ve özellik tabanlı testi
- [ ] Tekrar ekranı: çevirme, 4 buton ve aralık önizlemesi, klavye, ilerleme, oturum özeti
- [ ] Geri alma
- [ ] Üç kart tipinin görünümü; tanıma kartında numaralı anlam listesi ve dönen cümle
- [ ] Sesli okuma
- [ ] Elle kart ekleme (AI'sız): yeni kelime veya mevcut kelimeye yeni anlam; Kartlar ekranının ilk hâli: liste, arama, düzenleme
- [ ] Ana ekran

### İP3 — Süreklilik ve istatistik

Bitti ölçütü: tüm ölçüt tanımları sabit tarih testleriyle doğrulanır; panel 100 ms'den kısa sürede açılır.

- [ ] `domain/streak.ts` fonksiyonları ve testleri
- [ ] `daily_activity` önbelleği ve baştan hesaplama
- [ ] Ana ekran seri satırı
- [ ] İstatistik sayfası: ısı haritası ve ölçüt kartları

### İP4 — PWA, offline ve yedek

Bitti ölçütü: uçak modu uçtan uca testi ve yedek gidiş-dönüş testi geçer. İP3 ile aynı anda yürüyebilir.

- [ ] Service worker, manifest, simgeler, güncelleme bildirimi
- [ ] Kalıcı depolama isteği ve ayarlarda durumu
- [ ] iPhone kurulum yönergesi
- [ ] JSON yedek alma ve geri yükleme
- [ ] CSV dışa aktarma
- [ ] Yedek hatırlatması

### İP5 — Hesap ve senkron

Bitti ölçütü: senkron senaryo testlerinin hepsi geçer; kabul ölçütleri 2 ve 3 sağlanır.

- [ ] Supabase şeması, `server_seq`, RLS ve SQL güvenlik testleri
- [ ] Giriş ekranı: e-posta + şifre, Google, misafir
- [ ] Misafirden hesaba geçiş ve ikinci cihazda birleştirme
- [ ] `sync_push` ve `sync_pull` fonksiyonları
- [ ] Senkron motoru: tetikleyiciler, Web Locks, tekrar deneme
- [ ] Tekrar kayıtlarının birleşmesi ve kartın yeniden hesaplanması
- [ ] 30 günden uzun çevrimdışı cihaz için tam yeniden senkron
- [ ] Senkron durum göstergesi

### İP6 — AI ile kart çıkarma

Bitti ölçütü: kabul ölçütü 5 sağlanır; altın setteki uydurma aday oranı ölçülüp kaydedilir. AI özellikleri giriş yapmış kullanıcıya açıktır (sunucu fonksiyonu oturum ister).

- [ ] Ortak sözlük tabloları (`lexicon_terms`, `lexicon_senses`), benzersizlik kuralları ve yazma yetkisi
- [ ] `ai-extract` ve `ai-enrich`: oturum kontrolü, günlük sınır, yapılandırılmış çıktı, tekrar deneme
- [ ] Sözlük ön eşleştirme ve "mevcut anlam / yeni anlam" çıktı düzeni
- [ ] Parça önbelleği ve önbellek isabet sayacı
- [ ] İstem ve JSON şeması, docs/ai-pipeline.md içinde sürümlü
- [ ] pdf.js Worker, temizleme, parçalama
- [ ] İş kuyruğu: çevrimdışı bekleme ve ilerleme göstergesi
- [ ] Doğrulama ve kullanıcı kopyası kontrolü
- [ ] Önizleme ekranı
- [ ] Elle eklemede önce sözlük, gerekirse "Başka anlam ara"
- [ ] Ortak sözlük senkronu (`lexicon_cache`)
- [ ] İçe aktarma ekranında gizlilik notu
- [ ] Altın set ilk ölçümü

### İP7 — Cila ve kabul

Bitti ölçütü: kapsam bölümündeki 7 kabul ölçütünün hepsi sağlanır.

- [ ] Performans testi (1.000 ve 10.000 kart)
- [ ] axe ve Lighthouse denetimi, eksiklerin giderilmesi
- [ ] Hata kaydı ve veri onarımı ekranı
- [ ] Hareket ve karanlık mod son kontrolü
- [ ] 14 günlük kullanım ve günlük notlar

## Kodlama ajanı için talimatlar ve açık sorular

Aşağıdaki kurallar AGENTS.md dosyasına aynen taşınır. Açık sorular İP0 başlamadan önce cevaplanmalıdır.

**AGENTS.md kuralları**

1. Bu plan tek doğru kaynaktır. Plandan sapmak gerekiyorsa önce `docs/decisions/` altına kısa bir karar kaydı yaz ve onay iste.
2. Her iş paketinin başında kabul kriterlerini ve test listesini öner, açık onay gelmeden kod yazma.
3. Küçük commit'ler at; her commit testlerden geçsin. Paket sonunda özet yaz: ne yapıldı, ne ertelendi, bilinen sorunlar.
4. İş mantığı `domain/` içinde saf fonksiyon olarak durur; arayüz bileşenlerinde iş mantığı olmaz.
5. Asla yapma: review\_logs satırını güncellemek veya silmek; `user_id` alanını istemciden almak; API anahtarını istemciye koymak; model adını koda yazmak; kullanıcının cümlesini veya metnini ortak sözlüğe yazmak.
6. AI çağırmadan önce her zaman parça önbelleğine ve ortak sözlüğe bak; sözlükte olan içerik için AI'dan yeniden üretim isteme.
7. Yeni bir bağımlılık eklemeden önce gerekçesini yaz.
8. Arayüz metinleri yalnızca `tr.json` içinde durur.
9. Her şema değişikliği: Dexie sürüm artışı + göç fonksiyonu + testi; Supabase tarafında ayrı göç dosyası.
10. Emin olmadığın yerde tahmin etme, sor.

**Açık sorular**

- [ ] Barındırma: Vercel mi, Cloudflare Pages mi? İkisi de statik bir PWA için yeterli.
- [ ] Misafir kullanıcı AI kullanabilsin mi? Supabase'in anonim oturum özelliğiyle mümkün, ama misafirden hesaba geçiş akışını değiştirir.
- [ ] Google ile giriş v0.1'de gerekli mi, yoksa e-posta yeterli mi?
- [ ] Günlük yeni kart limiti 10 ve gün başlangıcı 04:00 uygun mu?
- [ ] Üretme kartının, tanıma kartı "Review" durumuna geçince açılması uygun mu?
- [ ] Hangi Gemini modeli? AI Studio'da projenin ücretsiz kotasına bakılarak seçilmeli.

## Kaynaklar

- [ts-fsrs belgeleri](https://open-spaced-repetition.github.io/ts-fsrs): Node.js sürüm şartı, ayarlar, geçmişten yeniden hesaplama fonksiyonları
- [Gemini API fiyatlandırma özeti, Ekim 2026](https://geotoolbox.ai/blog/gemini-api-pricing.md): ücretsiz katman kapsamı, veri kullanımı, model geçişleri
