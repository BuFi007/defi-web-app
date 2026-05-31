// Localize item-map.json into all app locales (es, pt, ja, ko, zh). Writes an
// `i18n` block per item: base myth stories get hand-authored name+desc per
// locale; trait descriptions are generated from per-category templates applied
// to the (English) item name. English stays the top-level default.
//
// Idempotent — re-run after editing translations. The generator preserves i18n.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../lib/kawaii/item-map.json");
const map = JSON.parse(readFileSync(OUT, "utf8"));
const LOCALES = ["es", "pt", "ja", "ko", "zh"];

// ── Base myth stories (name + desc) per locale ──────────────────────────────
const BASE = {
  "chupacabra.png": {
    es: { name: "Chupacabras", desc: "El 'chupa-cabras' aterrorizó Puerto Rico por primera vez en 1995, dejando al ganado seco de un día para otro. Los avistamientos se extendieron por toda América Latina —de México a Chile—, haciéndolo el monstruo más moderno del Nuevo Mundo." },
    pt: { name: "Chupa-cabra", desc: "O 'chupa-cabras' aterrorizou Porto Rico pela primeira vez em 1995, deixando o gado seco de um dia para o outro. Os relatos se espalharam pela América Latina — do México ao Chile — tornando-o o monstro mais moderno do Novo Mundo." },
    ja: { name: "チュパカブラ", desc: "「ヤギの血を吸う者」は1995年にプエルトリコを初めて恐怖に陥れ、一夜にして家畜の血を抜き取った。目撃はメキシコからチリまでラテンアメリカ中に広がり、新世界で最も現代的な怪物となった。" },
    ko: { name: "추파카브라", desc: "'염소의 피를 빠는 자'는 1995년 푸에르토리코를 처음 공포에 빠뜨렸고, 하룻밤 새 가축의 피를 말렸다. 목격담은 멕시코에서 칠레까지 라틴아메리카 전역으로 퍼져 신대륙에서 가장 현대적인 괴물이 되었다." },
    zh: { name: "卓柏卡布拉", desc: "这只“吸羊血者”于1995年首次在波多黎各作乱，一夜之间将牲畜吸干。目击事件传遍拉丁美洲——从墨西哥到智利——使它成为新世界最“现代”的怪物。" },
  },
  "curupira.png": {
    es: { name: "Curupira", desc: "Guardián de la Amazonía, el Curupira tiene cabello rojo llameante y pies al revés que hacen girar en círculos a los cazadores. Los pueblos tupí-guaraníes advierten desde hace siglos: daña el bosque y te perderá para siempre." },
    pt: { name: "Curupira", desc: "Guardião da Amazônia, o Curupira tem cabelo vermelho flamejante e pés virados para trás que fazem os caçadores andarem em círculos. Os povos tupi-guarani avisam há séculos: faça mal à floresta e ele te perderá para sempre." },
    ja: { name: "クルピラ", desc: "アマゾンの守護者クルピラは燃えるような赤い髪と後ろ向きの足を持ち、狩人を堂々巡りさせる。トゥピ・グアラニーの人々は何世紀も警告してきた——森を傷つければ、永遠に迷わされる。" },
    ko: { name: "쿠루피라", desc: "아마존의 수호자 쿠루피라는 불타는 붉은 머리와 뒤로 향한 발을 가져 사냥꾼을 제자리만 맴돌게 한다. 투피-과라니족은 수 세기 동안 경고해왔다 — 숲을 해치면 영원히 길을 잃게 하리라." },
    zh: { name: "库鲁皮拉", desc: "亚马逊的守护者库鲁皮拉有着火红的头发和倒长的双脚，让猎人原地打转。图皮-瓜拉尼人世代相传地警告：伤害森林，他便让你永远迷途。" },
  },
  "dokkaebi.png": {
    es: { name: "Dokkaebi", desc: "Duendes coreanos nacidos de objetos desechados, los Dokkaebi son espíritus traviesos que aman los juegos, la lucha y engañar a los avariciosos. Sus mazas mágicas conjuran lo que sea, pero si los provocas, lo lamentarás." },
    pt: { name: "Dokkaebi", desc: "Duendes coreanos nascidos de objetos descartados, os Dokkaebi são espíritos travessos que adoram jogos, luta e enganar os gananciosos. Suas clavas mágicas conjuram qualquer coisa — mas provoque um e você vai se arrepender." },
    ja: { name: "トッケビ", desc: "捨てられた物から生まれる韓国の妖怪トッケビは、遊びや相撲、欲深い者をだますのが大好きないたずら精霊。魔法の棍棒で何でも生み出すが、怒らせれば後悔するだろう。" },
    ko: { name: "도깨비", desc: "버려진 물건에서 태어난 한국의 도깨비는 놀이와 씨름, 욕심쟁이 골탕 먹이기를 즐기는 장난꾸러기 정령이다. 요술 방망이로 무엇이든 만들어내지만, 건드리면 후회하게 된다." },
    zh: { name: "도깨비(韩国鬼怪)", desc: "由废弃物所生的韩国鬼怪“도깨비”是顽皮的自然精灵，热爱游戏、摔跤和捉弄贪婪之人。它们的魔法棒能变出任何东西——但惹恼它，你定会后悔。" },
  },
  "drop_bear.png": {
    es: { name: "Drop Bear", desc: "El depredador más temible (y más ficticio) de Australia: un koala carnívoro que se deja caer de los eucaliptos sobre turistas desprevenidos. Los locales juran que un poco de Vegemite tras las orejas te mantiene a salvo." },
    pt: { name: "Drop Bear", desc: "O predador mais temível (e mais fictício) da Austrália: um coala carnívoro que se joga dos eucaliptos sobre turistas desavisados. Os locais juram que um pouco de Vegemite atrás das orelhas te mantém a salvo." },
    ja: { name: "ドロップ・ベア", desc: "オーストラリアで最も恐ろしい(そして最も架空の)捕食者——ユーカリの木から不意の観光客に飛び降りる肉食コアラ。地元民は耳の後ろにベジマイトを塗れば安全だと真顔で言う。" },
    ko: { name: "드롭 베어", desc: "호주에서 가장 무서운(그리고 가장 허구의) 포식자 — 유칼립투스 나무에서 방심한 관광객 위로 떨어지는 육식 코알라. 현지인들은 귀 뒤에 베지마이트를 바르면 안전하다고 우긴다." },
    zh: { name: "坠落熊", desc: "澳大利亚最可怕（也最虚构）的掠食者：一种从桉树上扑向毫无防备游客的食肉考拉。当地人信誓旦旦：在耳后抹点维吉麦就能保你平安。" },
  },
  "duende.png": {
    es: { name: "Duende", desc: "Un pequeño duende doméstico del folclore español y portugués que se cuela en las casas para ordenar, enredar o llevarse a los niños que se portan mal. La leyenda navegó a Latinoamérica y Filipinas, donde aún lo conocen en cada pueblo." },
    pt: { name: "Duende", desc: "Um pequeno duende doméstico do folclore espanhol e português que entra nas casas para arrumar, aprontar ou levar crianças malcriadas. A lenda navegou até a América Latina e as Filipinas, onde toda aldeia ainda o conhece." },
    ja: { name: "ドゥエンデ", desc: "スペインとポルトガルの伝承に登場する小さな家の妖精。家に忍び込んで片付けたり、いたずらしたり、行儀の悪い子をさらったりする。伝説は中南米やフィリピンへ渡り、今もどの村でも知られている。" },
    ko: { name: "두엔데", desc: "스페인과 포르투갈 전승에 나오는 작은 집 요정. 집에 몰래 들어와 정리하거나 장난치거나 말 안 듣는 아이를 데려간다. 전설은 라틴아메리카와 필리핀으로 건너가 지금도 마을마다 그를 안다." },
    zh: { name: "杜恩德", desc: "西班牙与葡萄牙传说中的小家精，会溜进屋里整理、捣乱，或抓走顽皮的孩子。这个传说漂洋过海传到拉丁美洲和菲律宾，至今村村皆知。" },
  },
  "frankenstein.png": {
    es: { name: "El monstruo de Frankenstein", desc: "Cosido y reanimado a la vida en la novela de Mary Shelley de 1818, la Criatura es la primera advertencia de la ciencia: nacida cerca de Ginebra en la historia, pero un monstruo literario enteramente británico." },
    pt: { name: "O monstro de Frankenstein", desc: "Costurado e trazido à vida no romance de Mary Shelley de 1818, a Criatura é a primeira lição da ciência: nascido perto de Genebra na história, mas um monstro literário inteiramente britânico." },
    ja: { name: "フランケンシュタインの怪物", desc: "1818年のメアリー・シェリーの小説で縫い合わされ、命を吹き込まれた怪物は、科学への最初の警告。物語ではジュネーヴ近郊で生まれたが、まぎれもなくイギリス文学の怪物である。" },
    ko: { name: "프랑켄슈타인의 괴물", desc: "1818년 메리 셸리의 소설에서 꿰매어져 생명을 얻은 그 괴물은 과학에 대한 최초의 경고다. 이야기 속에서는 제네바 근처에서 태어났지만, 온전히 영국 문학의 괴물이다." },
    zh: { name: "弗兰肯斯坦的怪物", desc: "在玛丽·雪莱1818年的小说中被缝合并电击复活，这个“造物”是科学的第一则警世寓言——故事里诞生于日内瓦附近，却是地道的英国文学怪物。" },
  },
  "goblin.png": {
    es: { name: "Goblin", desc: "Pequeños embaucadores codiciosos y grotescos del folclore medieval europeo, los goblins acechan cuevas, minas y encrucijadas. Cada cultura, de Inglaterra a la Selva Negra, tiene el suyo." },
    pt: { name: "Goblin", desc: "Pequenos trapaceiros gananciosos e grotescos do folclore medieval europeu, os goblins assombram cavernas, minas e encruzilhadas. Cada cultura, da Inglaterra à Floresta Negra, tem o seu." },
    ja: { name: "ゴブリン", desc: "中世ヨーロッパの民間伝承に登場する強欲で醜い小さないたずら者。洞窟や鉱山、辻に潜む。イングランドから黒い森まで、どの文化にも独自のゴブリンがいる。" },
    ko: { name: "고블린", desc: "중세 유럽 전승의 탐욕스럽고 흉측한 작은 장난꾼. 동굴과 광산, 갈림길에 도사린다. 잉글랜드부터 검은 숲까지 모든 문화에 저마다의 고블린이 있다." },
    zh: { name: "哥布林", desc: "源自中世纪欧洲传说的贪婪丑陋的小恶作剧者，哥布林出没于洞穴、矿井与十字路口。从英格兰到黑森林，每种文化都有自己的哥布林。" },
  },
  "kitsune.png": {
    es: { name: "Kitsune", desc: "El espíritu zorro cambiaformas de Japón gana una cola nueva cada siglo —hasta nueve—, sumando sabiduría y poder con cada una. Una Kitsune puede tomar forma humana: amante, embaucadora o guardiana." },
    pt: { name: "Kitsune", desc: "O espírito-raposa metamorfo do Japão ganha uma nova cauda a cada século — até nove — somando sabedoria e poder a cada uma. Uma Kitsune pode assumir forma humana: amante, trapaceira ou guardiã." },
    ja: { name: "狐(きつね)", desc: "日本の化け狐は百年ごとに尾を一本増やし、最大九本に。一本ごとに知恵と力を得る。狐は人の姿になれる——恋人にも、たぶらかし者にも、守り手にも。" },
    ko: { name: "키츠네(여우 요괴)", desc: "일본의 둔갑하는 여우 정령은 백 년마다 꼬리를 하나씩 늘려 최대 아홉 개에 이르며, 그때마다 지혜와 힘을 얻는다. 키츠네는 인간이 될 수 있다 — 연인으로, 사기꾼으로, 수호자로." },
    zh: { name: "狐妖", desc: "日本的变形狐妖每过一个世纪便添一条尾巴，最多九条，每条都增添智慧与力量。狐妖能化为人形——或为爱人，或为骗徒，或为守护者。" },
  },
  "la_llorona.png": {
    es: { name: "La Llorona", desc: "La Mujer Llorona ahogó a sus hijos y ahora recorre los ríos de noche, gimiendo por ellos para siempre. De México a toda Latinoamérica, los padres advierten: no salgas de noche, o te tomará por uno de los suyos." },
    pt: { name: "La Llorona", desc: "A Mulher Chorona afogou os filhos e agora vaga pelos rios à noite, lamentando-os para sempre. Do México a toda a América Latina, os pais avisam: não saia à noite, ou ela te levará como se fosse seu." },
    ja: { name: "ラ・ヨローナ", desc: "「泣く女」は我が子を溺れさせ、今も夜ごと川辺をさまよい、永遠に泣き続ける。メキシコからラテンアメリカ全土で、親は戒める——夜は出歩くな、さもなくば我が子と間違えて連れ去られる。" },
    ko: { name: "라 요로나", desc: "'우는 여인'은 제 아이들을 물에 빠뜨리고, 이제 밤마다 강가를 떠돌며 영원히 통곡한다. 멕시코에서 라틴아메리카 전역까지 부모들은 경고한다 — 밤에 나가지 마라, 제 아이로 착각해 데려갈 테니." },
    zh: { name: "哭泣的女人", desc: "“哭泣的女人”溺死了自己的孩子，如今夜夜在河边游荡，为他们永世哀号。从墨西哥到整个拉丁美洲，父母都告诫：天黑别出门，否则她会把你当成自己的孩子带走。" },
  },
  "minotaur.png": {
    es: { name: "Minotauro", desc: "Mitad hombre, mitad toro, el Minotauro acechaba el Laberinto bajo Creta, devorando a quienes eran enviados como tributo, hasta que Teseo siguió un hilo para matarlo. El monstruo-laberinto original del mito griego." },
    pt: { name: "Minotauro", desc: "Metade homem, metade touro, o Minotauro espreitava o Labirinto sob Creta, devorando os que eram enviados como tributo — até Teseu seguir um fio para matá-lo. O monstro-labirinto original do mito grego." },
    ja: { name: "ミノタウロス", desc: "半人半牛のミノタウロスはクレタ島の地下の迷宮に潜み、生贄として送られた者を喰らった——テセウスが糸をたどって討ち取るまで。ギリシャ神話の元祖・迷宮の怪物。" },
    ko: { name: "미노타우로스", desc: "반인반우의 미노타우로스는 크레타 지하의 미궁에 도사리며 제물로 보내진 이들을 삼켰다 — 테세우스가 실을 따라 그를 베어 죽일 때까지. 그리스 신화 원조 미궁의 괴물." },
    zh: { name: "牛头怪", desc: "半人半牛的弥诺陶洛斯潜伏在克里特岛地下的迷宫，吞食被送来献祭者——直到忒修斯循着线团将其斩杀。希腊神话中最初的迷宫怪物。" },
  },
  "mr_hyde_base.png": {
    es: { name: "Mr Hyde", desc: "El monstruoso alter ego del relato de Stevenson de 1886, liberado por la poción de un respetable doctor. Nacido en la brumosa Londres victoriana: la personalidad dividida original." },
    pt: { name: "Mr Hyde", desc: "O monstruoso alter ego do conto de Stevenson de 1886, libertado pela poção de um respeitável médico. Nascido na enevoada Londres vitoriana: a personalidade dividida original." },
    ja: { name: "ハイド氏", desc: "1886年のスティーヴンソンの物語に登場する怪物的なもう一つの人格。立派な医師が秘薬で解き放った。霧深きヴィクトリア朝ロンドン生まれ——二重人格の元祖。" },
    ko: { name: "하이드", desc: "1886년 스티븐슨의 소설에 나오는 괴물 같은 또 다른 자아. 점잖은 의사가 묘약으로 풀어놓았다. 안개 낀 빅토리아 시대 런던에서 태어난 원조 이중인격." },
    zh: { name: "海德先生", desc: "出自史蒂文森1886年小说的怪物般另一人格，由一位体面医生用药剂释放。诞生于雾气弥漫的维多利亚时代伦敦——最初的双重人格。" },
  },
  "nahual.png": {
    es: { name: "Nahual", desc: "En la creencia mesoamericana, un Nahual es un brujo humano que se transforma en animal —jaguar, búho o coyote— para vagar de noche. La tradición va del antiguo México a toda Centroamérica." },
    pt: { name: "Nahual", desc: "Na crença mesoamericana, um Nahual é um feiticeiro humano que se transforma em animal — onça, coruja ou coiote — para vagar à noite. A tradição vai do antigo México a toda a América Central." },
    ja: { name: "ナワル", desc: "メソアメリカの信仰で、ナワルは動物——ジャガー、フクロウ、コヨーテ——に変身して夜を徘徊する人間の呪術師。その伝統は古代メキシコから中央アメリカ全域に及ぶ。" },
    ko: { name: "나우알", desc: "메소아메리카 신앙에서 나우알은 재규어, 부엉이, 코요테 같은 동물로 변신해 밤을 떠도는 인간 주술사다. 이 전통은 고대 멕시코에서 중앙아메리카 전역에 이른다." },
    zh: { name: "纳瓜尔", desc: "在中美洲信仰中，纳瓜尔是能变身为动物——美洲豹、猫头鹰或郊狼——夜间游荡的人类巫师。这一传统自古墨西哥延续至整个中美洲。" },
  },
  "oni.png": {
    es: { name: "Oni", desc: "Ogros cornudos y colosales del folclore japonés, los Oni empuñan mazas de hierro y guardan las puertas del infierno. Cada primavera las familias lanzan frijoles para expulsarlos: '¡Oni wa soto!' —¡demonios fuera!" },
    pt: { name: "Oni", desc: "Ogros chifrudos e colossais do folclore japonês, os Oni empunham clavas de ferro e guardam os portões do inferno. Toda primavera as famílias jogam feijões para expulsá-los: 'Oni wa soto!' — demônios para fora!" },
    ja: { name: "鬼", desc: "日本の伝承に登場する角を持つ巨大な鬼は、鉄の金棒を振るい地獄の門を守る。春には家々が豆をまいて追い払う——「鬼は外!」" },
    ko: { name: "오니", desc: "일본 전승의 뿔 달린 거대한 도깨비 오니는 쇠몽둥이를 휘두르며 지옥의 문을 지킨다. 봄마다 가족들은 콩을 뿌려 그들을 쫓는다 — '오니와 소토!' 귀신은 물러가라!" },
    zh: { name: "鬼(日本)", desc: "日本传说中头生犄角的巨大恶鬼“鬼”，挥舞铁棒，守卫地狱之门。每逢春日，家家撒豆驱赶它们：“鬼は外！”——恶鬼出去！" },
  },
  "saci_pere.png": {
    es: { name: "Saci-Pererê", desc: "Un travieso de una sola pierna que fuma pipa y lleva un gorro rojo mágico, Saci recorre Brasil como remolinos de polvo, escondiendo llaves y asustando viajeros. Atrapa su gorro y deberá concederte un deseo." },
    pt: { name: "Saci-Pererê", desc: "Um traquinas de uma perna só, fumando cachimbo e de gorro vermelho mágico, o Saci roda pelo Brasil como redemoinhos de poeira, escondendo chaves e assustando viajantes. Pegue seu gorro e ele terá de realizar um desejo." },
    ja: { name: "サシ・ペレレ", desc: "魔法の赤い帽子をかぶり、パイプをくわえた一本足のいたずら者サシは、つむじ風となってブラジルを駆け、鍵を隠し旅人を脅かす。帽子を捕まえれば、願いを一つ叶えねばならない。" },
    ko: { name: "사시 페레레", desc: "마법의 빨간 모자를 쓰고 파이프를 문 외다리 장난꾼 사시는 회오리바람이 되어 브라질을 누비며 열쇠를 숨기고 나그네를 놀린다. 그의 모자를 잡으면 소원 하나를 들어줘야 한다." },
    zh: { name: "萨西", desc: "戴着魔法红帽、叼着烟斗的独腿捣蛋鬼萨西，化作旋风穿行巴西，藏起钥匙、惊吓旅人。抓住他的帽子，他就得为你实现一个愿望。" },
  },
  "sasquatch.png": {
    es: { name: "Sasquatch", desc: "Pie Grande: un hombre-simio gigante que, según se dice, vaga por el noroeste del Pacífico, dejando huellas enormes y fotos borrosas. Un clásico del folclore silvestre de Canadá y EE. UU. desde hace más de un siglo." },
    pt: { name: "Sasquatch", desc: "Pé-Grande: um homem-macaco gigante que, dizem, vaga pelo noroeste do Pacífico, deixando pegadas enormes e fotos borradas. Um clássico do folclore selvagem do Canadá e dos EUA há mais de um século." },
    ja: { name: "サスカッチ", desc: "ビッグフット——太平洋岸北西部をさまようとされる巨大な類人猿。巨大な足跡とぼやけた写真を残す。一世紀以上にわたるカナダと米国の原野伝承の定番。" },
    ko: { name: "새스콰치", desc: "빅풋 — 태평양 북서부를 떠돈다는 거대한 유인원. 거대한 발자국과 흐릿한 사진을 남긴다. 한 세기 넘게 이어진 캐나다와 미국 황야 전설의 단골." },
    zh: { name: "大脚怪", desc: "“大脚怪”——据说游荡于太平洋西北地区的巨型类人猿，留下巨大脚印和模糊照片。一个多世纪以来加拿大与美国荒野传说的经典角色。" },
  },
  "tengu.png": {
    es: { name: "Tengu", desc: "Espíritus de montaña de nariz larga y rostro rojo de Japón, los Tengu son guerreros feroces y maestros de las artes marciales que custodian las cumbres sagradas. Antes temidos como demonios, hoy venerados como protectores." },
    pt: { name: "Tengu", desc: "Espíritos da montanha de nariz comprido e rosto vermelho do Japão, os Tengu são guerreiros ferozes e mestres em artes marciais que guardam os picos sagrados. Antes temidos como demônios, hoje reverenciados como protetores." },
    ja: { name: "天狗", desc: "長い鼻と赤い顔を持つ日本の山の精霊・天狗は、霊峰を守る荒々しい武人にして武術の達人。かつては魔物として恐れられたが、今は守り神として崇められる。" },
    ko: { name: "텐구", desc: "긴 코와 붉은 얼굴을 한 일본의 산 정령 텐구는 신성한 봉우리를 지키는 사나운 무사이자 무술의 달인이다. 한때 마물로 두려움을 샀으나 이제는 수호신으로 숭배된다." },
    zh: { name: "天狗", desc: "日本长鼻赤面的山中精灵天狗，是守护圣峰的凶猛武者与武术宗师。昔日被惧为妖魔，今日被尊为守护神。" },
  },
  "vampire.png": {
    es: { name: "Vampiro", desc: "El no-muerto bebedor de sangre de la leyenda de Transilvania, inmortalizado como Drácula. El folclore eslavo y rumano dio al mundo el ajo, las estacas y un miedo a la noche que nunca muere." },
    pt: { name: "Vampiro", desc: "O morto-vivo bebedor de sangue da lenda da Transilvânia, imortalizado como Drácula. O folclore eslavo e romeno deu ao mundo o alho, as estacas e um medo da noite que nunca morre." },
    ja: { name: "吸血鬼", desc: "トランシルヴァニア伝説の血を吸う不死者、ドラキュラとして不滅となった。スラヴとルーマニアの伝承は、ニンニク、杭、そして決して死なぬ夜への恐怖を世界に与えた。" },
    ko: { name: "뱀파이어", desc: "트란실바니아 전설의 피를 마시는 불사자, 드라큘라로 영원히 남았다. 슬라브와 루마니아 전승은 마늘과 말뚝, 그리고 결코 죽지 않는 밤의 공포를 세상에 주었다." },
    zh: { name: "吸血鬼", desc: "源自特兰西瓦尼亚传说、以德古拉之名永世流传的嗜血不死者。斯拉夫与罗马尼亚的传说为世界带来了大蒜、木桩，以及对永夜不灭的恐惧。" },
  },
  "werewolf.png": {
    es: { name: "Hombre lobo", desc: "El loup-garou: un alma maldita que se transforma en lobo bajo la luna llena. De Francia a toda Europa, solo la plata podía poner fin a su sed de sangre." },
    pt: { name: "Lobisomem", desc: "O loup-garou: uma alma amaldiçoada que se transforma em lobo sob a lua cheia. Da França a toda a Europa, só a prata podia pôr fim à sua sede de sangue." },
    ja: { name: "狼男", desc: "ルー・ガルー——満月の下で狼に変わる呪われた魂。フランスからヨーロッパ全土まで、その血への渇きを止められるのは銀だけだった。" },
    ko: { name: "늑대인간", desc: "루가루 — 보름달 아래 늑대로 변하는 저주받은 영혼. 프랑스에서 유럽 전역까지, 그 피의 갈망을 끝낼 수 있는 것은 오직 은뿐이었다." },
    zh: { name: "狼人", desc: "“卢加鲁”——满月之下化为狼的受诅之魂。从法国到整个欧洲，唯有白银能终结它对鲜血的渴望。" },
  },
  "cosmic_alien.png": {
    es: { name: "Visitante cósmico", desc: "No es de ningún país: el visitante cósmico pertenece a todo el cielo, reportado en cada continente desde el amanecer de la era OVNI." },
    pt: { name: "Visitante cósmico", desc: "Não é de país algum: o visitante cósmico pertence a todo o céu, relatado em cada continente desde o amanhecer da era OVNI." },
    ja: { name: "宇宙からの来訪者", desc: "どの国のものでもない——宇宙からの来訪者は空全体に属し、UFO時代の幕開け以来あらゆる大陸で目撃されてきた。" },
    ko: { name: "우주의 방문자", desc: "어느 나라의 것도 아니다 — 우주의 방문자는 하늘 전체에 속하며, UFO 시대의 여명 이래 모든 대륙에서 목격되어 왔다." },
    zh: { name: "宇宙来客", desc: "不属于任何国家——宇宙来客属于整片天空，自UFO时代开启以来，每个大洲都有它的目击记录。" },
  },
  "gray_alien.png": {
    es: { name: "El Gris", desc: "El clásico 'Gris' de ojos enormes, grabado en la cultura pop por el incidente de Roswell de 1947 en Nuevo México. Hoy, la imagen por defecto de un extraterrestre en todo el mundo." },
    pt: { name: "O Cinza", desc: "O clássico 'Cinza' de olhos enormes, gravado na cultura pop pelo incidente de Roswell de 1947, no Novo México. Hoje, a imagem-padrão de um extraterrestre no mundo todo." },
    ja: { name: "グレイ", desc: "大きな目をした典型的な「グレイ」。1947年のニューメキシコ州ロズウェル事件でポップカルチャーに刻まれ、今や世界中で宇宙人の標準イメージとなった。" },
    ko: { name: "그레이", desc: "큰 눈을 가진 전형적인 '그레이'. 1947년 뉴멕시코 로즈웰 사건으로 대중문화에 각인되어, 이제는 전 세계 외계인의 기본 이미지가 되었다." },
    zh: { name: "小灰人", desc: "大眼睛的经典“小灰人”，因1947年新墨西哥州罗斯威尔事件而烙入流行文化，如今成为全球外星人的默认形象。" },
  },
  "green_classic_alien.png": {
    es: { name: "Hombrecito verde", desc: "Los 'hombrecitos verdes' de la ciencia ficción de la edad de oro y los cómics pulp: el atajo juguetón de la humanidad para la vida de otro planeta. Global y orgullosamente ficticio." },
    pt: { name: "Homenzinho verde", desc: "Os 'homenzinhos verdes' da ficção científica da era de ouro e dos quadrinhos pulp: o atalho brincalhão da humanidade para a vida de outro planeta. Global e orgulhosamente fictício." },
    ja: { name: "リトル・グリーン・マン", desc: "黄金時代のSFやパルプ漫画に登場する「リトル・グリーン・マン」——異星の生命を表す人類のお茶目な符丁。世界共通で、堂々たる架空の存在。" },
    ko: { name: "리틀 그린 맨", desc: "황금기 SF와 펄프 만화에 등장하는 '리틀 그린 맨' — 다른 행성의 생명을 가리키는 인류의 장난스러운 상징. 전 세계 공통이며 당당히 허구다." },
    zh: { name: "小绿人", desc: "黄金时代科幻与廉价漫画里的“小绿人”——人类对外星生命的俏皮代称。全球通用，且堂堂正正是虚构的。" },
  },
  "reptilian_alien.png": {
    es: { name: "Reptiliano", desc: "Señores reptilianos cambiaformas del mito conspirativo moderno, que supuestamente gobiernan el mundo en secreto desde las sombras. Un mito del siglo XX que se volvió planetario en internet." },
    pt: { name: "Reptiliano", desc: "Senhores reptilianos metamorfos do mito conspiratório moderno, que supostamente governam o mundo em segredo, nas sombras. Um mito do século XX que se tornou planetário na internet." },
    ja: { name: "レプティリアン", desc: "現代の陰謀論に登場する変身する爬虫類人の支配者。影から密かに世界を操っているとされる。20世紀の神話がインターネットで地球規模に広がった。" },
    ko: { name: "렙틸리언", desc: "현대 음모론에 등장하는 변신하는 파충류 지배자. 그림자 속에서 은밀히 세계를 좌우한다고 한다. 20세기의 신화가 인터넷을 타고 전 지구로 퍼졌다." },
    zh: { name: "爬虫人", desc: "现代阴谋论中变形的爬虫类霸主，据传暗中从幕后操纵世界。一个20世纪的传说，借助互联网传遍全球。" },
  },
  "mcduck-avatar.png": {
    es: { name: "McDuck", desc: "Una base tributo: el legendario pato del dinero en persona. No es un mito, solo un meme." },
    pt: { name: "McDuck", desc: "Uma base tributo: o lendário pato do dinheiro em pessoa. Não é um mito, só um meme." },
    ja: { name: "マクダック", desc: "トリビュート・ベース——伝説のマネー・ダックその人。神話ではなく、ただのミーム。" },
    ko: { name: "맥덕", desc: "헌정 베이스 — 전설의 돈 오리 그 자체. 신화가 아니라 그냥 밈이다." },
    zh: { name: "麦克鸭", desc: "一款致敬基底——传奇的“money duck”本尊。这不是神话，只是个梗。" },
  },
};

