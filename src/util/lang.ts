// What people say to agents, beyond English: redirects, approvals, manners, swears, slurs,
// filler words and what they asked for, in Spanish, Portuguese, French, German, Italian,
// Russian, Chinese, Japanese and Korean. Rules stay rules: transparent word lists, never
// a model. Latin and Cyrillic words use Unicode-aware word edges; CJK has no spaces, so its
// phrases match anywhere in the message.

/** A word list as a regex with Unicode word edges (JS's \b only knows ASCII). */
const words = (list: string[], flags = 'iu') => new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.join('|')})(?![\\p{L}\\p{N}])`, flags)
const starts = (list: string[]) => new RegExp(`^(?:${list.join('|')})(?![\\p{L}\\p{N}])`, 'iu')
/** Word stems: Latin and Cyrillic ones must start a word ("crea" in "crear", not "increase"); CJK can't. */
const anywhere = (list: string[]) => new RegExp(list.map((w) => (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(w) ? w : `(?<![\\p{L}])${w}`)).join('|'), 'iu')

/** Opens with a redirect: "no, …", "espera", "toujours pas", "不对". */
export const STEER_START_X = starts([
  // es
  'no', 'nop', 'espera', 'detente', 'mal', 'eso no', 'todav[ií]a no', 'sigue sin', 'otra vez', 'revierte', 'deshaz', 'en realidad', 'mejor no', 'por qu[eé] (?:hiciste|cambiaste|borraste)',
  // pt
  'n[aã]o', 'pera', 'pare', 'errado', 'ainda n[aã]o', 'continua sem', 'de novo', 'reverte', 'desfaz', 'na verdade', 'por que (?:voc[eê]|vc) (?:fez|mudou|apagou)',
  // fr
  'non', 'attends', 'arr[eê]te', 'faux', 'toujours pas', 'encore une erreur', 'annule', 'en fait', 'pourquoi (?:tu as|as-tu)',
  // de
  'nein', 'warte', 'stopp', 'halt', 'falsch', 'immer noch', 'schon wieder', 'mach das r[uü]ckg[aä]ngig', 'eigentlich', 'warum hast du',
  // it
  'aspetta', 'fermati', 'sbagliato', 'ancora non', 'di nuovo', 'annulla', 'in realt[aà]', 'perch[eé] hai',
  // ru
  'нет', 'стоп', 'подожди', 'неправильно', 'вс[её] ещ[её]', 'опять', 'снова', 'откати', 'верни', 'зачем ты',
])
export const STEER_START_CJK = /^(?:不对|不是|错了|停|等等|等一下|还是不行|又|撤销|回滚|为什么你|别|いや|違う|ちがう|待って|止めて|やめて|まだ|また(?:エラー|動かない)|戻して|元に戻|なんで|아니|아냐|잠깐|멈춰|틀렸|아직도|되돌려|왜)/u

/** A correction anywhere: "no funciona", "tu as cassé", "不是我要的". */
export const STEER_ANY_X = words([
  'no funciona', 'sigue sin funcionar', 'rompiste', 'se rompi[oó]', 'eso no es lo que', 'te dije', 'no toques', 'demasiado complejo',
  'n[aã]o funciona', 'continua quebrado', 'quebrou', 'n[aã]o [eé] isso', 'eu disse', 'n[aã]o mexe',
  '(?:ne )?(?:marche|fonctionne) (?:pas|toujours pas)', 'tu as cass[eé]', "c'est cass[eé]", "ce n'est pas ce que", "je t'ai dit",
  'funktioniert (?:immer noch )?nicht', 'geht nicht', 'kaputt', 'das ist nicht', 'ich habe gesagt',
  'non funziona', 'hai rotto', '[eè] rotto', "non [eè] quello che", 'ti ho detto',
  'не работает', 'сломал\\p{L}*', 'это не то', 'я же сказал',
])
export const STEER_ANY_CJK = /不行|没用|报错|坏了|不是我要的|我说了|動かない|壊れ|そうじゃない|言ったでしょ|안 돼|안돼|작동 안|깨졌|그게 아니/u

/** A short approval: "dale", "beleza", "继续", "続けて". */
export const APPROVE_X = starts([
  's[ií]', 'vale', 'dale', 'perfecto', 'genial', 'contin[uú]a', 'sigue', 'adelante', 'hazlo', 'gracias', 'de acuerdo', 'listo', 'bien',
  'sim', 'beleza', 'blz', 'valeu', 'perfeito', '[oó]timo', 'segue', 'pode', 'manda ver', 'obrigad[oa]', 'isso',
  'oui', 'ouais', "d'accord", 'parfait', 'super', 'continue', 'vas-y', 'merci', 'nickel', 'top',
  'ja', 'jo', 'passt', 'perfekt', 'weiter', 'mach weiter', 'danke', 'genau', 'klingt gut',
  'va bene', 'perfetto', 'ottimo', 'vai', 'procedi', 'grazie', 'esatto',
  'да', 'ок', 'хорошо', 'отлично', 'продолжай', 'давай', 'спасибо', 'супер', 'норм',
])
const OK_CJK = '(?:好的?|好吧|可以|继续|行|没问题|谢谢|对的?|完美|はい|いいね|いいよ|続けて|お願いします?|ありがとう(?:ございます)?|完璧|オッケー|네|응|좋아요?|계속(?:해)?|고마워|감사합니다|완벽|오케이)'
/** "继续", "请继续", "好的，继续": a polite prefix and a couple of okays chained. */
export const APPROVE_CJK = new RegExp(`^(?:请)?${OK_CJK}(?:[，,、\\s]*${OK_CJK}){0,2}[\\s。！!.~]*$`, 'u')
/** Words that make a short "ok …" an instruction rather than an approval. */
export const CONTINUES_X = words(['pero', 'tambi[eé]n', 'ahora', 'mas', 'tamb[eé]m', 'agora', 'mais', 'aussi', 'maintenant', 'aber', 'auch', 'jetzt', 'ma', 'anche', 'ora', 'но', 'также', 'теперь'])

export const PLEASE = /\bplease\b|\bpls\b|\bplz\b|por favor|s'il (?:te|vous) pla[iî]t|\bstp\b|\bsvp\b|\bbitte\b|per favore|пожалуйста|请|お願い|부탁/iu
export const THANKS = /\bthank(?:s| you)\b|\bthx\b|\bty\b|gracias|obrigad[oa]|valeu|\bmerci\b|\bdanke\b|grazie|спасибо|谢谢|ありがとう|감사|고마워/iu

/** Swears beyond English, grouped under one display word each. Slurs are never here. */
export const SWEARS_X: { word: string; re: RegExp }[] = [
  { word: 'joder', re: /(?<![\p{L}])(?:joder|jodido|jodida)(?![\p{L}])/giu },
  { word: 'mierda', re: /(?<![\p{L}])mierda(?![\p{L}])/giu },
  { word: 'carajo', re: /(?<![\p{L}])(?:carajo|co[ñn]o|hostia)(?![\p{L}])/giu },
  { word: 'porra', re: /(?<![\p{L}])(?:porra|caralho|foda-se|merda)(?![\p{L}])/giu },
  { word: 'putain', re: /(?<![\p{L}])(?:putain|merde|bordel)(?![\p{L}])/giu },
  { word: 'scheiße', re: /(?<![\p{L}])(?:schei(?:ß|ss)e|verdammt|mist)(?![\p{L}])/giu },
  { word: 'cazzo', re: /(?<![\p{L}])(?:cazzo|vaffanculo|porca miseria)(?![\p{L}])/giu },
  { word: 'блять', re: /(?<![\p{L}])(?:бляд?ь|бля|пиздец|хрен)(?![\p{L}])/giu },
  { word: '卧槽', re: /卧槽|我靠|他妈的|妈的/gu },
  { word: 'くそ', re: /クソ|くそ|ちくしょう/gu },
  { word: '씨발', re: /씨발|시발|젠장/gu },
]

/** Slurs beyond English: never counted, quoted or shown. */
export const SLURS_X = words(['marica', 'maric[oó]n', 'sudaca', 'negrata', 'bicha', 'sapat[aã]o', 'p[eé]d[eé]', 'bougnoule', 'youpin', 'tapette', 'schwuchtel', 'kanake', 'neger', 'frocio', 'пидор\\p{L}*', 'чурк\\p{L}*', 'хач', 'жид\\p{L}*'])

/** Filler words in the languages above, left out of "your most used word". */
export const STOPWORDS_X = new Set(
  (
    // es
    'que de la el en y a los las del se por un una con no es para lo como más mas pero sus le ya o este si sí porque esta entre cuando muy sin sobre también me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mí antes algunos qué unos yo otro otras otra él tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros mi mis tú te ti tu tus haz hacer puedes quiero usa sea ser está están ' +
    // pt
    'de a o que e do da em um para é com não uma os no se na por mais as dos como mas foi ao ele das tem à seu sua ou ser quando muito há nos já está eu também só pelo pela até isso ela entre era depois sem mesmo aos ter seus quem nas me esse eles estão você vc essa num nem suas meu às minha têm numa pelos elas havia seja qual será nós tenho lhe deles essas esses pelas este fazer pode ' +
    // fr
    'le la les de des du un une et en à au aux ce ces dans par pour pas plus que qui sur se ne ou il elle on nous vous ils elles est sont été être avoir fait faire mais avec comme tout tous très bien je tu me te mon ma mes ton ta tes son sa ses leur leurs cette cet ça y si ' +
    // de
    'der die das und ist nicht ein eine einen dem den des zu mit sich auf für von im an es auch als wie bei noch nur so dass aus er sie wir ihr ich du mir dich mich dir uns euch sein seine kann wird wurde werden hat haben bitte mach mache diese dieser dieses oder aber wenn dann ' +
    // it
    'il lo la i gli le di da in con su per tra fra un uno una e che non è sono come ma anche più se ci si mi ti ne questo questa quello quella molto fare fai ho hai ha'
  ).split(' '),
)

/** What an opening prompt asks for, beyond English, by intent key. */
export const INTENTS_X: Record<string, RegExp> = {
  fix: anywhere(['arregl', 'corrig', 'consert', 'r[ée]par', 'behebe', 'reparier', 'correggi', 'sistema il', 'исправ', 'почини', '修复', '修正', '直して', '고쳐', 'fallo', 'falla', 'erro[r ]', 'erreur', 'fehler', 'errore', 'ошибк', '报错', '错误', 'エラー', '오류', 'no funciona', 'não funciona', 'ne marche pas', 'funktioniert nicht', 'non funziona', 'не работает']),
  review: anywhere(['revis[ae]', 'v[ée]rifi', 'überprüf', 'rivedi', 'провер', '审查', '检查', 'レビュー', '確認して', '검토']),
  explain: anywhere(['explica', 'expliqu', 'erklär', 'spiega', 'объясни', '解释', '为什么', '説明', 'なぜ', '설명', 'por qu[eé]', 'pourquoi', 'warum', 'perch[eé]', 'почему', 'c[oó]mo funciona', 'como funciona', 'comment (?:ça|ca) marche', 'wie funktioniert']),
  plan: anywhere(['planific', 'planej', 'planifi', 'pianific', 'спланир', '计划', '方案', '計画', '계획', 'estrategia', 'estratégia', 'stratégie', 'strategie']),
  design: anywhere(['diseñ', 'desenh', 'interfaz', 'conception', 'gestalt', '设计', '界面', 'デザイン', '画面', '디자인', '화면']),
  data: anywhere(['base de datos', 'banco de dados', 'base de données', 'datenbank', 'база данных', '数据库', 'データベース', '데이터베이스', 'tabla', 'tabela', 'tabelle']),
  refactor: anywhere(['refactoriz', 'refator', 'refactoris', 'refaktor', 'рефактор', '重构', 'リファクタ', '리팩']),
  ops: anywhere(['despliega', 'desplegar', 'déploie', 'déployer', 'bereitstell', 'развер', '部署', 'デプロイ', '배포']),
  test: anywhere(['pruebas', 'testes', 'тест', '测试', 'テスト', '테스트']),
  writing: anywhere(['escrib', 'escrev', '[ée]cri[st]', 'schreib', 'scriv', 'напиши', '写一', '書いて', '작성']),
  change: anywhere(['cambi', 'modific', 'mud[ae]', 'änder', 'измени', '修改', '変更', '바꿔', '변경', 'elimina', 'supprime', 'lösch', 'удали']),
  build: anywhere(['crea', 'constru', 'añad', 'agreg', 'cri[ae]', 'adicion', 'ajout', 'erstell', 'füg', 'aggiung', 'созда', 'добав', 'сделай', '添加', '创建', '新增', '做一个', '作って', '追加', '実装', '만들어', '추가', '구현']),
}

/** Han, Kana or Hangul: scripts written without spaces between words. */
export const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
