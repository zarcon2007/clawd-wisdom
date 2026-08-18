/* =========================================================================
   CLAWD Wisdom — интерактивный пиксельный маскот-котик.

   Ключевые решения:
   - Никаких фреймворков и сборщиков: чистый классический скрипт с defer,
     один namespace `CLAWD` на всё приложение.
   - Спрайт-лист генерируется в коде: авторский пиксель-арт 24×24 (матрицы
     символов) масштабируется 2× и собирается в один offscreen-canvas-лист
     размером 10×48. Так мы получаем три состояния (idle с миганием, walk,
     action) гарантированно и без внешних запросов.
   - Один общий цикл requestAnimationFrame: и физика, и смена кадров, и
     таймер облачка. Кадры переключаются по накопленному времени (fps),
     а не по счётчику итераций.
   - Маскот позиционируется через transform (translate3d) — только
     GPU-композит, без reflow. image-rendering: pixelated сохраняет
     пиксельную чёткость при апскейле 48 → 144 CSS px.
   - Подсказки показываются в точке клика из «мешка»: индексы перемешаны,
     каждый клик снимает один, опустошённый мешок перемешивается заново.
   ========================================================================= */
'use strict';

const CLAWD = (() => {
  /* =====================================================================
     1. СПРАЙТ-ЛИСТ (авторский пиксель-арт)
     ===================================================================== */

  // Палитра: символ матрицы → цвет. Точка = прозрачность.
  const PALETTE = {
    '.': null,          // прозрачный
    'o': '#33221a',     // тёмный контур
    'O': '#f0a03c',     // оранжевая шерсть
    'D': '#c97b24',     // тень шерсти
    'L': '#ffce7a',     // блик
    'C': '#ffe8c0',     // кремовая мордочка / грудка / лапки
    'P': '#f4a0a0',     // внутреннее ухо
    'R': '#f4a0a0',     // румянец
    'E': '#33221a',     // глаз
    'N': '#e05b5b',     // нос
    'W': '#33221a',     // усы
    'M': '#5a2e20',     // открытый рот (мяу)
  };

  // Базовый кадр: idle, глаза открыты (2px)
  const F0 = [
    '........................',
    '........................',
    '.....oo..........oo.....',
    '....oPPo........oPPo....',
    '....oPPo........oPPo....',
    '...oOOOOOOOOOOOOOOOOo...',
    '..oOOOOOOOOOOOOOOOOOOo..',
    '..oOOLLOOOOOOOOOOLLOOo..',
    '.oOOOOOOOOOOOOOOOOOOOOo.',
    '.oOOOOOOEEOOOOEEOOOOOOo.',
    '.oOOOORREEOOOOEERROOOOo.',
    '.oOOOOOOOOONNOOOOOOOOOo.',
    '.oOOOOOOOOCCCCOOOOOOOOo.',
    '.oOOWWOOOOOMMOOOOOWWOo..',
    '..oOOOOOOOOOOOOOOOOOOo..',
    '.oOOOOOOOOOOOOOOOOOOOOo.',
    '.oOCCCCCCCCCCCCCCCCCCOo.',
    '.oOCCCCCCCCCCCCCCCCCCOo.',
    '.oOCCCCCCCCCCCCCCCCCCOo.',
    '.oOOOOOOOOOOOOOOOOOOOOo.',
    '.oOOOOOOOOOOOOOOOOOOOOo.',
    '..oOOCCCCCOOOOCCCCCOOo..',
    '....oOOOo.....oOOOo.....',
    '........................',
  ];

  // Базовый кадр: полузакрытые глаза (1px)
  const F1 = [
    '........................',
    '........................',
    '.....oo..........oo.....',
    '....oPPo........oPPo....',
    '....oPPo........oPPo....',
    '...oOOOOOOOOOOOOOOOOo...',
    '..oOOOOOOOOOOOOOOOOOOo..',
    '..oOOLLOOOOOOOOOOLLOOo..',
    '.oOOOOOOOOOOOOOOOOOOOOo.',
    '.oOOOOOOEEOOOOEEOOOOOOo.',
    '.oOOOORROOOOOOOORROOOOo.',
    '.oOOOOOOOOONNOOOOOOOOOo.',
    '.oOOOOOOOOCCCCOOOOOOOOo.',
    '.oOOWWOOOOOMMOOOOOWWOo..',
    '..oOOOOOOOOOOOOOOOOOOo..',
    '.oOOOOOOOOOOOOOOOOOOOOo.',
    '.oOCCCCCCCCCCCCCCCCCCOo.',
    '.oOCCCCCCCCCCCCCCCCCCOo.',
    '.oOCCCCCCCCCCCCCCCCCCOo.',
    '.oOOOOOOOOOOOOOOOOOOOOo.',
    '.oOOOOOOOOOOOOOOOOOOOOo.',
    '..oOOCCCCCOOOOCCCCCOOo..',
    '....oOOOo.....oOOOo.....',
    '........................',
  ];

  // Базовый кадр: глаза закрыты (мигание)
  const F2 = [
    '........................',
    '........................',
    '.....oo..........oo.....',
    '....oPPo........oPPo....',
    '....oPPo........oPPo....',
    '...oOOOOOOOOOOOOOOOOo...',
    '..oOOOOOOOOOOOOOOOOOOo..',
    '..oOOLLOOOOOOOOOOLLOOo..',
    '.oOOOOOOOOOOOOOOOOOOOOo.',
    '.oOOOOOOOOOOOOOOOOOOOOo.',
    '.oOOOORROOOOOOOORROOOOo.',
    '.oOOOOOOOOONNOOOOOOOOOo.',
    '.oOOOOOOOOCCCCOOOOOOOOo.',
    '.oOOWWOOOOOMMOOOOOWWOo..',
    '..oOOOOOOOOOOOOOOOOOOo..',
    '.oOOOOOOOOOOOOOOOOOOOOo.',
    '.oOCCCCCCCCCCCCCCCCCCOo.',
    '.oOCCCCCCCCCCCCCCCCCCOo.',
    '.oOCCCCCCCCCCCCCCCCCCOo.',
    '.oOOOOOOOOOOOOOOOOOOOOo.',
    '.oOOOOOOOOOOOOOOOOOOOOo.',
    '..oOOCCCCCOOOOCCCCCOOo..',
    '....oOOOo.....oOOOo.....',
    '........................',
  ];

  // Базовый кадр: мяу (рот открыт, глаза с бликом)
  const F8 = [
    '........................',
    '........................',
    '.....oo..........oo.....',
    '....oPPo........oPPo....',
    '....oPPo........oPPo....',
    '...oOOOOOOOOOOOOOOOOo...',
    '..oOOOOOOOOOOOOOOOOOOo..',
    '..oOOLLOOOOOOOOOOLLOOo..',
    '.oOOOOOOOOOOOOOOOOOOOOo.',
    '.oOOOOOOLEOOOOLEOOOOOOo.',
    '.oOOOORREEOOOOEERROOOOo.',
    '.oOOOOOOOOONNOOOOOOOOOo.',
    '.oOOOOOOOOCCCCOOOOOOOOo.',
    '.oOOWWOOOOOMMMOOOOWWOo..',
    '..oOOOOOOOMMMMOOOOOOOo..',
    '.oOOOOOOOOOOOOOOOOOOOOo.',
    '.oOCCCCCCCCCCCCCCCCCCOo.',
    '.oOCCCCCCCCCCCCCCCCCCOo.',
    '.oOCCCCCCCCCCCCCCCCCCOo.',
    '.oOOOOOOOOOOOOOOOOOOOOo.',
    '.oOOOOOOOOOOOOOOOOOOOOo.',
    '..oOOCCCCCOOOOCCCCCOOo..',
    '....oOOOo.....oOOOo.....',
    '........................',
  ];

  // Поднятый хвост на правой стороне (столбец 23): тёмный кончик сверху,
  // оранжевое тело ниже. Даёт спрайту асимметрию — тогда горизонтальное
  // зеркалирование в сторону движения визуально заметно.
  function addTail(rows) {
    const out = rows.slice();
    for (let y = 9; y <= 20; y++) {
      const ch = y === 9 ? 'o' : 'O';
      let row = out[y];
      row = row.slice(0, 23) + ch;                       // колонка 23
      if (row[22] === '.') row = row.slice(0, 22) + ch + row.slice(23); // соединить с контуром
      out[y] = row;
    }
    return out;
  }

  // Вертикальный сдвиг кадра: walk-анимация как покачивание корпуса.
  function shiftRows(rows, dy) {
    const out = rows.slice();
    for (let y = 0; y < 24; y++) {
      const src = y - dy;
      out[y] = src >= 0 && src < 24 ? rows[src] : '........................';
    }
    return out;
  }

  // Полный лист: idle (открыты → полу → закрыты → полу), walk (4 кадра),
  // action (мяу ×2 → возврат). Последний кадр action — возврат к покою.
  const F_IDLE_0 = addTail(F0);
  const F_IDLE_1 = addTail(F1);
  const F_IDLE_2 = addTail(F2);
  const F_MEOW = addTail(F8);

  const FRAMES = [
    F_IDLE_0, F_IDLE_1, F_IDLE_2, F_IDLE_1,   // idle: 0..3
    F_IDLE_0, shiftRows(F_IDLE_0, -1),        // walk: 4, 5
    F_IDLE_0, shiftRows(F_IDLE_0, 1),         // walk: 6, 7
    F_MEOW, F_IDLE_0,                         // action: 8, 9
  ];

  // Раскладка кадров по состояниям анимации
  const LAYOUT = { idle: [0, 1, 2, 3], walk: [4, 5, 6, 7], action: [8, 8, 9] };

  // Геометрия спрайта: авторский кадр 24×24 → 2× = базовый 48×48,
  // на экране 144×144 (3×), пиксельно через image-rendering.
  const SRC = 24;          // размер авторского кадра
  const SCALE = 2;         // масштаб до базового размера
  const FRAME = SRC * SCALE; // 48
  let display = 144;       // CSS px на экране (144; на узких окнах 120 — см. медиазапрос)
  let half = display / 2;  // половина маскота (для центрирования)

  // Фактический CSS-размер маскота читаем из canvas.offsetWidth — единый
  // источник правды, чтобы JS совпадал с медиазапросом (на узких окнах 120 px)
  function syncMascotSize() {
    const w = canvas.offsetWidth;
    if (w > 0) {
      display = w;
      half = w / 2;
    }
  }

  // Собираем спрайт-лист в offscreen-canvas
  const sheet = document.createElement('canvas');
  sheet.width = FRAMES.length * FRAME;
  sheet.height = FRAME;
  const sctx = sheet.getContext('2d');
  FRAMES.forEach((rows, fi) => {
    const ox = fi * FRAME;
    for (let y = 0; y < SRC; y++) {
      for (let x = 0; x < SRC; x++) {
        const color = PALETTE[rows[y][x]];
        if (!color) continue; // прозрачный пиксель
        sctx.fillStyle = color;
        sctx.fillRect(ox + x * SCALE, y * SCALE, SCALE, SCALE);
      }
    }
  });

  /* =====================================================================
     2. ДОМ-ССЫЛКИ
     ===================================================================== */

  const canvas = document.getElementById('cat');
  const ctx = canvas.getContext('2d');
  canvas.width = FRAME;
  canvas.height = FRAME;
  ctx.imageSmoothingEnabled = false; // на случай масштабированных drawImage

  const containerEl = document.getElementById('tips');
  const counterEl = document.getElementById('counter');
  const counterOpenEl = document.getElementById('counterOpen');
  const counterLeftEl = document.getElementById('counterLeft');

  /* =====================================================================
     3. СОСТОЯНИЕ МАСКОТА
     ===================================================================== */

  // Предпочтение «уменьшить движение»: при включённом маскот не перемещается
  // по экрану (слушаем change, чтобы переключать режим на лету)
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let prefersReduced = motion.matches;
  motion.addEventListener?.('change', (ev) => { prefersReduced = ev.matches; });

  // Позиция — ЦЕНТР маскота в CSS px; позиционируем холст через transform.
  const pos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const vel = { x: 0, y: 0 };
  let facing = 1;          // 1 = смотрит вправо, -1 = влево

  // Режимы движения: 'follow' (за курсором) и 'float' (свободное плавание)
  let mode = 'follow';
  const pointer = { x: pos.x, y: pos.y };
  let lastMove = performance.now();
  let target = { x: pos.x, y: pos.y }; // целевая точка плавания
  let floatWait = 0;       // момент времени, когда можно выбрать новую точку
  let timeNow = 0;         // текущее время rAF (обновляется в цикле)

  // Параметры физики следования: ускорение → инерция → небольшой лаг.
  const FOLLOW_GAIN = 12;      // «притяжение» к цели (px/с на px расстояния)
  const FLOAT_GAIN = 5;        // в плавании движется расслабленнее
  const ACCEL = 9;             // сглаживание скорости (инерция)
  const MAX_SPEED_FOLLOW = 850; // предел скорости за курсором
  const MAX_SPEED_FLOAT = 380;  // предел скорости в плавании
  const FLOAT_TIMEOUT = 2500;   // после какого простоя курсора — плавание (мс)
  const ARRIVE = 12;            // радиус «прибытия» к цели плавания

  // Анимация: имя состояния, индекс кадра, накопленное время.
  const anim = { name: 'idle', index: 0, accum: 0, oneShot: false };
  const FPS = { idle: 4, walk: 10, action: 8 }; // кадров в секунду
  const ACTION_INTERVAL = 1000 / FPS.action;
  const MOVE_EPS = 35; // если скорость выше — анимация ходьбы
  let current = LAYOUT.idle[0];

  // Облачко подсказки: живёт 20 секунд, потом исчезает само
  const TIP_LIFETIME = 20000;

  // Размер окна (кэш, чтобы не читать layout каждый кадр)
  const viewport = { w: window.innerWidth, h: window.innerHeight };

  /* =====================================================================
     4. ПОДСКАЗКИ ПРО CLAUDE CODE
     ===================================================================== */

  // Данные лежат в js/data.js — отдельный файл, чтобы контент не мешался
  // с логикой. Он подключён раньше (defer исполняются по порядку) и кладёт
  // массив в window.CLAWD_TIPS.
  const TIPS = window.CLAWD_TIPS || [];

  // «Мешок»: перемешанные индексы. Каждый клик снимает один; когда мешок
  // опустел — перемешиваем заново.
  let bag = shuffle(TIPS.map((_, i) => i));
  let openedCount = 0;            // сколько подсказок открыто за сессию

  // Тасовка Фишера–Йейтса (не мутирует входной массив)
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Снять одну подсказку из мешка; пустой мешок сначала перемешивается заново
  function drawFromBag() {
    if (bag.length === 0) bag = shuffle(TIPS.map((_, i) => i));
    return bag.pop();
  }

  /* =====================================================================
     5. ФИЗИКА ДВИЖЕНИЯ
     ===================================================================== */

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  // Случайная точка для плавания: маскот целиком остаётся на экране.
  function randomPoint() {
    const m = half + 30; // отступ от краёв
    const spanX = Math.max(0, viewport.w - 2 * m); // защита от крошечных окон
    const spanY = Math.max(0, viewport.h - 2 * m);
    return {
      x: m + Math.random() * spanX,
      y: m + Math.random() * spanY,
    };
  }

  // Следование к цели с инерцией: скорость плавно стремится к «желаемой»,
  // поэтому маскот не приклеен к курсору, а догоняет его с небольшим лагом.
  function steer(tx, ty, dt, gain, maxSpeed) {
    const dx = tx - pos.x;
    const dy = ty - pos.y;
    const dvx = dx * gain - vel.x;
    const dvy = dy * gain - vel.y;
    vel.x += dvx * Math.min(1, ACCEL * dt);
    vel.y += dvy * Math.min(1, ACCEL * dt);
    const sp = Math.hypot(vel.x, vel.y);
    if (sp > maxSpeed) {
      vel.x = (vel.x / sp) * maxSpeed;
      vel.y = (vel.y / sp) * maxSpeed;
    }
    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
  }

  // Плавное торможение, когда цель достигнута
  function dampVelocity(dt) {
    const k = Math.max(0, 1 - 7 * dt);
    vel.x *= k;
    vel.y *= k;
  }

  // Переключение режимов: курсор неподвижен дольше 2.5с → плавание;
  // как только курсор снова движется — немедленный плавный возврат.
  function updateMode() {
    if (mode === 'follow' && timeNow - lastMove > FLOAT_TIMEOUT) {
      mode = 'float';
      target = randomPoint();
      floatWait = 0;
    } else if (mode === 'float' && timeNow - lastMove <= FLOAT_TIMEOUT) {
      mode = 'follow';
    }
  }

  function updateMovement(dt) {
    if (mode === 'follow') {
      // Цель — курсор, ограниченный так, чтобы маскот не вылетал за экран
      steer(
        clamp(pointer.x, half, viewport.w - half),
        clamp(pointer.y, half, viewport.h - half),
        dt, FOLLOW_GAIN, MAX_SPEED_FOLLOW
      );
    } else {
      // Плавание: идём к случайной точке, по прибытии — пауза и новая цель
      const dist = Math.hypot(target.x - pos.x, target.y - pos.y);
      if (dist < ARRIVE) {
        if (floatWait === 0) floatWait = timeNow + 500 + Math.random() * 1000;
        if (timeNow > floatWait) {
          target = randomPoint();
          floatWait = 0;
        }
        dampVelocity(dt);
      } else {
        steer(target.x, target.y, dt, FLOAT_GAIN, MAX_SPEED_FLOAT);
      }
    }
    // Жёсткий clamp: маскот никогда не покидает видимую область
    pos.x = clamp(pos.x, half, viewport.w - half);
    pos.y = clamp(pos.y, half, viewport.h - half);
  }

  /* =====================================================================
     6. АНИМАЦИЯ (смена кадров по времени)
     ===================================================================== */

  function triggerAction() {
    anim.oneShot = true;
    anim.name = 'action';
    anim.index = 0;
    anim.accum = 0;
    current = LAYOUT.action[0];
  }

  function updateAnim(dtMs) {
    if (anim.oneShot) {
      // Action проигрывается один раз (мяу → возврат) и переходит в покой
      anim.accum += dtMs;
      while (anim.accum >= ACTION_INTERVAL) {
        anim.accum -= ACTION_INTERVAL;
        anim.index++;
        if (anim.index >= LAYOUT.action.length) {
          anim.oneShot = false;
          anim.name = 'idle';
          anim.index = 0;
          anim.accum = 0;
        }
      }
      current = LAYOUT.action[Math.min(anim.index, LAYOUT.action.length - 1)];
      return;
    }

    // Обычные зацикленные состояния: движение → walk, покой → idle
    const name = Math.hypot(vel.x, vel.y) > MOVE_EPS ? 'walk' : 'idle';
    if (name !== anim.name) {
      anim.name = name;
      anim.index = 0;
      anim.accum = 0;
    }
    anim.accum += dtMs;
    const interval = 1000 / FPS[name];
    while (anim.accum >= interval) {
      anim.accum -= interval;
      anim.index++;
    }
    const frames = LAYOUT[name];
    current = frames[anim.index % frames.length];
  }

  /* =====================================================================
     7. ПОДСКАЗКИ В ТОЧКЕ КЛИКА
     ===================================================================== */

  const MAX_TIPS = 3;        // одновременно не больше трёх подсказок
  const activeTips = [];     // живые подсказки: { el, kb, anchor, expiresAt }
                             // kb — слот клавиатуры (см. правку 4), -1 для мышиных;
                             // anchor — точка появления (нужна для ре-клэмпа, правка 6)
  const STEP = 26;           // сдвиг «ступеньки» между клавиатурными подсказками

  // Свободный слот клавиатурной подсказки (0..MAX_TIPS-1): наименьший из
  // незанятых kb-слотов, чтобы каскад не накладывался сам на себя
  function nextKbSlot() {
    const used = new Set(activeTips.filter((t) => t.kb >= 0).map((t) => t.kb));
    for (let i = 0; i < MAX_TIPS; i++) {
      if (!used.has(i)) return i;
    }
    return 0;
  }

  // Создаёт элемент облачка. Текст задаётся ДО вставки в контейнер — одним
  // изменением в aria-live-регионе, чтобы скринридер объявил его один раз
  function createTipElement(text) {
    const el = document.createElement('div');
    el.className = 'tip';
    el.textContent = text;
    return el;
  }

  const EDGE = 160;            // подсказка не появляется ближе 160 px к краю

  // Допустимый отступ от края: 160 px по возможности; в узком окне — половина
  // свободного места, чтобы подсказка всегда целиком помещалась на экране
  function edgeMargin(axisSize, tipSize) {
    return Math.min(EDGE, Math.max(0, (axisSize - tipSize) / 2));
  }

  // Позиционирует облачко около точки-якоря: обычно над ней, хвостик снизу
  function positionTip(el, px, py) {
    const bw = el.offsetWidth;   // размеры читаем после вставки в DOM
    const bh = el.offsetHeight;
    const GAP = 14;
    const mx = edgeMargin(viewport.w, bw);
    const my = edgeMargin(viewport.h, bh);

    // По умолчанию облачко — над точкой, хвостик снизу указывает на неё
    let x = px - bw / 2;
    let y = py - GAP - bh;
    let tail = 'b';

    if (y < my) {
      // Сверху не помещается — переворачиваем облачко под точку
      y = py + GAP;
      tail = 't';
    }

    // Зажимаем координаты, чтобы текст не уезжал за край экрана
    // (Math.max страхует от lo > hi, если облачко шире окна)
    x = clamp(x, mx, Math.max(mx, viewport.w - bw - mx));
    y = clamp(y, my, Math.max(my, viewport.h - bh - my));

    el.classList.toggle('tip--tail-b', tail === 'b');
    el.classList.toggle('tip--tail-t', tail === 't');

    el.style.transform = 'translate3d(' + Math.round(x) + 'px, ' + Math.round(y) + 'px, 0)';
  }

  // Подсказки, уходящие с плавным затуханием. Удаляются по transitionend
  // или по дедлайну в rAF-цикле (страховка, если transition не сработал)
  const leavingTips = [];
  const LEAVE_TIMEOUT = 500;   // максимум на анимацию ухода

  function finalizeLeave(entry) {
    const i = leavingTips.indexOf(entry);
    if (i >= 0) leavingTips.splice(i, 1);
    entry.el.remove();
  }

  // Убрать подсказку (эвикция самой старой или истечение срока жизни):
  // элемент получает класс ухода и плавно исчезает через CSS-переход
  function dismissTip(entry) {
    const i = activeTips.indexOf(entry);
    if (i >= 0) activeTips.splice(i, 1);

    entry.leaving = true;
    entry.leaveDeadline = performance.now() + LEAVE_TIMEOUT;
    leavingTips.push(entry);

    // Исключаем уходящий элемент из дерева доступности до его удаления —
    // скринридер не «читает» затухающую подсказку повторно
    entry.el.setAttribute('aria-hidden', 'true');

    entry.el.classList.remove('tip--shown');
    entry.el.classList.add('tip--leave');
    // Одноразовый слушатель: удаляем сразу после первого transitionend
    entry.el.addEventListener('transitionend', (ev) => {
      if (ev.target === entry.el) finalizeLeave(entry);
    }, { once: true });
  }

  // Показать подсказку: взять из мешка, вставить в контейнер, позиционировать
  function spawnTip(px, py, kb) {
    const tip = TIPS[drawFromBag()];
    if (!tip) return; // пустые данные — показывать нечего

    // Лимит MAX_TIPS: лишние вытесняем по одному, начиная с самой старой
    while (activeTips.length >= MAX_TIPS) dismissTip(activeTips[0]);

    openedCount++;
    const el = createTipElement(tip.text);
    containerEl.appendChild(el);
    positionTip(el, px, py);

    // Появление CSS-переходом: сначала reflow в базовом скрытом состоянии,
    // затем класс .tip--shown запускает переход к видимому виду
    void el.offsetWidth;
    el.classList.add('tip--shown');

    activeTips.push({ el, kb, anchor: { x: px, y: py }, expiresAt: performance.now() + TIP_LIFETIME });
    updateCounter();
  }

  function updateCounter() {
    counterOpenEl.textContent = String(openedCount);
    counterLeftEl.textContent = String(bag.length);
    counterEl.classList.remove('counter--bump');
    void counterEl.offsetWidth; // перезапуск вспышки
    counterEl.classList.add('counter--bump');
  }

  /* =====================================================================
     8. ОТРИСОВКА
     ===================================================================== */

  function draw() {
    ctx.clearRect(0, 0, FRAME, FRAME);
    ctx.save();
    // Зеркалирование в сторону движения: flip по горизонтали
    if (facing < 0) {
      ctx.translate(FRAME, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(sheet, current * FRAME, 0, FRAME, FRAME, 0, 0, FRAME, FRAME);
    ctx.restore();

    // Позиционирование маскота: левый верхний угол = центр − половина размера
    canvas.style.transform =
      'translate3d(' + Math.round(pos.x - half) + 'px, ' +
      Math.round(pos.y - half) + 'px, 0)';
  }

  /* =====================================================================
     9. ГЛАВНЫЙ ЦИКЛ (один requestAnimationFrame)
     ===================================================================== */

  let last = performance.now();

  function frame(now) {
    timeNow = now;
    const dt = Math.min(0.05, (now - last) / 1000); // clamp: не прыгать после фокуса
    last = now;

    // При prefers-reduced-motion маскот не летает по экрану — остаются
    // только локальная анимация кадров (мигание/мяу) и подсказки
    if (!prefersReduced) {
      updateMode();
      updateMovement(dt);
    }
    updateAnim(dt * 1000);

    // Зеркалирование: направление по скорости (с порогом против дрожания)
    if (vel.x > 40) facing = 1;
    else if (vel.x < -40) facing = -1;

    // Автоскрытие облачков через TIP_LIFETIME (тоже внутри общего цикла)
    for (let i = activeTips.length - 1; i >= 0; i--) {
      if (now >= activeTips[i].expiresAt) dismissTip(activeTips[i]);
    }

    // Резервное удаление уходящих, если transitionend не сработал
    for (let i = leavingTips.length - 1; i >= 0; i--) {
      if (now >= leavingTips[i].leaveDeadline) finalizeLeave(leavingTips[i]);
    }

    draw();
    requestAnimationFrame(frame);
  }

  /* =====================================================================
     10. СОБЫТИЯ
     ===================================================================== */

  window.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    lastMove = performance.now();
    if (mode === 'float') mode = 'follow'; // немедленный плавный возврат
  });

  // Клик в любом месте страницы: котик мяукает и показывает подсказку
  // в точке клика. Клик по ссылке, кнопке или полю ввода подсказку не даёт.
  window.addEventListener('click', (e) => {
    if (e.target.closest('a, button, input, select, textarea, [contenteditable]')) {
      return;
    }
    triggerAction();
    spawnTip(e.clientX, e.clientY, -1);
  });

  // Пробел и Enter показывают подсказку без мыши — у маскота, «ступенькой».
  // Зажатие клавиши (e.repeat) и ввод в полях/кнопках игнорируются.
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code !== 'Space' && e.code !== 'Enter') return;
    if (e.target.closest('a, button, input, select, textarea, [contenteditable]')) return;

    e.preventDefault(); // Пробел не скроллит и не активирует сфокусированные элементы
    triggerAction();
    const slot = nextKbSlot();
    spawnTip(pos.x + slot * STEP, pos.y + slot * STEP, slot);
  });

  window.addEventListener('resize', () => {
    viewport.w = window.innerWidth;
    viewport.h = window.innerHeight;
    syncMascotSize();        // пересчёт размера маскота (медиазапрос 320 px)
    pos.x = clamp(pos.x, half, viewport.w - half);
    pos.y = clamp(pos.y, half, viewport.h - half);

    // Ре-клэмп активных подсказок, чтобы при перетягивании окна
    // они не уезжали за край экрана
    for (const t of activeTips) positionTip(t.el, t.anchor.x, t.anchor.y);
  });

  /* =====================================================================
     11. СТАРТ
     ===================================================================== */

  // Размер маскота из CSS (на узких окнах 120 px) — до стартового клэмпа
  syncMascotSize();

  // Первоначальная позиция — центр окна
  pos.x = clamp(viewport.w / 2, half, viewport.w - half);
  pos.y = clamp(viewport.h / 2, half, viewport.h - half);

  // Начальные значения счётчика (без вспышки при загрузке)
  counterOpenEl.textContent = '0';
  counterLeftEl.textContent = String(bag.length);

  draw();
  requestAnimationFrame(frame);

  return { spawnTip }; // внешний интерфейс для отладки в консоли
})();