// ── Trait description templates per category, per locale (English name `n`) ──
const CAT = {
  es: {
    eyes: (n) => `${n}: la mirada que define el ánimo de tu Punk.`,
    brows: (n) => `Cejas ${n}: el pequeño trazo que cambia toda la expresión.`,
    face_marks: (n) => `${n}: una marca facial que le da carácter a tu Punk.`,
    ears: (n) => `Orejas ${n} para un toque de personalidad.`,
    hair_back: (n) => `${n}: la capa de cabello trasera que enmarca por detrás.`,
    hair_front: (n) => `${n}: el peinado frontal que corona el rostro.`,
    tops: (n) => `${n}: el atuendo que tu Punk lleva on-chain.`,
    neckwear: (n) => `${n} al cuello para rematar el look.`,
    outerwear_details: (n) => `${n}: detalles de abrigo en capas por encima.`,
    eyeglasses: (n) => `${n}: gafas con actitud.`,
    head_accessories: (n) => `${n}: el accesorio que corona a tu Punk.`,
    jewelry: (n) => `${n}: el flex. Joyería para el Punk con gusto.`,
    handhelds: (n) => `${n}: algo para que tu Punk sostenga.`,
    companions: (n) => `${n}: un compañero que acompaña a tu Punk.`,
    special: (n) => `${n}: un toque especial que rara vez se ve.`,
    fx: (n) => `${n}: una capa de aura/FX para el máximo drama on-chain.`,
  },
  pt: {
    eyes: (n) => `${n}: o olhar que define o humor do seu Punk.`,
    brows: (n) => `Sobrancelhas ${n}: o pequeno traço que muda toda a expressão.`,
    face_marks: (n) => `${n}: uma marca no rosto que dá identidade ao seu Punk.`,
    ears: (n) => `Orelhas ${n} para um toque de personalidade.`,
    hair_back: (n) => `${n}: a camada de cabelo de trás, emoldurando por detrás.`,
    hair_front: (n) => `${n}: o penteado da frente que coroa o rosto.`,
    tops: (n) => `${n}: a roupa que seu Punk veste on-chain.`,
    neckwear: (n) => `${n} no pescoço para fechar o visual.`,
    outerwear_details: (n) => `${n}: detalhes de casaco em camadas por cima.`,
    eyeglasses: (n) => `${n}: óculos com atitude.`,
    head_accessories: (n) => `${n}: o acessório que coroa o seu Punk.`,
    jewelry: (n) => `${n}: o flex. Joias para o Punk de bom gosto.`,
    handhelds: (n) => `${n}: algo para o seu Punk segurar.`,
    companions: (n) => `${n}: um companheiro que acompanha o seu Punk.`,
    special: (n) => `${n}: um toque especial, raramente visto.`,
    fx: (n) => `${n}: uma camada de aura/FX para o máximo drama on-chain.`,
  },
  ja: {
    eyes: (n) => `${n}：あなたのPunkの雰囲気を決める瞳。`,
    brows: (n) => `${n}の眉——表情をがらりと変える小さな一筆。`,
    face_marks: (n) => `${n}：あなたのPunkの個性を際立たせるフェイスマーク。`,
    ears: (n) => `個性を添える${n}の耳。`,
    hair_back: (n) => `${n}：頭の後ろを縁取る後ろ髪のレイヤー。`,
    hair_front: (n) => `${n}：顔を引き立てる前髪のスタイル。`,
    tops: (n) => `${n}：あなたのPunkがオンチェーンで着る一着。`,
    neckwear: (n) => `首元に${n}を添えて、装いの仕上げを。`,
    outerwear_details: (n) => `${n}：上に重ねるアウターのディテール。`,
    eyeglasses: (n) => `${n}：個性あふれるアイウェア。`,
    head_accessories: (n) => `${n}：Punk全体を引き締めるヘッドウェア。`,
    jewelry: (n) => `${n}：これぞ自慢。目利きのPunkのためのジュエリー。`,
    handhelds: (n) => `${n}：あなたのPunkが手に持つもの。`,
    companions: (n) => `${n}：あなたのPunkに寄り添う相棒。`,
    special: (n) => `${n}：めったに見られない特別な一手。`,
    fx: (n) => `${n}：オンチェーンで最大級の演出を放つオーラ/FXレイヤー。`,
  },
  ko: {
    eyes: (n) => `${n}: 당신 Punk의 분위기를 결정하는 눈.`,
    brows: (n) => `${n} 눈썹 — 표정 전체를 바꾸는 작은 한 획.`,
    face_marks: (n) => `${n}: 당신 Punk만의 개성을 드러내는 얼굴 표식.`,
    ears: (n) => `개성을 더하는 ${n} 귀.`,
    hair_back: (n) => `${n}: 머리 뒤를 감싸는 뒷머리 레이어.`,
    hair_front: (n) => `${n}: 얼굴을 돋보이게 하는 앞머리 스타일.`,
    tops: (n) => `${n}: 당신 Punk가 온체인에서 입는 옷.`,
    neckwear: (n) => `목에 두르는 ${n}으로 룩을 마무리.`,
    outerwear_details: (n) => `${n}: 위에 겹쳐 입는 아우터 디테일.`,
    eyeglasses: (n) => `${n}: 개성 넘치는 아이웨어.`,
    head_accessories: (n) => `${n}: Punk 전체를 완성하는 헤드웨어.`,
    jewelry: (n) => `${n}: 바로 이 플렉스. 안목 있는 Punk를 위한 주얼리.`,
    handhelds: (n) => `${n}: 당신 Punk가 손에 드는 것.`,
    companions: (n) => `${n}: 당신 Punk와 함께하는 동반자.`,
    special: (n) => `${n}: 좀처럼 보기 힘든 특별한 한 끗.`,
    fx: (n) => `${n}: 온체인에서 최고의 연출을 더하는 오라/FX 레이어.`,
  },
  zh: {
    eyes: (n) => `${n}：决定你的 Punk 整体气场的眼睛。`,
    brows: (n) => `${n}眉——改变整张脸表情的小小一笔。`,
    face_marks: (n) => `${n}：让你的 Punk 独具辨识度的面部标记。`,
    ears: (n) => `${n}耳朵，添一分个性。`,
    hair_back: (n) => `${n}：勾勒脑后的后发图层。`,
    hair_front: (n) => `${n}：点缀面庞的前发造型。`,
    tops: (n) => `${n}：你的 Punk 在链上穿的那一身。`,
    neckwear: (n) => `颈间一抹${n}，为造型收尾。`,
    outerwear_details: (n) => `${n}：叠搭在外的外套细节。`,
    eyeglasses: (n) => `${n}：有态度的眼镜。`,
    head_accessories: (n) => `${n}：为整个 Punk 画龙点睛的头饰。`,
    jewelry: (n) => `${n}：就是要这份炫耀。献给有品位的 Punk 的珠宝。`,
    handhelds: (n) => `${n}：给你的 Punk 拿在手里的小物。`,
    companions: (n) => `${n}：与你的 Punk 同行的伙伴。`,
    special: (n) => `${n}：难得一见的特别点缀。`,
    fx: (n) => `${n}：带来满满链上戏剧感的光环/特效图层。`,
  },
};

let baseCount = 0;
let traitCount = 0;
for (const [key, e] of Object.entries(map.items)) {
  const [cat, file] = key.split("/");
  const i18n = e.i18n ?? {};
  if (cat === "base") {
    const b = BASE[file];
    if (!b) continue; // neutral skins keep English-only
    for (const loc of LOCALES) i18n[loc] = { name: b[loc].name, desc: b[loc].desc };
    baseCount++;
  } else {
    const tmpl = (loc) => CAT[loc]?.[cat];
    let did = false;
    for (const loc of LOCALES) {
      const fn = tmpl(loc);
      if (!fn) continue;
      i18n[loc] = { ...(i18n[loc] ?? {}), desc: fn(e.name) }; // localize desc; name stays the English label
      did = true;
    }
    if (did) traitCount++;
  }
  e.i18n = i18n;
}

writeFileSync(OUT, JSON.stringify(map, null, 2) + "\n");
console.log(`Localized ${baseCount} base stories + ${traitCount} trait descriptions × ${LOCALES.length} locales → ${OUT}`);
