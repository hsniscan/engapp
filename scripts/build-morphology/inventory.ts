// Curated inventory of English affixes and classical roots that Engapp can show as
// "kök/ek" cards. Which WORDS carry a morpheme is decided by the data (MorphyNet
// derivations, Wiktionary etymologies); this file only says which morphemes exist, how they
// are written, a short English gloss and a short Turkish fallback meaning (shown until the
// one-off `morpheme-tr-v1` job has written its explanation).
//
// Roots carry two patterns:
//   match    – the word's spelling must contain the root (e.g. /spect|spic/),
//   evidence – the word's (or a family member's) Wiktionary etymology, diacritics removed and
//              lower-cased, must mention the classical source (e.g. Latin speciō, spectō).
// Both must hold, so "sport" is not a -port- word and "spectrum" is a -spect- word.

export type MorphemeKind = 'prefix' | 'suffix' | 'root';
export type MorphemeOrigin = 'latin' | 'greek' | 'germanic' | 'french';

export interface MorphemeDef {
  /** Stable key (also the ref_morphemes id). */
  id: string;
  /** Display form: "re-", "-ness", "-spect-". */
  form: string;
  kind: MorphemeKind;
  origin: MorphemeOrigin;
  gloss_en: string;
  /** Short hand-written Turkish meaning: the fallback before the AI job has run. */
  tr: string;
  /** MorphyNet morpheme strings that mean this affix ("ation" → -tion). */
  morphynet?: string[];
  /** Prefix in-/im-/il-/ir- (negation) applies only to adjectives in MorphyNet. */
  onlySourcePos?: string[];
  /** Suffix -en (verbs) / -y (adjectives): only MorphyNet edges that make this POS. */
  onlyTargetPos?: string[];
  /** Words that match the patterns but are not related (former ← Old English forma). */
  exclude?: string[];
  /** Roots: spelling pattern of the word. */
  match?: RegExp;
  /** Roots: pattern over the normalized etymology text. */
  evidence?: RegExp;
}

const p = (
  id: string,
  form: string,
  origin: MorphemeOrigin,
  gloss_en: string,
  tr: string,
  morphynet: string[],
  extra: Partial<MorphemeDef> = {},
): MorphemeDef => ({ id: `${id}-`, form, kind: 'prefix', origin, gloss_en, tr, morphynet, ...extra });

const s = (
  id: string,
  form: string,
  origin: MorphemeOrigin,
  gloss_en: string,
  tr: string,
  morphynet: string[],
  extra: Partial<MorphemeDef> = {},
): MorphemeDef => ({ id: `-${id}`, form, kind: 'suffix', origin, gloss_en, tr, morphynet, ...extra });

const r = (
  id: string,
  form: string,
  origin: MorphemeOrigin,
  gloss_en: string,
  tr: string,
  match: RegExp,
  evidence: RegExp,
  exclude?: string[],
): MorphemeDef => ({ id, form, kind: 'root', origin, gloss_en, tr, match, evidence, ...(exclude ? { exclude } : {}) });

