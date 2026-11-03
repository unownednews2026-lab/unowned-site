/* Shared accuracy checks for the automated desks (no AI): quotes, numbers and names in an item must appear in the
   source text it rests on, and long passages must not be copied word for word. */
/* Code checks that need no AI: quotes, numbers and names in an item must appear in the articles it cites.
   This catches the commonest model mistakes (a changed figure, a made-up quote, a name from nowhere). */
const MONTHS_DAYS = /^(january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i;
// Nationality and language words are written differently in a French, Italian or German article ("français", "italiano").
const DEMONYM = /^(French|German|Germans|Italian|Italians|Albanian|Albanians|Indian|Indians|Canadian|Canadians|Serbian|Serbians|Serb|Serbs|South|African|Africans|European|Europeans|English|Muslim|Muslims|Christian|Christians|Hindu|Hindus|Paris|Parisian|Federal|National|Minister|Ministry|President|Prime|Government|Parliament|Police|Interior|Education|University|Universities|Students|Union|Unions)$/;
const ALIASES = { Hesse: ["Hessen"], Cologne: ["Köln", "Koln"], Munich: ["München", "Munchen"], Nuremberg: ["Nürnberg", "Nurnberg"], Bavaria: ["Bayern"], Saxony: ["Sachsen"], Lower: ["Nieder"], Rome: ["Roma"], Milan: ["Milano"], Turin: ["Torino"], Florence: ["Firenze"], Naples: ["Napoli"], Venice: ["Venezia"], Genoa: ["Genova"], Padua: ["Padova"], Sicily: ["Sicilia"], Lombardy: ["Lombardia"], Tuscany: ["Toscana"], Marseille: ["Marseilles"], Lyon: ["Lyons"], Brittany: ["Bretagne"], Normandy: ["Normandie"], Belgrade: ["Beograd"], Durres: ["Durrës"], Vlore: ["Vlorë"] };
export function ungrounded(text, cited, extra = "") {
  const fold = (x) => String(x).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[’‘]/g, "'");
  const corpus = fold(cited.map((a) => `${a.title} ${a.text}`).join(" ") + " " + extra);
  const flat = corpus.replace(/[^a-z0-9]+/g, " ");
  const digits = corpus.replace(/(\d)[,\s.](?=\d{3}\b)/g, "$1");
  const bad = [];
  for (const q of String(text).match(/[“"]([^”"]{12,})[”"]/g) || []) {
    const words = fold(q).replace(/[^a-z0-9]+/g, " ").trim();
    if (words.split(" ").length >= 3 && !flat.includes(words)) bad.push(`quote not in the articles: ${q.slice(0, 60)}`);
  }
  for (const n of String(text).match(/\d[\d,.]*\d|\d+/g) || []) {
    const v = n.replace(/[,.](?=\d{3}\b)/g, "");
    if (v.length >= 2 && !digits.includes(v) && !digits.includes(n)) bad.push(`number not in the articles: ${n}`);
  }
  const sentences = String(text).split(/(?<=[.!?])\s+/);
  for (const sent of sentences) {
    const words = sent.split(/\s+/).slice(1);                      // skip the sentence's first word
    for (const w of words) {
      const t = w.replace(/^[^\p{L}]+|[^\p{L}'’-]+$/gu, "").replace(/['’]s$/, "");
      if (t.length < 4 || !/^\p{Lu}/u.test(t) || MONTHS_DAYS.test(t) || DEMONYM.test(t)) continue;
      // Articles in French, Italian or German spell some places differently ("Hessen" for Hesse): accept either form.
      const forms = [t, ...(ALIASES[t] || [])].map((x) => fold(x).replace(/[^a-z0-9]+/g, " ").trim());
      if (!forms.some((f) => flat.includes(f))) bad.push(`name not in the articles: ${t}`);
    }
  }
  // Copying: 15 or more words in a row taken straight from an article is not paraphrase (quotes excepted).
  const own = fold(String(text).replace(/[“"][^”"]*[”"]/g, " ")).replace(/[^a-z0-9]+/g, " ").trim().split(" ");
  for (let i = 0; i + 15 <= own.length; i++) if (flat.includes(" " + own.slice(i, i + 15).join(" ") + " ")) { bad.push("copies a long passage word for word"); break; }
  return [...new Set(bad)];
}

