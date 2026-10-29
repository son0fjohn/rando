// Notes, the text filter (pure: no DOM, so node specs and the SQL test share
// its word lists). It runs on the phone as you type (immediate feedback) and
// again in SQL (migrations/019_notes.sql note_text_problem: the authority for
// phone numbers, emails and slurs; its slur rows must match SLUR_WORDS /
// SLUR_STEMS, test/notes_sql.mjs checks).
//
//   checkNote("call me 010-1234-5678")  -> { ok: false, why: "phone" }
//   checkNote("nice view", { allow: ["Lotte World Tower"] }) -> { ok: true, why: null }
//
// what it blocks (EN + KO):
//   phone    9+ digits in a run, separators allowed (010-1234-5678, +82 10 …)
//   email    name@host.tld, also "name (at) host (dot) com"
//   slur     bigoted slurs: whole words (plurals too) and, for the unmistakable
//            ones, inside squashed text ("n i g g e r", "짱 깨"); leetspeak
//            (0→o, 1→i, 3→e, 4→a, 5→s, 7→t, @→a, $→s, !→i) and zero-width
//            tricks undone first
//   name     a full name: a common first name + a capitalised word ("Jake
//            Miller"), Mr / Ms / Dr + a name, a Korean surname + given name
//            with a title or honorific (김민수씨, 박지영 대리)
//   company  well-known companies (Samsung, 카카오 …) and Inc / Ltd / 주식회사
//   (the phone only: name and company; the server checks the rest again)

export const TEXT_MAX = 200;

// ---- normalising (the SQL does exactly the same steps)
const ZW = /[\u00AD\u200B-\u200F\u2060\uFEFF]/g;
export const LEET_FROM = "013457@$!", LEET_TO = "oieastasi";
const lowerAscii = s => s.replace(/[A-Z]/g, c => c.toLowerCase());
// NFKC (full-width letters and digits, ㈜ -> (주)), no zero-width, ASCII lower case
export const base = s => lowerAscii(String(s ?? "").normalize("NFKC").replace(ZW, ""));
const leet = s => { let o = ""; for (const c of s) { const i = LEET_FROM.indexOf(c); o += i < 0 ? c : LEET_TO[i]; } return o; };
const NONLETTER = /[^a-z가-힣ㄱ-ㅎㅏ-ㅣ]+/g;
const runs = s => s.replace(/(.)\1{2,}/g, "$1$1");           // "niggggger" -> "nigger"
export const tokens = s => runs(leet(base(s))).split(NONLETTER).filter(Boolean);
export const squash = s => runs(leet(base(s)).replace(NONLETTER, ""));

// ---- slurs. Words match whole tokens (and their plural); stems match inside
// the squashed text, so only unmistakable ones are stems.
export const SLUR_WORDS = [
  // en
  "fag", "faggot", "dyke", "tranny", "shemale", "retard", "spic", "spick", "kike", "chink", "gook", "wetback",
  "coon", "raghead", "towelhead", "beaner", "paki", "nigga", "nigger", "jap", "gypo", "gyppo",
  // ko
  "짱깨", "짱개", "쪽바리", "쪽발이", "조센징", "깜둥이", "흑형", "똥남아", "틀딱", "한남충", "김치녀", "된장녀",
  "맘충", "똥꼬충", "병신", "정신병자", "니거",
];
export const SLUR_STEMS = [
  "nigger", "nigga", "faggot", "tranny", "towelhead", "raghead", "wetback", "shemale",
  "짱깨", "짱개", "쪽바리", "쪽발이", "조센징", "깜둥이", "흑형", "똥남아", "틀딱", "한남충", "김치녀", "된장녀", "똥꼬충", "병신",
];

// ---- phone numbers and emails (on the NFKC'd text, before leetspeak). The
// SQL's regexes are the same patterns in Postgres syntax.
export const PHONE_RE = /[0-9](?:[\s.()+\/-]{0,2}[0-9]){8,}/;
export const EMAIL_RE = /[a-z0-9._%+-]+\s?(?:@|\(at\)|\[at\])\s?[a-z0-9-]+(?:\s?(?:\.|\(dot\)|\[dot\])\s?[a-z0-9-]+)+/;

