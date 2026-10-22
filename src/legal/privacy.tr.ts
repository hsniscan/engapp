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
            'Google ile giriş yaparsan kartların ve çalışma geçmişin, cihazların arasında senkronlanmak için sunucumuzda saklanır.',
            'AI özelliklerini kullandığında gönderdiğin metin Google Gemini ile işlenir. Gizli ya da kişisel bilgi içeren metin gönderme.',
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
          p: `Veri sorumlusu, Engapp'i bireysel geliştirici olarak yayımlayan ${CONTROLLER_NAME}'dır. Bu metinle ya da verilerinle ilgili her soru ve başvuru için: {{email}}.`,
        },
      ],
    },
    {
      id: 'veriler',
      heading: 'Hangi verileri işliyoruz',
      blocks: [
        { p: '**Misafir modu.** Hesap açmadan kullandığında kartların, geçmişin ve ayarların yalnızca bu cihazın tarayıcı veritabanında (ya da uygulamanın kendi deposunda) tutulur. Misafir modunda AI ve senkron kullanılamaz; sunucuya veri gönderilmez.' },
        { p: '**Google ile giriş.** Giriş, Supabase Auth üzerinden Google hesabınla yapılır. Google hesabından yalnızca adın, e-posta adresin, profil fotoğrafının bağlantısı ve Google hesap kimliğin alınır. Şifren bize hiç gelmez.' },
        { p: '**Öğrenme verilerin** (giriş yaptıysan, senkron için sunucuda):' },
        {
          ul: [
            'eklediğin kelimeler ve kalıplar, anlamları, etiketlerin, destelerin;',
            'kendi örnek cümlelerin ve çevirileri, kendi hatırlatıcı notların, düzenlediğin örnek cümleler, beğendiğin ya da gizlediğin içerik işaretleri;',
            'kartların tekrar planı ve cevap geçmişin: hangi karta ne zaman hangi cevabı verdiğin, cevap süresi, alıştırma cevapların;',
            'seviye testi sonuçların, bildiğin kelimeler, haftalık rapor özetlerin (sayılar ve varsa AI yorumu);',
            'ayarların: saat dilimi, günün başlangıç saati, seviye, ilgi alanların, hedeflerin, bildirim tercihin;',
            'içe aktardığın kaynakların adı, dosya adı ve sayfa sayısı (metnin tamamı sunucuda saklanmaz).',
          ],
        },
        { p: '**Cihaz kimliği.** Uygulama, senkron için her kuruluma rastgele bir cihaz kimliği verir ve bunu cevap kayıtlarına yazar. Bu bir reklam kimliği değildir; telefonun donanım kimliklerine erişilmez.' },
        { p: '**AI ile işlenen metinler.** "Metinden kart çıkar" ile yapıştırdığın ya da PDF dosyasından okunan metin, parçalar hâlinde sunucuya ve oradan Google Gemini\'ye gönderilir. AI\'ın bir parçadan çıkardığı aday kelimeler ve geçtikleri cümleler, aynı metni tekrar işlememek için sunucuda en fazla 90 gün saklanır.' },
        { p: '**Kullanım sayaçları.** Günlük AI ve sesli okuma hakkını uygulamak için gün başına kaç çağrı yaptığın sayılır.' },
        { p: '**Bildirimler.** Hatırlatma bildirimlerini açarsan: tarayıcının bildirim servisi adresi ve şifreleme anahtarları, cihaz ya da tarayıcı adı ve hangi gün hatırlatma gönderildiği.' },
        { p: '**İşlemediklerimiz.** Konumun, rehberin, fotoğrafların, mikrofonun ya da kameran kullanılmaz. Reklam kimliği, analiz ya da izleme aracı yoktur. Uygulamanın hata kaydı yalnızca cihazında tutulur, bize gönderilmez.' },
      ],
    },
    {
      id: 'amaclar',
      heading: 'Neden işliyoruz',
      blocks: [
        {
          ul: [
            'Hesabını açmak, girişini sürdürmek ve verilerini cihazların arasında senkronlamak (KVKK m. 5/2-c: sözleşmenin ifası).',
            'Senin isteğinle AI özelliklerini çalıştırmak: metinden kart çıkarma, anlam bulma, temalara ayırma, sesli okuma (KVKK m. 5/2-c).',
            'Hizmeti kötüye kullanıma karşı korumak, örneğin günlük kullanım sınırları (KVKK m. 5/2-f: meşru menfaat).',
            'Açtıysan, günde en fazla bir tekrar hatırlatması göndermek.',
          ],
        },
        { p: 'Verilerini reklam, pazarlama ya da profil çıkarmak için kullanmıyor, kimseye satmıyoruz.' },
      ],
    },
    {
      id: 'aktarim',
      heading: 'Nerede işleniyor, kimlerle paylaşılıyor',
      blocks: [
        { p: 'Engapp\'i çalıştırmak için şu hizmet sağlayıcıları kullanılır. Sunucuların bir kısmı Türkiye dışındadır; verilerin bu nedenle yurt dışına aktarılır (KVKK m. 9).' },
        {
          ul: [
            '**Supabase** (veritabanı, giriş, sunucu fonksiyonları): hesabın ve öğrenme verilerin. Sunucular Avrupa Birliği\'nde, İrlanda bölgesindedir.',
            '**Cloudflare** (web sitesinin barındırılması): uygulama dosyalarını sunarken IP adresin ve tarayıcı bilgin gibi teknik bağlantı verilerini işler.',
            '**Google**: Google ile giriş; profil fotoğrafın Google\'ın sunucusundan yüklenir. **Google Gemini** (AI): kart çıkarmak için gönderdiğin metin parçaları, elle eklediğin kelime, temalara ayırma için kelimelerin ve kısa İngilizce tanımları, sesli okunacak kelime ya da cümle, haftalık rapor yorumu için yalnızca sayılar.',
            '**Anthropic Claude** (kelime görselleri): yalnızca sözlükteki kelime, sözcük türü ve Türkçe anlamı ile kısa bir çizim ipucu. Hesabına ya da kartlarına ait hiçbir bilgi gönderilmez.',
            '**Tarayıcıların bildirim servisleri** (Google, Mozilla, Apple, Microsoft): web bildirimlerini açtıysan, şifreli hatırlatma metni ("Bugün 12 tekrar seni bekliyor" gibi).',
          ],
        },
        { p: 'Gemini\'yi şu an ücretsiz katmanda kullanıyoruz. Google\'ın koşullarına göre ücretsiz katmanda gönderilen metinler Google\'ın ürünlerini geliştirmek için kullanılabilir ve insan değerlendiriciler tarafından okunabilir. Bu yüzden gizli, iş ya da kişisel bilgi içeren metinleri AI ile işleme.' },
        { p: 'Örnek cümleler, hatırlatıcı önerileri, benzer kelime notları ve sesli okuma dosyaları sözlükteki ortak içerikten üretilir; bunlar için senin cümlelerin gönderilmez.' },
      ],
    },
    {
      id: 'ortak-sozluk',
      heading: 'Ortak sözlük',
      blocks: [
        { p: 'Kelime anlamları, örnek cümleler, kelime görselleri ve sözlükteki kelimelerin ses dosyaları bütün kullanıcılar için ortaktır. Bu ortak içerik bir kişiye bağlı değildir: kimin eklettiği kaydedilmez ve senin cümlelerini ya da kişisel bilgini içermez. Bu yüzden hesabını sildiğinde ortak sözlük olduğu gibi kalır.' },
      ],
    },
    {
      id: 'saklama',
      heading: 'Ne kadar saklıyoruz',
      blocks: [
        {
          ul: [
            'Hesabın ve öğrenme verilerin, hesabın açık olduğu sürece saklanır.',
            'Sildiğin bir kart ya da kelime, diğer cihazlarına da silindiği bilgisi gidebilsin diye 30 gün işaretli kalır, sonra sunucudan tamamen silinir.',
            'AI aday önbelleği, AI kullanım sayaçları ve gönderilen bildirim kayıtları 90 gün sonra silinir.',
            'Hesabını sildiğinde sunucudaki bütün verilerin hemen silinir.',
            'Hizmet sağlayıcıların kendi teknik kayıtları ve yedekleri kendi saklama sürelerine tabidir; bu kayıtlarda kartlarının içeriği bulunmaz.',
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
            'Uygulamada: **Ayarlar → Hesap → Hesabımı ve verilerimi sil.**',
            'Web\'den: [hesap silme sayfası](/hesap-sil) — Google ile giriş yapıp aynı işlemi yaparsın.',
            'E-postayla: {{email}} adresine yaz; hesabını 30 gün içinde sileriz.',
          ],
        },
        { p: 'Silinenler: kartların ve kelimelerin, çalışma geçmişin ve istatistiklerin, ayarların, raporların, bildirim kayıtların, AI önbelleğin ve sayaçların, ardından hesabının kendisi. Silme geri alınamaz; istersen önce **Ayarlar → Veri** bölümünden JSON yedeğini indir.' },
        { p: 'Misafir modundaki veriler yalnızca cihazındadır: **Ayarlar → Hesap → Bu cihazdaki verileri sil** ile ya da uygulamayı kaldırarak silebilirsin.' },
      ],
    },
    {
      id: 'haklar',
      heading: 'Haklarına (KVKK m. 11)',
      blocks: [
        { p: 'KVKK\'nın 11. maddesine göre şu haklara sahipsin:' },
        {
          ul: [
            'kişisel verilerinin işlenip işlenmediğini öğrenme ve işlendiyse bilgi isteme;',
            'işlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme;',
            'yurt içinde ya da yurt dışında aktarıldığı üçüncü kişileri bilme;',
            'eksik ya da yanlış işlendiyse düzeltilmesini isteme;',
            'KVKK m. 7\'deki şartlar çerçevesinde silinmesini ya da yok edilmesini isteme;',
            'düzeltme ve silme işlemlerinin, verilerin aktarıldığı üçüncü kişilere bildirilmesini isteme;',
            'yalnızca otomatik sistemlerle analiz edilmesi sonucunda aleyhine bir sonuç çıkmasına itiraz etme;',
            'kanuna aykırı işleme yüzünden zarara uğrarsan zararın giderilmesini isteme.',
          ],
        },
        { p: 'Başvurunu {{email}} adresine gönderebilirsin; en geç 30 gün içinde ücretsiz yanıt veririz. Yanıtı yeterli bulmazsan Kişisel Verileri Koruma Kurulu\'na şikâyette bulunabilirsin.' },
        { p: 'Verilerinin bir kopyasını istediğin an **Ayarlar → Veri → JSON yedeğini indir** ile kendin alabilir, yanlış bir kaydı uygulamada düzeltebilirsin.' },
      ],
    },
    {
      id: 'guvenlik',
      heading: 'Güvenlik',
      blocks: [
        { p: 'Uygulama ile sunucular arasındaki bütün bağlantılar şifrelidir (HTTPS). Veritabanında her kullanıcı yalnızca kendi satırlarını okuyup yazabilir (satır düzeyinde güvenlik). AI ve sunucu anahtarları yalnızca sunucuda durur, uygulamanın içinde yoktur.' },
      ],
    },
    {
      id: 'cocuklar',
      heading: 'Çocuklar',
      blocks: [
        { p: 'Engapp 18 yaşından küçükler için tasarlanmamıştır ve bilerek 18 yaşından küçüklerin verisini toplamayız. 18 yaşından küçük birinin hesap açtığını fark edersen {{email}} adresine yaz; hesabı ve verilerini sileriz.' },
      ],
    },
    {
      id: 'degisiklikler',
      heading: 'Değişiklikler',
      blocks: [
        { p: 'Bu metin değişirse yeni hâli bu sayfada, güncelleme tarihiyle yayımlanır. İngilizce çevirisi: [Privacy policy](/privacy). İki metin arasında fark olursa Türkçe metin esastır.' },
      ],
    },
  ],
};
