# Yanıltıcı benzer kelimeler (İngilizce → Türkçe)

Bu liste kartın arka yüzündeki turuncu **"yanıltıcı benzer"** şeridini besler: öğrendiğin
İngilizce kelime, Türkçedeki bir kelimeye benziyor ama anlamı farklıysa uyarı çıkar.
Örnek: **actually ≠ aktüel**. *actually* = aslında, gerçekte; *aktüel* = güncel (İng. *current*).

Liste Engapp için elle yazıldı; başka bir listeden kopyalanmadı. Gözden geçirirken her satırda
şunlara bak: İngilizce anlam doğru mu, Türkçe kelimenin anlamı doğru mu, karıştırma gerçekten
olur mu? Yanlış satırı düzelt ya da sil; yeni satır eklemek için tabloya bir satır yaz.
Uygulama bu tabloyu doğrudan okur; ayrıca bir üretim adımı yoktur. Tabloda hata varsa (eksik
sütun, bilinmeyen "Tür", tekrar eden satır) testler satır numarasıyla birlikte başarısız olur.
Sunucudaki `lexicon_pair_notes` tablosu da `node scripts/build-morphology/load-sql.ts` ile bu
tablodan güncellenir; listeden silinen satır sunucuda "retired" olarak işaretlenir.

**Sütunlar**

- **İngilizce**: kartın terimi (sözlük biçimi, küçük harf).
- **Benzeyen Türkçe**: karıştırılan Türkçe kelime.
- **İngilizcesi**: İngilizce kelimenin Türkçe anlamı (kartta "=" ile gösterilir).
- **Türkçesi**: Türkçe kelimenin anlamı.
- **İng. karşılığı**: Türkçe kelimenin İngilizcesi (kartta "İng. …" diye gösterilir; boş olabilir).
- **Tür**: `tam` = anlamlar tamamen farklı; `kısmi` = anlamlar kısmen örtüşür ama tuzak var.
- **Not**: isteğe bağlı kısa açıklama (kartta küçük yazıyla görünür).