// ---- names (the phone only)
export const FIRST_NAMES = [
  "james", "john", "robert", "michael", "william", "david", "richard", "joseph", "thomas", "charles", "chris", "christopher", "daniel",
  "matthew", "anthony", "mark", "donald", "steven", "paul", "andrew", "josh", "joshua", "kevin", "brian", "george", "edward", "ryan",
  "jason", "jacob", "gary", "eric", "jonathan", "stephen", "larry", "justin", "scott", "brandon", "ben", "benjamin", "sam", "samuel",
  "frank", "greg", "alex", "alexander", "patrick", "jack", "dennis", "jerry", "tyler", "aaron", "jose", "adam", "nathan", "henry",
  "zach", "peter", "kyle", "noah", "ethan", "jake", "mike", "tom", "dan", "nick", "luke", "sean", "liam", "mason", "logan", "lucas",
  "mary", "patricia", "jennifer", "linda", "elizabeth", "barbara", "susan", "jessica", "sarah", "karen", "lisa", "nancy", "betty",
  "sandra", "margaret", "ashley", "kimberly", "emily", "donna", "michelle", "carol", "amanda", "melissa", "deborah", "stephanie",
  "rebecca", "laura", "sharon", "cynthia", "kathleen", "amy", "angela", "anna", "emma", "olivia", "sophia", "ava", "mia", "isabella",
  "chloe", "grace", "hannah", "rachel", "megan", "lauren", "katie", "kate", "julia", "nicole", "samantha", "victoria", "natalie",
  "minjun", "seojun", "jiho", "jiwoo", "minseo", "seoyeon", "jiyeon", "minji", "jisoo", "jimin", "jihoon", "hyunwoo", "sungmin",
  "yuna", "soyeon", "hayoon", "jieun", "taeyang", "dongha", "junho", "jaehyun", "eunji", "sora", "kenji", "yuki", "haruto", "sakura",
];
const TITLES_EN = /\b(?:mr|mrs|ms|miss|dr|prof)\.?\s+[A-Z][a-z]{2,}/i;
export const KO_SURNAMES = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신", "권", "황", "안", "송", "류", "전",
  "홍", "고", "문", "양", "손", "배", "백", "허", "유", "남", "심", "노", "하", "곽", "성", "차", "주", "우", "구", "민", "진", "나", "지", "엄",
  "채", "원", "천", "방", "공", "현", "함", "변", "염", "여", "추", "도", "소", "석", "선", "설", "마", "길", "연", "위", "표", "명", "기", "반",
  "왕", "금", "옥", "육", "인", "맹", "제", "모", "탁", "국", "어", "은", "편", "용", "예", "봉", "경", "사", "부", "남궁", "제갈", "선우", "독고", "황보"];
// 씨 / 님 written onto the name (김민수씨), a job title with or without a space (박지영 대리)
export const KO_TITLES = ["씨", "님"], KO_JOBS = ["선생님", "대리", "과장", "차장", "부장", "팀장", "사장", "실장", "교수"];
const alt = a => [...a].sort((x, y) => y.length - x.length).join("|");
const KO_NAME = new RegExp(`(?:^|[^가-힣])(?:${alt(KO_SURNAMES)})[가-힣]{2}(?:(?:${alt(KO_TITLES)})|\\s?(?:${alt(KO_JOBS)}))(?![가-힣])`);

// ---- companies (the phone only)
export const COMPANIES = [
  "samsung", "삼성", "hyundai", "현대자동차", "lg전자", "lg electronics", "sk hynix", "sk텔레콤", "kakao", "카카오", "naver", "네이버",
  "coupang", "쿠팡", "baemin", "배달의민족", "toss", "토스", "hanwha", "한화", "posco", "포스코", "lotte", "롯데", "shinsegae", "신세계",
  "google", "구글", "microsoft", "마이크로소프트", "amazon", "아마존", "facebook", "페이스북", "instagram", "인스타그램", "tesla", "테슬라",
  "netflix", "넷플릭스", "starbucks", "스타벅스", "mcdonalds", "맥도날드", "nike", "나이키", "uber", "openai", "tiktok", "틱톡",
];
const CORP_RE = /\b[a-z][\w&'-]*\s+(?:inc|corp|corporation|ltd|llc|gmbh|co\.\s?ltd)\b|주식회사|\(주\)|유한회사/i;

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasPhrase = (text, phrase) => {
  // a whole word / phrase for Latin names; anywhere for Korean ones (no spaces in compounds)
  if (/^[가-힣]/.test(phrase)) return text.includes(phrase);
  return new RegExp(`(?:^|[^a-z0-9])${escRe(phrase)}(?:'?s)?(?![a-z0-9])`).test(text);
};

// what the server checks too (phone, email, slurs)
export function serverProblem(text) {
  const b = base(text);
  if (PHONE_RE.test(b)) return "phone";
  if (EMAIL_RE.test(b)) return "email";
  const tk = tokens(text);
  const words = new Set(SLUR_WORDS);
  if (tk.some(t => words.has(t) || (t.endsWith("s") && words.has(t.slice(0, -1))) || (t.endsWith("es") && words.has(t.slice(0, -2))))) return "slur";
  const sq = squash(text);
  if (SLUR_STEMS.some(s => sq.includes(s))) return "slur";
  return null;
}

// the whole check, on the phone. opts.allow: names that are fine here (the
// spot's own name: "Lotte World Tower" at Lotte World Tower)
export function checkNote(text, { allow = [], max = TEXT_MAX, required = true } = {}) {
  const raw = String(text ?? "");
  if (!raw.trim()) return { ok: !required, why: required ? "empty" : null };
  if ([...raw].length > max) return { ok: false, why: "long" };
  const s = serverProblem(raw);
  if (s) return { ok: false, why: s };
  let b = base(raw);
  for (const a of allow) if (a) b = b.split(base(a)).join(" ");
  let orig = raw.normalize("NFKC");
  for (const a of allow) if (a) orig = orig.split(a).join(" ");
  // names: "Jake Miller", "Dr. Kim", "김민수씨"
  const firsts = new Set(FIRST_NAMES);
  for (const m of orig.matchAll(/\b([A-Z][a-z]+)\s+([A-Z][a-z]{1,})\b/g)) if (firsts.has(m[1].toLowerCase())) return { ok: false, why: "name" };
  if (TITLES_EN.test(orig) || KO_NAME.test(orig)) return { ok: false, why: "name" };
  if (COMPANIES.some(c => hasPhrase(b, c)) || CORP_RE.test(orig)) return { ok: false, why: "company" };
  return { ok: true, why: null };
}
