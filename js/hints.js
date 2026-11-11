// Guidance phrases. The first variant is the one shown (stable; no rotation). Extra variants are kept as
// alternative wordings for future tuning.
// level: 'problem' (red) | 'adjust' (amber) | 'good' (green). dir: arrow/icon shown in the banner.
const P = (level, dir, ...texts) => ({ level, dir, texts });
export const PHRASES = {
  // ---- ID card (rear camera, preview not mirrored; directions are for moving the PHONE) ----
  'card.search': P('adjust', 'frame', '請把證件放進框內', '把證件平放，整張放進白色框線裡', '鏡頭對準證件，讓四個邊都在框內'),
  'card.partial': P('adjust', 'frame', '請把證件完整放進框內，四個角都要看得到', '證件有一邊跑出框外，請稍微移動手機', '請讓證件四邊都露出來，不要被手指擋住'),
  'card.near': P('adjust', 'farther', '太近了，請把手機拿遠一點', '手機往上拉高一點，讓證件四邊都露出來', '距離太近，請把手機拉遠約 5 公分'),
  'card.small': P('adjust', 'closer', '再靠近一點，讓證件填滿框線', '手機再靠近證件一些，讓證件撐滿框', '證件太小了，請把手機慢慢往證件靠近'),
  'card.left': P('adjust', 'left', '證件偏左了，請把手機往左移一點', '請把手機稍微往左平移，讓證件回到中央'),
  'card.right': P('adjust', 'right', '證件偏右了，請把手機往右移一點', '請把手機稍微往右平移，讓證件回到中央'),
  'card.up': P('adjust', 'up', '證件偏上了，請把手機往上移一點', '請把手機稍微往上平移，讓證件回到中央'),
  'card.down': P('adjust', 'down', '證件偏下了，請把手機往下移一點', '請把手機稍微往下平移，讓證件回到中央'),
  'card.flat': P('adjust', 'flat', '請把手機拿平，與證件平行', '手機請與桌面平行，從正上方往下拍', '證件看起來是斜的，請從正上方對準'),
  'card.rotate': P('adjust', 'rotate', '請把證件轉正，與框線對齊', '證件有點歪，請轉正讓邊緣和框線平行', '轉動證件，讓上下邊和框線保持水平'),
  'card.glare': P('problem', 'glare', '證件反光，請稍微傾斜調整角度', '有反光，請避開頭頂燈光或換個位置', '反光擋住資料了，請把證件稍微斜一點'),
  'card.blur': P('problem', 'blur', '畫面模糊，請拿穩讓鏡頭對焦', '還沒對焦，請停一下讓鏡頭對焦', '影像不清楚，可以把手肘靠在桌上穩住手機'),
  'card.dark': P('problem', 'light', '光線太暗，請到明亮的地方', '太暗了，請開燈或移到窗邊', '光線不足，請換到較亮的位置'),
  'card.steady': P('adjust', 'still', '請拿穩，不要晃動', '快好了，請拿穩手機', '手機保持穩定，先不要移動'),
  'card.hold': P('good', 'ok', '很好，請保持不動', '很好！保持這個位置', '就是這樣，再撐一下下'),
  'card.capture': P('good', 'ok', '正在拍攝…'),
  // forgery rightSide shot (phone moved to the upper-right of the card, tilted ~20–30°)
  'card.flip': P('adjust', 'flip', '請把身分證翻到背面'),
  'card.flipSame': P('adjust', 'flip', '還是正面喔，請把身分證翻到背面'),
  'card.rs.search': P('adjust', 'tiltright', '把手機移到證件右上方，斜斜往下拍', '請從證件的右上方斜拍，證件仍要整張在框內', '手機往右邊移、鏡頭朝向證件，讓證件斜斜地出現在框內'),
  'card.rs.flat': P('adjust', 'tiltright', '再斜一點：手機往右上方移，鏡頭朝證件', '請從右上方約 30 度斜拍，不要正對證件'),
  'card.rs.near': P('adjust', 'farther', '太近了，請把手機拿遠一點，證件四角都要看得到'),
  'card.rs.small': P('adjust', 'closer', '證件太小了，請把手機靠近一點（保持斜角）'),

  // ---- face (front camera, preview mirrored; directions as seen on screen) ----
  'face.none': P('adjust', 'frame', '請把臉移進橢圓框', '請看向螢幕，把臉放進橢圓框', '找不到臉，請把手機對著自己的臉'),
  'face.multi': P('problem', 'person', '畫面中只能有一張臉', '偵測到不只一個人，請確認只有你在畫面中'),
  'face.out': P('adjust', 'frame', '請把臉移進橢圓框', '請讓整張臉都在橢圓框內'),
  'face.left': P('adjust', 'right', '臉偏左了，請往右移一點', '請把臉往右移，回到橢圓框中央'),
  'face.right': P('adjust', 'left', '臉偏右了，請往左移一點', '請把臉往左移，回到橢圓框中央'),
  'face.up': P('adjust', 'up', '臉偏上了，請把手機抬高一點', '請把手機往上移，讓臉回到框中央'),
  'face.down': P('adjust', 'down', '臉偏下了，請把手機放低一點', '請把手機往下移，讓臉回到框中央'),
  'face.far': P('adjust', 'closer', '請把手機拿近一點，讓臉填滿橢圓框', '靠近一點', '臉太小了，手機再靠近一些'),
  'face.near': P('adjust', 'farther', '太近了，請把手機拿遠一點', '退後一點', '臉超出框了，請把手臂伸直一點'),
  'face.turnLeft': P('adjust', 'left', '請正面看鏡頭，頭往左轉一點', '鼻子對準鏡頭，臉稍微往左轉'),
  'face.turnRight': P('adjust', 'right', '請正面看鏡頭，頭往右轉一點', '鼻子對準鏡頭，臉稍微往右轉'),
  'face.front': P('adjust', 'frame', '請正面看鏡頭', '眼睛直視鏡頭，臉不要側轉'),
  'face.chinDown': P('adjust', 'down', '請正面看鏡頭，稍微低頭一點', '下巴稍微往內收一點'),
  'face.chinUp': P('adjust', 'up', '請正面看鏡頭，稍微抬頭一點', '下巴稍微抬高一點，眼睛看鏡頭'),
  'face.roll': P('adjust', 'rotate', '請把頭擺正，不要歪頭', '頭部保持正直，兩眼保持水平'),
  'face.dark': P('problem', 'light', '光線太暗，請面向光源', '臉部太暗，請面向窗戶或燈光', '光線不足，請到較亮的地方'),
  'face.bright': P('problem', 'light', '光線太亮，請避開強光', '臉部過曝，請避開直射的陽光或燈光'),
  'face.eyesCovered': P('problem', 'block', '眼睛被遮住，請摘下墨鏡或撥開頭髮', '看不到眼睛，請拿下眼鏡或撥開瀏海'),
  'face.occluded': P('problem', 'block', '臉部被遮住，請拿下口罩或移開遮蔽物', '請拿下口罩，讓整張臉露出來', '下半臉被擋住了，請移開手或口罩'),
  'face.mouth': P('problem', 'block', '嘴巴被遮住，請移開手或遮蔽物'),
  'face.eyes': P('adjust', 'eye', '請張開眼睛', '眼睛請自然張開，看著鏡頭'),
  'face.blur': P('problem', 'blur', '畫面模糊，請拿穩手機', '影像不清楚，請保持手機穩定'),
  'face.moving': P('adjust', 'still', '請保持不動', '頭和手機都先不要動', '快好了，請保持不動'),
  'face.hold': P('good', 'ok', '很好，請保持不動', '很好！保持這個姿勢', '就是這樣，再一下下'),
  'face.capture': P('good', 'ok', '正在拍攝…'),
};