export const PREFIXES: MorphemeDef[] = [
  p('un', 'un-', 'germanic', 'not; reverse of', 'değil; tersini yapmak', ['un']),
  p('re', 're-', 'latin', 'again; back', 'yeniden, tekrar; geri', ['re']),
  p('in', 'in-', 'latin', 'not (also im-, il-, ir-)', 'değil, -sız (im-, il-, ir- biçimleri de var)', ['in', 'im', 'il', 'ir'], {
    onlySourcePos: ['J'],
  }),
  p('dis', 'dis-', 'latin', 'not; opposite of; apart', 'değil; karşıtı; ayırmak', ['dis']),
  p('mis', 'mis-', 'germanic', 'wrongly, badly', 'yanlış, kötü biçimde', ['mis']),
  p('pre', 'pre-', 'latin', 'before', 'önce, ön-', ['pre']),
  p('non', 'non-', 'latin', 'not', 'olmayan, -sız', ['non']),
  p('over', 'over-', 'germanic', 'too much; above', 'aşırı; üstünde', ['over']),
  p('under', 'under-', 'germanic', 'too little; below', 'yetersiz; altında', ['under']),
  p('out', 'out-', 'germanic', 'more than; outside', 'geçmek, aşmak; dışarı', ['out']),
  p('inter', 'inter-', 'latin', 'between, among', 'arası, karşılıklı', ['inter']),
  p('sub', 'sub-', 'latin', 'under, below', 'alt, altında', ['sub']),
  p('super', 'super-', 'latin', 'above, beyond', 'üstün, üst-, aşırı', ['super']),
  p('trans', 'trans-', 'latin', 'across, beyond', 'öte, karşıya, bir yerden öbürüne', ['trans']),
  p('anti', 'anti-', 'greek', 'against', 'karşıt, -e karşı', ['anti']),
  p('de', 'de-', 'latin', 'remove, reverse; down', 'gidermek, tersine çevirmek; aşağı', ['de']),
  p('en', 'en-', 'french', 'make, put into (also em-)', 'yapmak, içine koymak (em- biçimi de var)', ['en', 'em']),
  p('co', 'co-', 'latin', 'together, with (also con-, com-)', 'birlikte, ortak (con-, com- biçimleri de var)', ['co', 'con', 'com']),
  p('fore', 'fore-', 'germanic', 'before, front', 'önceden, ön', ['fore']),
  p('mid', 'mid-', 'germanic', 'middle', 'orta', ['mid']),
  p('post', 'post-', 'latin', 'after', 'sonra, sonrası', ['post']),
  p('multi', 'multi-', 'latin', 'many', 'çok', ['multi']),
  p('auto', 'auto-', 'greek', 'self', 'kendi, kendiliğinden', ['auto']),
  p('bi', 'bi-', 'latin', 'two, twice', 'iki', ['bi']),
  p('tri', 'tri-', 'latin', 'three', 'üç', ['tri']),
  p('semi', 'semi-', 'latin', 'half, partly', 'yarı', ['semi']),
  p('ex', 'ex-', 'latin', 'former; out of', 'eski; dışarı', ['ex']),
  p('counter', 'counter-', 'latin', 'against, opposite', 'karşı', ['counter']),
  p('tele', 'tele-', 'greek', 'far, at a distance', 'uzak', ['tele']),
  p('micro', 'micro-', 'greek', 'very small', 'çok küçük', ['micro']),
  p('bio', 'bio-', 'greek', 'life', 'yaşam, canlı', ['bio']),
  p('pro', 'pro-', 'latin', 'for, in favour of; forward', 'yanlısı; ileri', ['pro']),
  p('extra', 'extra-', 'latin', 'outside, beyond', 'dışında, ötesinde', ['extra']),
  p('mono', 'mono-', 'greek', 'one, single', 'tek', ['mono']),
  p('poly', 'poly-', 'greek', 'many', 'çok', ['poly']),
  p('uni', 'uni-', 'latin', 'one', 'tek, bir', ['uni']),
  p('hyper', 'hyper-', 'greek', 'over, excessive', 'aşırı', ['hyper']),
  p('ultra', 'ultra-', 'latin', 'beyond, extremely', 'ötesi, son derece', ['ultra']),
  p('neo', 'neo-', 'greek', 'new', 'yeni', ['neo']),
  p('para', 'para-', 'greek', 'beside; beyond', 'yanında; ötesinde', ['para']),
  p('geo', 'geo-', 'greek', 'earth', 'yer, dünya', ['geo']),
  p('photo', 'photo-', 'greek', 'light', 'ışık', ['photo']),
];