| İngilizce | Benzeyen Türkçe | İngilizcesi | Türkçesi | İng. karşılığı | Tür | Not |
| --- | --- | --- | --- | --- | --- | --- |
| actually | aktüel | aslında, gerçekte | güncel | current, topical | tam | |
| actual | aktüel | gerçek, asıl | güncel | current | tam | |
| eventually | eventüel | sonunda, en sonunda | olası (hukukta "eventüel kast") | possible | tam | "Muhtemelen" anlamı yoktur. |
| eventual | eventüel | en sonunda ortaya çıkan, nihai | olası | possible | tam | |
| sympathetic | sempatik | anlayışlı, halden anlayan; destekleyen | sevimli, cana yakın | likeable, pleasant | tam | |
| sympathy | sempati | birinin derdini paylaşma, başsağlığı; destek | hoşlanma, sıcak bir yakınlık | liking, affection | kısmi | |
| sympathize | sempati duymak | derdini anlamak, acısını paylaşmak; desteklemek | birinden hoşlanmak | to like someone | kısmi | |
| control | kontrol etmek | yönetmek, hâkim olmak, denetim altında tutmak | gözden geçirmek, doğru mu diye bakmak | to check | kısmi | "Ödevimi kontrol ettim" = "I checked my homework". |
| pension | pansiyon | emekli maaşı | küçük otel, konukevi | guesthouse | tam | |
| preservative | prezervatif | koruyucu madde (gıdada) | kondom | condom | tam | |
| romance | roman | aşk ilişkisi; romantik hikâye | uzun kurgusal yapıt | novel | tam | |
| magazine | mağaza | dergi | dükkân, satış yeri | shop, store | tam | |
| fabric | fabrika | kumaş | üretim yeri | factory | tam | |
| pathetic | patetik | acınacak, zavallı; (günlük dil) berbat | aşırı duygusal, dokunaklı | overly emotional | kısmi | |
| agenda | ajanda | gündem, toplantıda konuşulacaklar | not defteri, planlayıcı | diary, planner | tam | |
| economic | ekonomik | ekonomiyle ilgili | ucuz, tutumlu | cheap, economical | kısmi | Ucuz için "economical" ya da "cheap" denir. |
| artist | artist | sanatçı (ressam, müzisyen, yazar…) | oyuncu, sahne sanatçısı | actor, actress, performer | kısmi | |
| receipt | reçete | makbuz, fiş | doktorun yazdığı ilaç listesi | prescription | tam | |
| recipe | reçete | yemek tarifi | doktorun yazdığı ilaç listesi | prescription | tam | |
| saloon | salon | bar, meyhane (ABD); sedan otomobil (İngiltere) | oturma odası; büyük toplantı ya da düğün yeri | living room, hall | tam | |
| bank | bank | banka; nehir kıyısı | park oturağı | bench | tam | |
| pasta | pasta | makarna | kremalı tatlı | cake | tam | |
| marmalade | marmelat | portakal ya da turunç reçeli | meyve ezmesi, reçel | jam | kısmi | |
| soda | soda | gazlı tatlı içecek (ABD); sodyum karbonat | maden suyu | sparkling mineral water | kısmi | |
| college | kolej | yüksekokul, üniversite | özel (çoğu zaman yabancı dilde eğitim veren) okul | private school | kısmi | |
| faculty | fakülte | öğretim kadrosu (ABD); yeti, yetenek | üniversitede fakülte | school, faculty (UK) | kısmi | |
| course | kurs | ders (dönem boyunca); yön, rota; yemeğin bir bölümü | kısa eğitim programı | training course | kısmi | |
| note | not | kısa yazı, not; müzik notası; banknot | okulda alınan puan | grade, mark | kısmi | "İyi not aldım" = "I got a good grade". |
| tribune | tribün | (tarih) halk temsilcisi; gazete adı | stadyumda seyirci yeri | stand | tam | |
| physician | fizikçi | doktor, hekim | fizik bilimcisi | physicist | tam | |
| cabinet | kabine | dolap, vitrinli dolap; (siyaset) kabine | bakanlar kurulu; prova kabini | cabinet (government), fitting room | kısmi | |
| carton | karton | süt ya da meyve suyu kutusu | mukavva | cardboard | kısmi | |
| etiquette | etiket | görgü kuralları | ürün üstündeki yazılı kâğıt | label, tag | tam | |
| palace | palas | saray | (eski) büyük otel, han | grand hotel | tam | |
| apartment | apartman | daire (bir binadaki tek konut) | çok daireli bina | apartment building | kısmi | |
| residence | rezidans | konut, ikamet yeri | lüks konut binası | luxury apartment building | kısmi | |
| site | site | yer, alan; web sitesi | toplu konut alanı | housing complex | kısmi | |
| plaza | plaza | meydan; alışveriş merkezi (ABD) | büyük iş merkezi binası | office tower | kısmi | |
| benzine | benzin | benzen türü kimyasal çözücü | arabaların yakıtı | petrol (UK), gasoline (US) | tam | |
| petrol | petrol | benzin (İngiltere) | ham petrol | crude oil | kısmi | |
| gas | gaz | benzin (ABD); gaz | gaz | gas | kısmi | "Gas station" benzinliktir. |
| serial | seri | dizi (TV); sıra numarası | hızlı | fast, quick | kısmi | Türkçede "seri" ayrıca dizi demektir. |
| critic | kritik | eleştirmen | önemli, can alıcı; eleştiri | critical; criticism | tam | |
| comfort | konfor | rahatlık; teselli, avuntu | fiziksel rahatlık, lüks | comfort, luxury | kısmi | "comfort someone" = birini teselli etmek. |
| conference | konferans | toplantı, kongre; görüşme | bir kişinin verdiği konuşma | lecture, talk | kısmi | |
| fantastic | fantastik | harika, müthiş | hayal ürünü (fantastik film, roman) | fantasy | kısmi | |
| terrific | terör | harika, müthiş | şiddetle korku yayma | terrorism | tam | Kulağa "korkunç" gibi gelse de övgüdür. |
| phenomenon | fenomen | olgu, doğa olayı | (günlük dil) sosyal medya ünlüsü | influencer | kısmi | |
| figure | figür | rakam, sayı; şekil; önemli kişi; vücut hatları | dans ya da sanatta figür | figure (in dance, art) | kısmi | En sık anlamı "rakam"dır. |
| rapport | rapor | iki kişi arasındaki yakınlık, uyum | yazılı inceleme belgesi | report | tam | |
| conductor | kondüktör | orkestra şefi; iletken madde; (İngiltere) otobüs biletçisi | trende bilet kontrol eden görevli | ticket inspector | kısmi | |
| chef | şef | aşçıbaşı, usta aşçı | yönetici, patron | boss, manager | kısmi | |
| director | direktör | film yönetmeni; müdür, yönetim kurulu üyesi | (sporda) teknik direktör | head coach | kısmi | Film için "yönetmen" demektir. |
| journal | jurnal | bilimsel dergi; günlük | gammazlama, ihbar | informing (on someone) | tam | |
| dram | dram | (viski gibi içkiden) bir yudum | acıklı olay; drama | drama, tragedy | tam | |
| son | son | oğul | bitiş; en sondaki | end, last | tam | |
| bin | bin | çöp kutusu | 1000 sayısı | thousand | tam | |
| on | on | üstünde; açık (cihaz) | 10 sayısı | ten | tam | |
| kin | kin | akrabalar, soy | düşmanlık, öfke | grudge, hatred | tam | |
| dam | dam | baraj | çatı; ahır | roof; barn | tam | |
| bay | bay | koy, küçük körfez | erkeklere hitap (Bay Yılmaz) | Mr | tam | |
| can | can | -ebilmek; konserve kutusu | ruh, hayat | soul, life | tam | |
| tip | tip | bahşiş; ipucu; uç | tür, çeşit; (günlük dil) tuhaf kişi | type; character | tam | |
| bot | bot | yazılım robotu | çizme; küçük tekne | boot; small boat | tam | |
| ham | ham | jambon (domuz eti) | olgunlaşmamış, işlenmemiş | raw | tam | |
| art | art | sanat | arka (art arda) | back, rear | tam | |
| hat | hat | şapka | çizgi; ulaşım hattı; yazı sanatı | line; calligraphy | tam | |
| dip | dip | daldırmak; sos (cipsle yenen) | en alt, taban | bottom | tam | |
| kale | kale | kara lahana | savunma yapısı; futbolda kale | castle; goal | tam | |
| boy | boy | erkek çocuk | uzunluk | height | tam | |
| top | top | en üst; tepe; üst giysi | oyun topu | ball | tam | |
| ten | ten | 10 sayısı | deri, cilt rengi | skin, complexion | tam | |
| say | say | söylemek | saymak (emir kipi) | count | tam | |
| gel | gel | jöle, jel | gelmek (emir kipi) | come | tam | |
| bit | bit | parça, biraz; (bilişim) bit | küçük böcek; bitmek (emir kipi) | louse; finish | tam | |
| sap | sap | bitki özsuyu; (günlük dil) saf kimse | tutacak yer, kulp | handle, stem | tam | |
| personal | personel | kişisel, özel | çalışanlar, kadro | staff, personnel | tam | |
| prospect | prospektüs | olasılık, beklenti; potansiyel müşteri | ilaç kullanma kılavuzu; broşür | package leaflet, brochure | tam | |
| advocate | avukat | savunucu, destekçi; savunmak | hukukçu | lawyer | kısmi | |
| parole | parola | şartlı tahliye | şifre | password | tam | |
| passage | pasaj | geçit, koridor; metinden bir parça | dükkânlarla dolu kapalı çarşı | arcade | kısmi | |
| local | lokal | yerel, mahallî | dernek ya da kulüp binası | clubhouse | kısmi | |
| buffet | büfe | açık büfe yemek | küçük yiyecek satış yeri | kiosk, snack bar | kısmi | |
| toast | tost | kızarmış ekmek; kadeh kaldırma | kaşarlı ızgara sandviç | toasted sandwich | kısmi | |
| class | klas | sınıf; ders | şık, kaliteli | classy | kısmi | |
| combine | kombin | birleştirmek; biçerdöver | kıyafet bütünü | outfit | tam | |
| smoking | smokin | sigara içme | resmî erkek kıyafeti | tuxedo, dinner jacket | tam | |
| body | body | vücut, beden; kurum | tek parça iç giyim; bebek zıbını | bodysuit | tam | |
| tights | tayt | külotlu çorap | dar, esnek pantolon | leggings | kısmi | |
| slip | slip | kaymak; küçük kâğıt parçası; kombinezon | erkek iç çamaşırı | briefs | tam | |
| premium | prim | sigorta primi; üstün kalite | ikramiye, satış primi | bonus | kısmi | |
| patron | patron | sanat hamisi, destekçi; müdavim müşteri | işveren, şef | boss | tam | |
| expert | eksper | uzman | hasar ya da sigorta değerlendiricisi | insurance assessor | kısmi | |
| operator | operatör | makineyi kullanan kişi; işletmeci şirket | cerrah | surgeon | kısmi | Türkçede ayrıca GSM operatörü. |
| reserved | rezerve | ayrılmış; çekingen, ağzı sıkı | ayrılmış | reserved | kısmi | Kişi için "çekingen" demektir. |
| campaign | kampanya | siyasi ya da reklam kampanyası | indirim, fırsat (mağazada) | sale, special offer | kısmi | |
| promotion | promosyon | terfi; tanıtım | hediye ürün | freebie, giveaway | kısmi | "She got a promotion" = terfi aldı. |
| motor oil | motorin | motor yağı | dizel yakıt | diesel | tam | |
| climate | klima | iklim | soğutma cihazı | air conditioner | tam | |
| aspirator | aspiratör | (tıp) emme cihazı | mutfak davlumbazı | extractor fan, cooker hood | tam | |
| ventilator | vantilatör | solunum cihazı (yoğun bakım); havalandırma | serinletici pervane | fan | tam | |
| composition | kompozisyon | beste; bileşim; düzenleme | okulda yazılan yazı | essay | kısmi | |
| copy | kopya | kopya; (kitap) nüsha | sınavda kopya çekme | cheating | kısmi | Sınavda kopya için "cheat" denir. |
| assistant | asistan | yardımcı | üniversitede araştırma görevlisi; tıpta uzmanlık öğrencisi | research assistant; resident | kısmi | |
| rector | rektör | (İngiltere) papaz; (İskoçya) okul müdürü | üniversite başkanı | university president | kısmi | |
| console | konsol | oyun konsolu; teselli etmek | çekmeceli mobilya | sideboard | kısmi | Fiil olarak "teselli etmek" demektir. |
| commode | komodin | şifoniyer; (eski) lazımlıklı sandalye | yatak başı dolabı | bedside table | kısmi | |
| bloke | bloke | (İngiltere, günlük dil) adam, herif | kullanılmasına izin verilmeyen (para, hesap) | blocked | tam | |
| rant | rant | öfkeyle uzun uzun söylenmek | emek harcamadan elde edilen kazanç | unearned income | tam | |
| provision | provizyon | sağlama, tedarik; hüküm, şart; erzak | kartta ön onay | pre-authorisation | kısmi | |
| naive | naif | saf, toy, deneyimsiz | (günlük dil) ince, kibar, narin | gentle, delicate | kısmi | İngilizcede olumsuz bir anlamı vardır. |
| intriguing | entrikalı | ilgi çekici, merak uyandıran | dolap çeviren, entrika dolu | scheming | tam | |
| fantasy | fantezi | hayal; fantastik tür | süs için yapılmış, gösterişli | fancy, novelty | kısmi | |
| jest | jest | şaka | nezaket gösteren hareket | gesture | tam | |
| mimic | mimik | taklit etmek; taklitçi | yüz ifadesi | facial expression | tam | |
| replica | replik | kopya, benzeri | (tiyatro) karşılık söz | line, retort | tam | |
| prove | prova | kanıtlamak | deneme, son çalışma; kıyafet denemesi | rehearsal; fitting | tam | |
| generic | jenerik | genel; markasız (jenerik ilaç) | filmin başında ya da sonunda akan yazılar | credits | kısmi | |
| scenario | senaryo | olası durum, senaryo | film metni | screenplay, script | kısmi | |
| form | forma | biçim; doldurulacak belge | sporcu kıyafeti | jersey, kit | tam | |
| angina | anjin | göğüs ağrısı (kalp kaynaklı) | bademcik iltihabı | tonsillitis | tam | |
| pomade | pomad | saç briyantini | merhem | ointment | tam | |
| serum | serum | serum (kan serumu, cilt serumu) | damardan verilen sıvı | IV drip | kısmi | |
| lavatory | lavabo | tuvalet | el yıkama yeri | washbasin, sink | tam | |
| principal | prensip | ana, başlıca; (ABD) okul müdürü | ilke | principle | tam | |
| argument | argüman | tartışma, kavga; gerekçe | gerekçe, kanıt | reason, point | kısmi | "We had an argument" = tartıştık, kavga ettik. |
| realize | realize etmek | fark etmek, anlamak; gerçekleştirmek | (iş dili) gerçekleştirmek | to achieve, to carry out | kısmi | En sık anlamı "fark etmek"tir. |
| effective | efektif | etkili; yürürlükte | (bankacılıkta) nakit | cash | kısmi | |
| objective | objektif | amaç, hedef; nesnel | fotoğraf makinesinin merceği; nesnel | lens | kısmi | |
| marginal | marjinal | önemsiz, çok küçük; sınırda | sıra dışı, aykırı | unconventional | kısmi | |
| mode | moda | biçim, kip, mod | giyimde akım | fashion | tam | |
| image | imaj | görüntü, resim; imaj | (kişinin, şirketin) dışarıdaki imajı | public image | kısmi | |
| organization | organizasyon | kuruluş, örgüt; düzen | etkinlik düzenleme (düğün, parti) | event planning | kısmi | |
| license | lisans | ehliyet, ruhsat, izin | üniversite diploması (4 yıllık) | bachelor's degree | kısmi | "driving licence" = ehliyet. |
| visa | vize | vize (yurt dışı izni) | dönem ortası sınavı | midterm exam | kısmi | |
| favor | favori | iyilik, lütuf | en çok sevilen | favourite | tam | |
| chips | cips | patates kızartması (İngiltere); cips (ABD) | ince kızarmış patates dilimi | crisps (UK) | kısmi | |
| pane | pane | pencere camı | galeta ununa bulanıp kızartılmış | breaded | tam | |
| conserve | konserve | korumak, tasarruf etmek; reçel | kutu yiyeceği | canned food | tam | |
| liquor | likör | sert alkollü içki | tatlı, aromalı içki | liqueur | kısmi | |
| confection | konfeksiyon | şekerleme, tatlı | hazır giyim | ready-to-wear clothing | tam | |
| lecture | lektör | ders, konferans konuşması; azar | yabancı dil okutmanı | language instructor | tam | |
| kiosk | köşk | büfe, satış kulübesi; bilgi ekranı | bahçe içinde büyük ev | mansion, pavilion | tam | |
| pavilion | pavyon | fuar ya da spor alanında yapı, çardak | gece kulübü | nightclub | tam | |
| stand | stant | durmak; tribün | fuarda tanıtım yeri | booth | kısmi | |
| ordinary | ordinaryüs | sıradan, olağan | kıdemli profesör (eski unvan) | full professor (former title) | tam | |
| sensation | sansasyon | duyum, his; büyük ilgi uyandıran olay | büyük ilgi uyandıran olay | sensation | kısmi | "a burning sensation" = yanma hissi. |
| cartoon | karton | çizgi film; karikatür | mukavva | cardboard | tam | |
| bonnet | bone | (İngiltere) motor kaputu; bağcıklı kadın şapkası | kafaya geçirilen örgü şapka | beanie | kısmi | |
