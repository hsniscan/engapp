// Gizlilik politikası (Türkçe, KVKK). Each statement here is checked against the code and
// the database (docs/decisions/0035-account-deletion.md, "Privacy policy sources"); change the
// text together with the data flow it describes, and bump PRIVACY_UPDATED.
import { CONTROLLER_NAME, PRIVACY_UPDATED, type LegalDocument } from './types';

export const privacyTr: LegalDocument = {
  lang: 'tr',
  title: 'Gizlilik politikası',
  updated: PRIVACY_UPDATED,
  intro: [
    'Engapp, İngilizce kelimeleri aralıklı tekrarla öğrenmen için yapılmış bir uygulamadır. Bu metin, 6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) kapsamında hangi verilerini neden işlediğimizi, nerede tuttuğumuzu ve nasıl sileceğini anlatır.',
  ],
  sections: [
    {
      id: 'kisaca',
      heading: 'Kısaca',
      blocks: [
        {
          ul: [
            'Misafir modunda bütün verilerin yalnızca kendi cihazında durur; bize hiçbir şey gelmez.',
            'Google ile giriş yaparsan kartların, çalışma geçmişin, kaydettiğin okuma metinleri (yapıştırdığın metinler, makaleler, PDF, altyazı ve fotoğraftan okunan metinler, hikâyeler) ve ayarların, cihazların arasında eşitlenmek için sunucumuzda saklanır.',
            "AI özelliklerini kullandığında gönderdiğin metin Google Gemini ile, Gemini'nin kotası dolduğunda Anthropic Claude ile işlenir. Gemini'yi ücretsiz katmanda kullandığımız için gönderilen metinler Google'ın ürünlerini geliştirmek için kullanılabilir. Gizli ya da kişisel bilgi içeren metin gönderme.",
            'Reklam yok, verilerini satmıyoruz, seni izleyen bir analiz aracı kullanmıyoruz.',
            'Hesabını ve bütün verilerini istediğin an uygulamadan ya da [hesap silme sayfasından](/hesap-sil) silebilirsin.',
          ],
        },
      ],
    },
    {
      id: 'veri-sorumlusu',
      heading: 'Veri sorumlusu ve iletişim',
      blocks: [
        {
          p: `[[email]] Veri sorumlusu, Engapp'i bireysel geliştirici olarak yayımlayan ${CONTROLLER_NAME}'dır. Bu metinle ya da verilerinle ilgili her soru ve başvuru için: {{email}}.`,
        },
        {
          p: `[[noemail]] Veri sorumlusu, Engapp'i bireysel geliştirici olarak yayımlayan ${CONTROLLER_NAME}'dır. Henüz ayrı bir iletişim adresi yayımlanmadı; o zamana kadar verilerinle ilgili her şeyi uygulamanın içinden yapabilirsin: kopyasını **Profil → ⚙ Ayarlar → Yedek ve veri → Yedek al** ile alırsın, yanlış bir kaydı düzeltirsin, hesabını ve bütün verilerini **Profil → ⚙ Ayarlar → Hesap ve eşitleme → Hesabımı ve verilerimi sil** ile ya da [hesap silme sayfasından](/hesap-sil) silersin.`,
        },
      ],
    },
    {
      id: 'veriler',
      heading: 'Hangi verileri işliyoruz',
      blocks: [
        {
          p: '**Misafir modu.** Hesap açmadan kullandığında kartların, geçmişin ve ayarların yalnızca bu cihazın tarayıcı veritabanında (ya da uygulamanın kendi deposunda) tutulur. Misafir modunda AI ve senkron kullanılamaz; sunucuya veri gönderilmez.',
        },
        {
          p: '**Google ile giriş.** Giriş, Supabase Auth üzerinden Google hesabınla yapılır. Google hesabından yalnızca adın, e-posta adresin, profil fotoğrafının bağlantısı ve Google hesap kimliğin alınır. Şifren bize hiç gelmez.',
        },
        { p: '**Öğrenme verilerin** (giriş yaptıysan, senkron için sunucuda):' },
        {
          ul: [
            'eklediğin kelimeler ve kalıplar, anlamları, etiketlerin, destelerin;',
            'kendi örnek cümlelerin ve çevirileri, kendi hatırlatıcı notların, düzenlediğin örnek cümleler, beğendiğin ya da gizlediğin içerik işaretleri;',
            'kartların tekrar planı ve cevap geçmişin: hangi karta ne zaman hangi cevabı verdiğin, cevap süresi, alıştırma cevapların;',
            'seviye testi sonuçların, bildiğin kelimeler, haftalık rapor özetlerin (sayılar ve varsa AI yorumu);',
            'ayarların: saat dilimi, günün başlangıç saati, seviye, ilgi alanların, hedeflerin, bildirim tercihin;',
            'içe aktardığın kaynakların adı, dosya adı ve sayfa sayısı (bu kaynak listesinde metnin kendisi tutulmaz);',
            'kaydettiğin okuma metinleri: yapıştırdığın, PDF\'den, bağlantıdan (makale), altyazı dosyasından ya da fotoğraftan aldığın metinlerin tamamı, başlıkları ve varsa kaynak adresleri, okuma ilerlemen, okuma süren ve metne verdiğin geri bildirim; Bugünün hikâyeleri ve kütüphane metinlerindeki okuma durumun da bunlara dahildir;',
            'okurken ve çalışırken kelimelerinle günde kaç kez karşılaştığının sayıları.',
          ],
        },
        {
          p: '**Cihaz kimliği.** Uygulama, senkron için her kuruluma rastgele bir cihaz kimliği verir ve bunu cevap kayıtlarına yazar. Bu bir reklam kimliği değildir; telefonun donanım kimliklerine erişilmez.',
        },
        {
          p: '**AI ile işlenen metinler.** "Metinden kart çıkar" ile yapıştırdığın ya da PDF dosyasından okunan metin, parçalar hâlinde sunucuya ve oradan Google Gemini\'ye gönderilir. AI\'ın bir parçadan çıkardığı aday kelimeler ve geçtikleri cümleler, aynı metni tekrar işlememek için sunucuda en fazla 90 gün saklanır.',
        },
        {
          p: '**Makale ve altyazı içe aktarma.** Bir bağlantıdan makale aldığında yalnızca adres sunucumuza gider; sunucu sayfayı indirip metnini ayıklar, sana gönderir ve bu işlem sırasında ne adresi ne metni saklar. Metin, adresiyle birlikte okuma metinlerinin arasına cihazına kaydedilir ve giriş yaptıysan yukarıda anlatıldığı gibi kendi hesabınla eşitlenir; ortak tablolara ya da başka kullanıcılara gitmez. Altyazı dosyaları yalnızca cihazında okunur; içinden aldığın metin de aynı şekilde kaydedilir ve eşitlenir.',
        },
        {
          p: '**Bugünün hikâyesi.** Hikâye istediğinde sunucuya yalnızca o günün 5–8 kelimesi (kartlarındaki sözlük biçimleriyle), seviyen, seçtiğin okuma zorluğu ve en fazla üç ilgi alanın gider; metinlerin, cümlelerin ve anlamların gitmez. Sunucu hikâyeyi Anthropic Claude ile yazdırır, sana gönderir ve saklamaz; yalnızca günde kaç hikâye istediğin sayılır. Hikâye senin metnin olarak cihazına kaydedilir ve yalnızca kendi hesabınla eşitlenir.',
        },
        {
          p: '**Kullanım sayaçları.** Günlük AI ve sesli okuma hakkını uygulamak için gün başına kaç çağrı yaptığın sayılır.',
        },
        {
          p: '**Görseller.** Gizlediğin görseller (ve uygulamanın eski sürümlerinde verdiğin evet/hayır cevapları ile seçtiğin görseller) öğrenme verilerinle birlikte saklanır. Görseller ortak sözlük için bir kez toplu olarak çizilir; uygulama senin adına görsel istemez.',
        },
        {
          p: '**Bildirimler.** Hatırlatma bildirimlerini açarsan: tarayıcının bildirim servisi adresi ve şifreleme anahtarları, cihaz ya da tarayıcı adı ve hangi gün hatırlatma gönderildiği.',
        },
        {
          p: '**Maliyet ve eşitleme sınırları.** AI maliyetini herkes için sınırlamak üzere hesabının bu ay AI isteklerine harcattığı tahmini tutar (yalnızca bir dolar tutarı, isteklerin içeriği değil) ve her AI özelliğini günde kaç kez kullandığın sayılır. Kötüye kullanıma karşı da günde kaç eşitleme isteği gönderildiği, kaç satır ve ne kadar veri (bayt) taşındığı sayılır. Bu sayaçlarda metinlerin ya da kartların bulunmaz.',
        },
        {
          p: '**Fotoğraftan metin.** "Fotoğraftan metin" ile çektiğin ya da galeriden seçtiğin fotoğraf yalnızca cihazında okunur: Android uygulamasında Google ML Kit, web sürümünde tarayıcının içinde çalışan Tesseract ile. Fotoğraf hiçbir sunucuya gönderilmez ve saklanmaz. Okunan metni kaydedersen yalnızca metin, okuma metinlerinin arasına kaydedilir ve giriş yaptıysan kendi hesabınla eşitlenir. Android uygulamasında Google ML Kit, kendi işleyişini ölçmek için Google\'a kullanım ve performans bilgisi gönderir (cihaz modeli, Android ve uygulama sürümü, kuruluma özel bir kimlik, ne kadar sürdüğü, hata kodları); bu bilgide fotoğraf ya da okunan metin yoktur.',
        },
        {
          p: '**İşlemediklerimiz.** Konumun, rehberin, mikrofonun ve fotoğraf arşivin kullanılmaz. Kamerayı yalnızca "Fotoğraftan metin" ile sen açarsın; uygulamanın kamera izni yoktur, fotoğrafı telefonun kendi kamera uygulaması çeker. Reklam kimliği, analiz ya da izleme aracı yoktur. Uygulamanın hata kaydı yalnızca cihazında tutulur, bize gönderilmez.',
        },
      ],
    },
    {
      id: 'amaclar',
      heading: 'Neden işliyoruz',
      blocks: [
        {
          ul: [
            'Hesabını açmak, girişini sürdürmek ve verilerini cihazların arasında eşitlemek (KVKK m. 5/2-c: sözleşmenin ifası).',
            'Senin isteğinle AI özelliklerini çalıştırmak: metinden kart çıkarma, anlam bulma, temalara ayırma, sesli okuma (KVKK m. 5/2-c).',
            'Hizmeti kötüye kullanıma karşı korumak, örneğin günlük kullanım sınırları (KVKK m. 5/2-f: meşru menfaat).',
            'Açtıysan, günde en fazla bir tekrar hatırlatması göndermek.',
          ],
        },
        {
          p: 'Verilerini reklam, pazarlama ya da profil çıkarmak için kullanmıyor, kimseye satmıyoruz.',
        },
      ],
    },
    {
      id: 'aktarim',
      heading: 'Nerede işleniyor, kimlerle paylaşılıyor',
      blocks: [
        {
          p: "Engapp'i çalıştırmak için şu hizmet sağlayıcıları kullanılır. Sunucuların bir kısmı Türkiye dışındadır; verilerin bu nedenle yurt dışına aktarılır (KVKK m. 9).",
        },
        {
          ul: [
            "**Supabase** (veritabanı, giriş, sunucu fonksiyonları): hesabın ve öğrenme verilerin. Sunucular Avrupa Birliği'nde, İrlanda bölgesindedir.",
            '**Cloudflare** (web sitesinin barındırılması): uygulama dosyalarını sunarken IP adresin ve tarayıcı bilgin gibi teknik bağlantı verilerini işler. **Cloudflare R2** (dosya deposu): ortak sözlüğün ses dosyaları ve veritabanının şifrelenmiş yedekleri.',
            '**Google**: Google ile giriş; profil fotoğrafın Google\'ın sunucusundan yüklenir. **Google ML Kit** (yalnızca Android uygulamasında "Fotoğraftan metin" kullanınca): yukarıda anlatılan kullanım ve performans bilgisi; fotoğraf ve metin gönderilmez. **Google Gemini** (AI): kart çıkarmak için gönderdiğin metin parçaları, elle eklediğin kelime, temalara ayırma için kelimelerin ve kısa İngilizce tanımları, sesli okunacak kelime ya da cümle, haftalık rapor yorumu için yalnızca sayılar.',
            "**Anthropic Claude** (kelime görselleri, ortak sözlük için toplu olarak bir kez çizilir): yalnızca ortak sözlükteki kelime, sözcük türü ve Türkçe anlamı, kısa bir çizim ipucu, yeniden çizimde hazır bir düzeltme notu ve kontrol için Claude'un çizdiği resmin kendisi. Hesabına, kartlarına ya da cümlelerine ait hiçbir bilgi gönderilmez.",
            "**Anthropic Claude** (AI yedeği): Gemini'nin kotası dolduğunda, yukarıda Gemini için sayılan aynı AI istekleri Claude ile işlenir. **Anthropic Claude** (Bugünün hikâyesi): yalnızca yukarıda sayılan kelime listesi, seviye, zorluk ve ilgi alanları.",
            '**Tarayıcıların bildirim servisleri** (Google, Mozilla, Apple, Microsoft): web bildirimlerini açtıysan, şifreli hatırlatma metni ("Bugün 12 kart çalışmaya hazır" gibi).',
          ],
        },
        {
          p: "Gemini'yi şu an ücretsiz katmanda kullanıyoruz. Google'ın koşullarına göre ücretsiz katmanda gönderilen metinler Google'ın ürünlerini geliştirmek için kullanılabilir ve insan değerlendiriciler tarafından okunabilir. Bu yüzden gizli, iş ya da kişisel bilgi içeren metinleri AI ile işleme.",
        },
        {
          p: 'Örnek cümleler, hatırlatıcı önerileri, benzer kelime notları ve sesli okuma dosyaları sözlükteki ortak içerikten üretilir; bunlar için senin cümlelerin gönderilmez.',
        },
      ],
    },
    {
      id: 'ortak-sozluk',
      heading: 'Ortak sözlük',
      blocks: [
        {
          p: 'Kelime anlamları, örnek cümleler, kelime görselleri ve sözlükteki kelimelerin ses dosyaları bütün kullanıcılar için ortaktır. Bu ortak içerik bir kişiye bağlı değildir: kimin eklettiği kaydedilmez ve senin cümlelerini ya da kişisel bilgini içermez. Bu yüzden hesabını sildiğinde ortak sözlük olduğu gibi kalır.',
        },
      ],
    },
    {
      id: 'saklama',
      heading: 'Ne kadar saklıyoruz',
      blocks: [
        {
          ul: [
            'Hesabın, öğrenme verilerin ve okuma metinlerin, hesabın açık olduğu sürece saklanır.',
            'Sildiğin bir kart ya da kelime, diğer cihazlarına da silindiği bilgisi gidebilsin diye 30 gün işaretli kalır, sonra sunucudan tamamen silinir.',
            'AI aday önbelleği, AI kullanım sayaçları, eşitleme sayaçları ve gönderilen bildirim kayıtları 90 gün sonra silinir; aylık AI harcama tutarı bir sonraki ayın sonunda silinir.',
            'Hesabını sildiğinde sunucudaki bütün verilerin hemen silinir.',
            'Veritabanının şifrelenmiş bir yedeği her gece alınır ve Cloudflare R2\'de saklanır: günlük yedekler 14 gün, haftalık yedekler 8 hafta, sunucu güncellemelerinden hemen önce alınan yedekler en fazla 8 hafta tutulur. Yedekler yalnızca bir arızadan sonra verileri geri yüklemek için kullanılır; hesabını sildiğinde verilerin bu yedeklerde en fazla bu süreler boyunca kalır ve sonra kendiliğinden silinir.',
            'Hizmet sağlayıcıların kendi teknik kayıtları ve yedekleri kendi saklama sürelerine tabidir.',
          ],
        },
      ],
    },
    {
      id: 'silme',
      heading: 'Hesabını ve verilerini silme',
      blocks: [
        {
          ul: [
            'Uygulamada: **Profil → ⚙ Ayarlar → Hesap ve eşitleme → Hesabımı ve verilerimi sil.**',
            "Web'den: [hesap silme sayfası](/hesap-sil) — Google ile giriş yapıp aynı işlemi yaparsın.",
            '[[email]] E-postayla: {{email}} adresine yaz; hesabını 30 gün içinde sileriz.',
          ],
        },
        {
          p: 'Silinenler: kartların ve kelimelerin, okuma metinlerin ve karşılaşma sayıların, çalışma geçmişin ve istatistiklerin, ayarların, raporların, bildirim kayıtların, AI önbelleğin, AI ve eşitleme sayaçların, aylık AI harcama tutarın, görsel sayaçların, görsel isteklerin ve görsel cevapların (yöneticiysen yönetici kaydın ve görsel onay kararların da), ardından hesabının kendisi. Ortak sözlükteki görseller kalır. Silme geri alınamaz; istersen önce **Profil → ⚙ Ayarlar → Yedek ve veri** bölümünden JSON yedeğini indir.',
        },
        {
          p: 'Misafir modundaki veriler yalnızca cihazındadır: **Profil → ⚙ Ayarlar → Hesap ve eşitleme → Bu cihazdaki verileri sil** ile ya da uygulamayı kaldırarak silebilirsin.',
        },
      ],
    },
    {
      id: 'haklar',
      heading: 'Haklarına (KVKK m. 11)',
      blocks: [
        { p: "KVKK'nın 11. maddesine göre şu haklara sahipsin:" },
        {
          ul: [
            'kişisel verilerinin işlenip işlenmediğini öğrenme ve işlendiyse bilgi isteme;',
            'işlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme;',
            'yurt içinde ya da yurt dışında aktarıldığı üçüncü kişileri bilme;',
            'eksik ya da yanlış işlendiyse düzeltilmesini isteme;',
            "KVKK m. 7'deki şartlar çerçevesinde silinmesini ya da yok edilmesini isteme;",
            'düzeltme ve silme işlemlerinin, verilerin aktarıldığı üçüncü kişilere bildirilmesini isteme;',
            'yalnızca otomatik sistemlerle analiz edilmesi sonucunda aleyhine bir sonuç çıkmasına itiraz etme;',
            'kanuna aykırı işleme yüzünden zarara uğrarsan zararın giderilmesini isteme.',
          ],
        },
        {
          p: "[[email]] Başvurunu {{email}} adresine gönderebilirsin; en geç 30 gün içinde ücretsiz yanıt veririz. Yanıtı yeterli bulmazsan Kişisel Verileri Koruma Kurulu'na şikâyette bulunabilirsin.",
        },
        {
          p: "[[noemail]] Henüz ayrı bir başvuru adresi yayımlanmadı. O zamana kadar bu hakların çoğunu uygulamanın içinden kendin kullanabilirsin (aşağıya bak); hesabını ve verilerini [hesap silme sayfasından](/hesap-sil) silebilirsin. Kişisel Verileri Koruma Kurulu'na şikâyette bulunma hakkın her zaman saklıdır.",
        },
        {
          p: 'Verilerinin bir kopyasını istediğin an **Profil → ⚙ Ayarlar → Yedek ve veri → Yedek al** ile kendin alabilir, yanlış bir kaydı uygulamada düzeltebilirsin.',
        },
      ],
    },
    {
      id: 'guvenlik',
      heading: 'Güvenlik',
      blocks: [
        {
          p: 'Uygulama ile sunucular arasındaki bütün bağlantılar şifrelidir (HTTPS). Veritabanı yedekleri şifrelenmiş olarak saklanır. Veritabanında her kullanıcı yalnızca kendi satırlarını okuyup yazabilir (satır düzeyinde güvenlik). AI ve sunucu anahtarları yalnızca sunucuda durur, uygulamanın içinde yoktur.',
        },
      ],
    },
    {
      id: 'cocuklar',
      heading: 'Çocuklar',
      blocks: [
        {
          p: '[[email]] Engapp 18 yaşından küçükler için tasarlanmamıştır ve bilerek 18 yaşından küçüklerin verisini toplamayız. 18 yaşından küçük birinin hesap açtığını fark edersen {{email}} adresine yaz; hesabı ve verilerini sileriz.',
        },
        {
          p: '[[noemail]] Engapp 18 yaşından küçükler için tasarlanmamıştır ve bilerek 18 yaşından küçüklerin verisini toplamayız. 18 yaşından küçük birinin hesabı varsa, hesap sahibi ya da velisi hesabı ve bütün verilerini uygulamadan ya da [hesap silme sayfasından](/hesap-sil) hemen silebilir.',
        },
      ],
    },
    {
      id: 'degisiklikler',
      heading: 'Değişiklikler',
      blocks: [
        {
          p: 'Bu metin değişirse yeni hâli bu sayfada, güncelleme tarihiyle yayımlanır. İngilizce çevirisi: [Privacy policy](/privacy). İki metin arasında fark olursa Türkçe metin esastır.',
        },
      ],
    },
  ],
};