export const SUFFIXES: MorphemeDef[] = [
  s('ness', '-ness', 'germanic', 'state or quality (makes nouns)', 'durum, nitelik: sıfattan isim yapar (-lık)', ['ness']),
  s('ity', '-ity', 'latin', 'state or quality (makes nouns)', 'durum, nitelik: sıfattan isim yapar (-lık)', ['ity', 'ty', 'ality']),
  s('tion', '-tion', 'latin', 'act or result (makes nouns; also -sion, -ation)', 'eylem ya da sonucu: fiilden isim yapar (-ma, -ış)', ['ion', 'tion', 'ation', 'ition', 'sion', 'ication']),
  s('ment', '-ment', 'latin', 'act or result (makes nouns)', 'eylem ya da sonucu: fiilden isim yapar (-ma, -ım)', ['ment']),
  s('er', '-er', 'germanic', 'person or thing that does (also -or)', 'yapan kişi ya da şey (-cı)', ['er', 'or', 'ier', 'yer']),
  s('ist', '-ist', 'greek', 'person who practises or believes', 'uğraşan ya da benimseyen kişi (-cı)', ['ist']),
  s('ism', '-ism', 'greek', 'belief, system, practice', 'akım, görüş, sistem (-cılık)', ['ism']),
  s('able', '-able', 'latin', 'can be done (also -ible)', '-ebilir, -ilebilir', ['able', 'ible']),
  s('ful', '-ful', 'germanic', 'full of, having', 'dolu, -lı', ['ful']),
  s('less', '-less', 'germanic', 'without', '-sız', ['less']),
  s('ous', '-ous', 'latin', 'having the quality of (makes adjectives)', 'niteliğinde, -lı (sıfat yapar)', ['ous', 'ious', 'eous']),
  s('ive', '-ive', 'latin', 'tending to (makes adjectives)', 'eğiliminde olan, -ıcı (sıfat yapar)', ['ive', 'ative', 'itive']),
  s('al', '-al', 'latin', 'relating to (makes adjectives)', 'ile ilgili, -sal (sıfat yapar)', ['al', 'ial', 'ical', 'ual']),
  s('ic', '-ic', 'greek', 'relating to (makes adjectives)', 'ile ilgili, -sal (sıfat yapar)', ['ic', 'tic', 'atic', 'etic', 'istic']),
  s('ly', '-ly', 'germanic', 'in a … way (makes adverbs)', 'biçimde, -ca (zarf yapar)', ['ly', 'ally']),
  s('ize', '-ize', 'greek', 'make, become (also -ise)', 'yapmak, hâline getirmek (-laştırmak)', ['ize', 'ise']),
  s('ify', '-ify', 'latin', 'make, cause to be', 'yapmak, hâline getirmek (-laştırmak)', ['ify', 'fy']),
  s('en', '-en', 'germanic', 'make, become (makes verbs)', 'yapmak, olmak (-laştırmak)', ['en'], { onlyTargetPos: ['V'], onlySourcePos: ['J', 'N'] }),
  s('ence', '-ence', 'latin', 'state or quality (also -ance)', 'durum, nitelik (-lık)', ['ence', 'ance', 'ency', 'ancy', 'cy']),
  s('ent', '-ent', 'latin', 'doing; person who does (also -ant)', 'yapan; -an, -en', ['ent', 'ant']),
  s('ship', '-ship', 'germanic', 'state, position, skill', 'durum, konum, beceri (-lık)', ['ship']),
  s('hood', '-hood', 'germanic', 'state or time of being', 'durum, dönem (-lık)', ['hood']),
  s('dom', '-dom', 'germanic', 'state; realm', 'durum; alan, ülke (-lık)', ['dom']),
  s('age', '-age', 'french', 'action, result, collection', 'eylem, sonuç, toplam', ['age']),
  s('ee', '-ee', 'french', 'person to whom something is done', 'kendisine bir şey yapılan kişi', ['ee']),
  s('ess', '-ess', 'french', 'female (older usage)', 'dişi, kadın (eski kullanım)', ['ess']),
  s('ish', '-ish', 'germanic', 'somewhat; like', 'biraz, -imsi; gibi', ['ish']),
  s('y', '-y', 'germanic', 'full of, like (makes adjectives)', 'dolu, -lı (sıfat yapar)', ['y'], { onlyTargetPos: ['J'] }),
  s('ward', '-ward', 'germanic', 'in the direction of (also -wards)', 'yönünde, -e doğru', ['ward', 'wards']),
  s('wise', '-wise', 'germanic', 'in the manner of; regarding', 'biçiminde; bakımından', ['wise']),
  s('some', '-some', 'germanic', 'tending to, causing', 'eğiliminde, -ıcı', ['some']),
  s('ary', '-ary', 'latin', 'relating to; place (also -ory)', 'ile ilgili; yer', ['ary', 'ory', 'atory']),
  s('ure', '-ure', 'latin', 'act, result', 'eylem, sonuç', ['ure']),
  s('ery', '-ery', 'french', 'place, practice, collection (also -ry)', 'yer, uğraş, toplam', ['ery', 'ry']),
  s('logy', '-logy', 'greek', 'study of (also -ology)', 'bilimi, -bilim', ['logy', 'ology']),
  s('ian', '-ian', 'latin', 'person of, relating to (also -an)', 'ile ilgili kişi, -lı', ['ian', 'an', 'arian']),
  s('ate', '-ate', 'latin', 'make, act (makes verbs)', 'yapmak (fiil yapar)', ['ate']),
  s('th', '-th', 'germanic', 'state, measure (makes nouns)', 'durum, ölçü (isim yapar)', ['th']),
  s('ling', '-ling', 'germanic', 'small or young one', 'küçük, yavru', ['ling']),
  s('ster', '-ster', 'germanic', 'person who does', 'yapan kişi', ['ster']),
  s('itude', '-itude', 'latin', 'state, quality', 'durum, nitelik', ['itude']),
  s('ics', '-ics', 'greek', 'science, practice', 'bilim, uğraş', ['ics']),
];

