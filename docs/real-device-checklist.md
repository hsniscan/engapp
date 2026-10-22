# Gerçek telefon kontrol listesi (Android)

v0.4 İP10. Testlerin telefonda yapamadığı şeyler için kısa bir el kontrolü. Her yeni APK'da
(ya da Play'den gelen her yeni sürümde) bir kez, 20–30 dakika.

**Nasıl doldurulur:** her satırda kutuyu işaretle (`[x]`), sorun varsa "Not" sütununa kısaca
yaz (ne yaptın, ne oldu). Ekran görüntüsü varsa adını yaz. Doldurduğun dosyayı ya da notları
bana gönder.

| | |
|---|---|
| Tarih | |
| Telefon (marka, model) | |
| Android sürümü | |
| Engapp sürümü (Ayarlar → Hakkında) | |
| APK nereden geldi (GitHub `engapp-apk` / Play kapalı test) | |

Hazırlık: telefonda Wi-Fi ve mobil veri açık, pil tasarrufu kapalı. Test için bir **deneme
Google hesabı** hazır olsun (son bölümde silinecek; kendi hesabını kullanma).

## 1. Kurulum

| ✓ | Ne yap | Ne olmalı | Not |
|---|---|---|---|
| [ ] | APK'yı kur (yol: [setup-android.md](setup-android.md), bölüm 6) ya da Play'den yükle | Kurulur; Play Protect uyarısında "Yine de yükle" yeterli | |
| [ ] | Engapp'i aç | Açılış ekranı kısa sürer, ana sayfa gelir; beyaz ekranda takılmaz | |
| [ ] | Eski bir sürüm kuruluysa üstüne yeni APK'yı kur | Güncellenir, kartların kaybolmaz | |

## 2. Google ile giriş

| ✓ | Ne yap | Ne olmalı | Not |
|---|---|---|---|
| [ ] | Ayarlar → Hesap → Google ile giriş | Telefonun kendi hesap seçicisi açılır (tarayıcı değil) | |
| [ ] | Kendi hesabını seç | Giriş olur; adın ve fotoğrafın görünür | |
| [ ] | Web'de eklediğin bir kelimeyi telefonda ara | Senkrondan sonra telefonda da var | |
| [ ] | Telefonda bir kelime ekle, web'de bak | Bir dakika içinde web'de görünür | |

## 3. İnternetsiz tekrar

| ✓ | Ne yap | Ne olmalı | Not |
|---|---|---|---|
| [ ] | Uçak modunu aç | Uygulama çalışmaya devam eder | |
| [ ] | Tekrara başla, 10 kart cevapla | Kartlar hızlı geçer (takılma yok) | |
| [ ] | Uçak modunda bir kelime ekle | Kart eklenir | |
| [ ] | Uçak modunu kapat, biraz bekle | Senkron simgesi döner ve "senkron tamam" olur; web'de aynı cevaplar görünür | |

## 4. Sesli okuma

| ✓ | Ne yap | Ne olmalı | Not |
|---|---|---|---|
| [ ] | İnternet açıkken bir kartta hoparlöre dokun | İngilizce okunur | |
| [ ] | Uçak modunda hoparlöre dokun | Telefonun kendi sesiyle yine okunur | |
| [ ] | Telefonun sesi kısıkken / sessizde dene | Uygulama çökmez | |

## 5. Bildirim

| ✓ | Ne yap | Ne olmalı | Not |
|---|---|---|---|
| [ ] | Ayarlar → Bildirim → aç | Android bildirim izni sorar; "İzin ver" | |
| [ ] | Bekleyen kartın varken, o gün tekrar yapmadan: Ne zaman gelsin? → Sabit saat → bir sonraki saat (09.00–22.00 arası), uygulamayı kapat | O saatte tek bir hatırlatma gelir | |
| [ ] | Bildirime dokun | Engapp açılır | |
| [ ] | O gün tekrarlarını bitir | O gün ikinci bir bildirim gelmez | |
| [ ] | Web'de de bildirim açıksa | Aynı gün iki bildirim (telefon + web) gelmez | |

## 6. Paylaş → Engapp

| ✓ | Ne yap | Ne olmalı | Not |
|---|---|---|---|
| [ ] | Chrome'da bir İngilizce kelime seç → Paylaş → Engapp | 10 saniyeden kısa sürede kart önizlemesi açılır | |
| [ ] | Bir paragraf seç → Paylaş → Engapp | "Metinden kelime çıkar" ekranı açılır | |
| [ ] | Bir bağlantıyı paylaş | Yalnızca sayfanın başlığı görünür | |
| [ ] | Uygulama kapalıyken paylaş | Yine doğru ekran açılır | |

## 7. Görseller internetsiz

| ✓ | Ne yap | Ne olmalı | Not |
|---|---|---|---|
| [ ] | İnternet açıkken görselli bir kartın arka yüzünü aç | Görsel anlamın yanında görünür | |
| [ ] | Uçak modunda aynı kartı aç | Görsel yine görünür | |
| [ ] | Kelimenin ayrıntısında Görsel → "Görseli gizle" | Görsel kartlarında görünmez; "Görseli göster" geri getirir | |

## 8. Koyu tema

| ✓ | Ne yap | Ne olmalı | Not |
|---|---|---|---|
| [ ] | Ayarlar → Görünüm → Tema → Koyu | Bütün ekranlar koyu; okunmayan yazı yok | |
| [ ] | Görselli bir karta bak | Görsel koyu zeminde de net | |
| [ ] | Telefonun üst çubuğu (saat, pil) | Tema rengine uyar, yazılar okunur | |
| [ ] | Tema → Sistem, telefonu koyu moda al | Uygulama da koyu olur | |
| [ ] | Telefonun geri tuşu her ekranda | Bir önceki ekrana döner; ana sayfada uygulamadan çıkar | |

## 9. Hesap silme (yalnızca deneme hesabıyla)

| ✓ | Ne yap | Ne olmalı | Not |
|---|---|---|---|
| [ ] | Çıkış yap, **deneme hesabıyla** gir, 2–3 kelime ekle | Kelimeler eklenir | |
| [ ] | Ayarlar → Hesap → Hesabımı ve verilerimi sil → SİL yaz → onayla | Silinir; oturum kapanır; telefondaki kopya da gider | |
| [ ] | Deneme hesabıyla tekrar gir | Boş başlar: eski kelimeler yok | |
| [ ] | Kendi hesabınla tekrar gir | Kendi kartların yerinde | |

## Genel not

Takıldığın, yavaş gelen ya da garip görünen her şeyi buraya yaz:

-