// Short fragments used when several adjustments are needed at once -> ONE merged sentence.
export const PARTS = {
  // card (directions are for moving the phone)
  'card.near': ['把手機拿遠一點', 'farther'], 'card.small': ['把手機靠近一點', 'closer'],
  'card.left': ['手機往左移一點', 'left'], 'card.right': ['手機往右移一點', 'right'],
  'card.up': ['手機往上移一點', 'up'], 'card.down': ['手機往下移一點', 'down'],
  'card.flat': ['手機與證件保持平行', 'flat'], 'card.rotate': ['把證件轉正', 'rotate'],
  // face (as seen on the mirrored preview)
  'face.left': ['把臉往右移', 'right'], 'face.right': ['把臉往左移', 'left'],
  'face.up': ['手機抬高一點', 'up'], 'face.down': ['手機放低一點', 'down'],
  'face.far': ['靠近一點', 'closer'], 'face.near': ['退後一點', 'farther'],
  'face.turnLeft': ['頭往左轉一點', 'left'], 'face.turnRight': ['頭往右轉一點', 'right'],
  'face.front': ['正面看鏡頭', 'frame'], 'face.chinDown': ['稍微低頭', 'down'], 'face.chinUp': ['稍微抬頭', 'up'],
  'face.roll': ['把頭擺正', 'rotate'],
};

/** One key -> its full sentence; several keys (already in priority order) -> one merged sentence (max 2 parts). */
export function phrase(keys) {
  keys = [].concat(keys).filter(Boolean);
  if (keys.length <= 1) {
    const k = keys[0], p = PHRASES[k] || { level: 'adjust', dir: '', texts: [k] };
    return { key: k, hint: p.texts[0], level: p.level, dir: p.dir };
  }
  const [a, b] = keys.slice(0, 2).map(k => PARTS[k] || [(PHRASES[k] || { texts: [k] }).texts[0], '']);
  return { key: keys.slice(0, 2).join('+'), hint: `請${a[0]}，並${b[0]}`, level: 'adjust', dir: a[1] };
}

/** Kept for API compatibility: one stable phrase per state (no rotation). */
export class Phraser {
  say(keys) { return phrase(keys); }
}