/*
 * Latin and Greek roots. `evidence` is matched against whole tokens of the etymology text
 * (diacritics removed, cognates cut off: see rootEvidenceTokens in build.ts), so
 * "furthermore" does not count as evidence for -therm- and "miss" (cognate with Latin
 * mittere) is not a -mit- word.
 */
export const ROOTS: MorphemeDef[] = [
  r('spect', '-spect-', 'latin', 'look, see', 'bakmak, görmek', /spect|spic/, /\w*spec(io|ere|to|tare|tus|tum|tio|ulum|tator|taculum|ulor|ulari)|\w*spic(io|ere|uus)|\w+spect(us|um|io|are|o|ivus)/),
  r('struct', '-struct-', 'latin', 'build, pile up', 'inşa etmek, yığmak', /stru(ct|ment)/, /\w*stru(o|ere|ctus|ctum|ctura|ctio|mentum)/),
  r('port', '-port-', 'latin', 'carry', 'taşımak', /port/, /\w*port(o|are|atus|abilis|atio)/),
  r('dict', '-dict-', 'latin', 'say, tell', 'söylemek', /(?<!me|ra|ju)dic/, /\w*dic(o|ere|tus|tum|tio|tare|tator|are|atio)/),
  r('ject', '-ject-', 'latin', 'throw', 'atmak, fırlatmak', /ject/, /\w*(iac|ic|iec|jac|jec)(io|ere|tus|tum|to|tare|tivus)/),
  r('duc', '-duc-', 'latin', 'lead', 'götürmek, yönetmek', /duc/, /\w*duc(o|ere|tus|tum|tio|ator|atio)/),
  r('mit', '-mit-, -miss-', 'latin', 'send, let go', 'göndermek, salmak', /mit|miss/, /\w*mitt(o|ere)|\w*miss(us|um|io|ilis|arius)/, ['amit', 'missy', 'miss']),
  r('vert', '-vert-, -vers-', 'latin', 'turn', 'döndürmek, çevirmek', /vert|vers/, /\w*vert(o|ere)|\w*vers(us|um|io|are|ari|itas|alis)/),
  r('scrib', '-scrib-, -script-', 'latin', 'write', 'yazmak', /scrib|script/, /\w*scrib(o|ere|a)|\w*script(us|um|io|ura|or)/),
  r('rupt', '-rupt-', 'latin', 'break', 'kırmak, koparmak', /rupt/, /\w*rump(o|ere)|\w*rupt(us|um|io|ura)/),
  r('tract', '-tract-', 'latin', 'pull, draw', 'çekmek', /tract/, /\w*trah(o|ere)|\w*tract(us|um|io|are|o|or)/),
  r('fer', '-fer-', 'latin', 'carry, bear', 'taşımak, getirmek', /fer/, /\w+fer(o|re|ens|entia)|fero|ferre/),
  r('cept', '-cept-, -ceive-', 'latin', 'take, seize', 'almak, tutmak', /cept|ceiv|cip/, /\w*(cap|cip)(io|ere)|\w*cept(us|um|io|or|are|o|ivus)|\w+cipium|\w+cipalis/),
  r('ven', '-ven-, -vent-', 'latin', 'come', 'gelmek', /ven/, /\w*ven(io|ire|tus|tum|tio|tura|ientia|iens)/),
  r('vis', '-vid-, -vis-', 'latin', 'see', 'görmek', /vid|vis|view/, /\w*vid(eo|ere|ens|entia)|\w*vis(us|um|io|ere|ito|itare|ibilis|or|ualis)/),
  r('aud', '-aud-', 'latin', 'hear', 'duymak, işitmek', /aud/, /aud(io|ire|itus|itor|itio|ientia|ibilis|itorium)/),
  r('pend', '-pend-, -pens-', 'latin', 'hang; weigh, pay', 'asmak; tartmak, ödemek', /pend|pens/, /\w*pend(o|eo|ere|ium)|\w*pens(us|um|are|io|a)/),
  r('press', '-press-', 'latin', 'press, push', 'bastırmak, sıkmak', /press/, /\w*prim(o|ere)|\w*press(us|um|io|are|ura|o)/),
  r('pos', '-pos-, -pon-', 'latin', 'put, place', 'koymak, yerleştirmek', /pos|pon/, /\w*pon(o|ere|ens|entem)|\w*posit(us|um|io|ivus|ura)/),
  r('tend', '-tend-, -tens-', 'latin', 'stretch, aim', 'germek, yönelmek', /tend|tens|tent/, /\w*tend(o|ere)|\w*tens(us|um|io|ivus)|\w*tent(us|um|io)/, ['tender', 'tenderness', 'tenderly']),
  r('fac', '-fac-, -fect-', 'latin', 'make, do', 'yapmak', /fac|fect|fic|feat/, /\w*(fac|fic)(io|ere|tum|tus|ilis|ultas|ium|ina|tio|tor)|\w*fect(us|um|io|ivus|or)|\w+ficus|\w+ficare|\w+ficatio/),
  r('form', '-form-', 'latin', 'shape', 'biçim', /form/, /forma|formare|formo|formatio|\w+formare|\w+formo|\w+formatio|formula/, ['former', 'formerly']),
  r('cred', '-cred-', 'latin', 'believe, trust', 'inanmak, güvenmek', /cred/, /cred(o|ere|itus|itum|ibilis|ulus|entia|itor)/),
  r('cur', '-cur-, -curs-', 'latin', 'run', 'koşmak', /cur/, /\w*curr(o|ere|ens|entem|iculum|ency)|\w*curs(us|um|io|or)/),
  r('graph', '-graph-', 'greek', 'write, draw', 'yazmak, çizmek', /graph|gram/, /grapho|graphein|graphe|graphia|graphos|graphikos|gramma|grammatikos|\w+graphia|\w+graphos/),
  r('log', '-log-', 'greek', 'word, reason, study', 'söz, akıl, bilim', /log/, /logos|logia|logikos|\w+logia|\w+logos|\w+logikos/),
  r('phon', '-phon-', 'greek', 'sound, voice', 'ses', /phon/, /phone|phonos|phonikos|phonetikos|\w+phonos|\w+phonia|\w+phone/),
  r('chron', '-chron-', 'greek', 'time', 'zaman', /chron/, /chronos|khronos|chronikos|khronikos|\w+chronos|\w+khronos|\w+chronia/),
  r('therm', '-therm-', 'greek', 'heat', 'ısı', /therm/, /thermos|therme|thermo|thermotes|\w+thermia/),
  r('meter', '-meter-, -metr-', 'greek', 'measure', 'ölçmek, ölçü', /met(er|r)/, /metron|metrikos|\w+metron|\w+metria|\w+metros/),
  r('mot', '-mot-, -mov-', 'latin', 'move', 'hareket ettirmek', /mot|mov|mob/, /\w*mov(eo|ere)|\w*mot(us|um|io|or|ivus)|mobilis/),
  r('sens', '-sens-, -sent-', 'latin', 'feel, perceive', 'hissetmek, algılamak', /sens|sent/, /\w*sent(io|ire|entia)|\w*sens(us|um|ibilis|atio|or|ualis)/),
  r('voc', '-voc-, -vok-', 'latin', 'call, voice', 'çağırmak, ses', /voc|vok|voic/, /\w*voc(o|are|atio|abulum|alis|atus)|vox|vocis|vocem/),
  r('cede', '-cede-, -cess-', 'latin', 'go, yield', 'gitmek, ilerlemek; bırakmak', /ced|ceed|cess/, /\w*ced(o|ere|ens)|\w*cess(us|um|io|or|are|arius)/),
  r('gress', '-gress-, -grad-', 'latin', 'step, go', 'adım atmak, ilerlemek', /gress|grad/, /\w*gred(ior|i)|\w*gress(us|um|io|or)|grad(us|ior|ualis|atim)|\w+gradare/),
  r('sist', '-sist-, -stat-', 'latin', 'stand', 'durmak, ayakta durmak', /sist|stat|stit/, /\w+sist(o|ere|entia)|stat(us|io|uo|uere|ura|um)|\w+stitu(o|ere|tus|tio|tum)/, ['prostate']),
  r('sequ', '-sequ-, -secu-', 'latin', 'follow', 'izlemek, takip etmek', /sequ|secu/, /\w*sequ(or|i|ens|entia|ela|entem)|\w*secut(us|io|or|ivus)/),
  r('spir', '-spir-', 'latin', 'breathe', 'nefes almak', /spir/, /\w*spir(o|are|itus|atio|itualis)/),
  r('fin', '-fin-', 'latin', 'end, limit', 'son, sınır', /fin/, /fin(is|ire|io|alis|itus|antia)|\w+fin(io|ire|itus|itio)/),
  r('mort', '-mort-', 'latin', 'death', 'ölüm', /mort/, /mors|mortis|mortalis|mortuus|morior|\w+mortalis|\w+mortuus/),
  r('nat', '-nat-', 'latin', 'born', 'doğmak', /nation|nativ|natur|natal|nasc|innate/, /nasc(or|i|ens|entem)|nat(us|io|ionem|ura|ivus|alis|ionalis)/),
  r('loc', '-loc-', 'latin', 'place', 'yer', /loc/, /loc(us|alis|are|atio|o)|\w+loc(are|atio|o)/),
  r('lect', '-lect-, -leg-', 'latin', 'choose, gather; read', 'seçmek, toplamak; okumak', /lect|leg|lig/, /lego|legere|\w+legere|\w*lect(us|um|io|or|ura)|\w*lig(ere|ens|entia)/),
  r('clud', '-clud-, -clus-', 'latin', 'close, shut', 'kapamak', /clud|clus|clos/, /\w*clud(o|ere)|\w*clus(us|um|io|ivus)|claud(o|ere)/),
  r('flect', '-flect-, -flex-', 'latin', 'bend', 'bükmek', /flect|flex/, /\w*flect(o|ere)|\w*flex(us|um|io|ibilis)/),
  r('plic', '-plic-, -ply-', 'latin', 'fold', 'katlamak', /plic|ply|plex|ploy|ploit/, /\w*plic(o|are|atus|atio|itus|itum)|\w*plex(us|um)|\w+plica/),
  r('solv', '-solv-, -solu-', 'latin', 'loosen', 'çözmek, gevşetmek', /solv|solu/, /\w*solv(o|ere)|\w*solut(us|um|io)|solubilis/),
  r('sci', '-sci-', 'latin', 'know', 'bilmek', /sci/, /sci(o|re|ens|entia|entem)|\w+sci(o|re|ens|entia|us|entem)/),
  r('sign', '-sign-', 'latin', 'mark, sign', 'işaret', /sign/, /sign(um|are|ificare|ificatio|alis|atura)|\w+sign(are|atus|atio)/),
  r('simil', '-simil-, -simul-', 'latin', 'like, same', 'benzer, aynı', /simil|simul|sembl/, /simil(is|are|itudo)|simul(are|atio|atus)|\w+simil(is|are|atio)|\w+simul(are|atio)/),
  r('cogn', '-cogn-', 'latin', 'know, learn', 'bilmek, tanımak', /cogn|connoiss/, /\w*cogn(osco|oscere|itus|itio|itivus)/),
  r('corp', '-corp-', 'latin', 'body', 'beden, gövde', /corp/, /corp(us|oris|oralis|orare|oratio)|\w+corpor(are|atus|atio)/),
  r('hab', '-hab-, -hib-', 'latin', 'have, hold', 'sahip olmak, tutmak', /hab|hib/, /\w*hab(eo|ere|itus|itare|ilis|itatio)|\w*hib(eo|ere|itus|itio)/),
  r('mand', '-mand-', 'latin', 'order, entrust', 'emretmek, emanet etmek', /mand|mend/, /\w*mand(o|are|atum|atus)/),
  r('tain', '-tain-, -ten-', 'latin', 'hold, keep', 'tutmak', /tain|ten/, /\w*t[ei]n(eo|ere)/),
];

export const INVENTORY: MorphemeDef[] = [...PREFIXES, ...SUFFIXES, ...ROOTS];

/** MorphyNet morpheme string + type → inventory ids. */
export function morphynetIndex(defs: MorphemeDef[] = INVENTORY): Map<string, MorphemeDef> {
  const out = new Map<string, MorphemeDef>();
  for (const d of defs) {
    if (d.kind === 'root') continue;
    for (const m of d.morphynet ?? []) {
      const key = `${d.kind}:${m}`;
      if (out.has(key)) throw new Error(`duplicate MorphyNet alias ${key}`);
      out.set(key, d);
    }
  }
  return out;
}
