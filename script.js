// ------ Настройки путей к вашим папкам (подкорректируйте, если нужно) ------
const WEAPONS_PATH = './data/weapons/';  // Папка, где лежат XML-файлы оружия
const SKINS_PATH   = './data/skins/';    // Папка, где лежат XML-файлы внешностей

// ------ К каким префиксам относится тот или иной класс ------
const classToPrefixes = {
  'R': ['ar', 'pt', 'kn'], // Штурмовик
  'M': ['shg', 'pt', 'kn'],// Медик
  'E': ['smg', 'pt', 'kn'],// Инженер
  'S': ['sr', 'pt', 'kn'], // Снайпер
};

// ------ DOM-элементы ------
const classSelect   = document.getElementById('classSelect');
const generateBtn   = document.getElementById('generateBtn');
const presetOutput  = document.getElementById('presetOutput');
const copyBtn       = document.getElementById('copyBtn');
const downloadBtn   = document.getElementById('downloadBtn');

// ------ Глобальные массивы, в которые загрузим данные из XML ------
let weaponConfigs = []; // Здесь будет { name, ammo, modules, prefix } для каждого оружия
let skinConfigs   = []; // Здесь будет { name, classes } для каждого скина

// ============================================================================
//  1) Функция парсинга XML (общая) — получает текст XML, отдаёт DOM объект
// ============================================================================
function parseXMLString(xmlString) {
  const parser = new DOMParser();
  return parser.parseFromString(xmlString, "application/xml");
}

// ============================================================================
//  2) Загрузка одного XML-файла и извлечение нужной инфы об оружии
// ============================================================================
async function loadWeaponXML(fileName) {
  try {
    const response = await fetch(WEAPONS_PATH + fileName);
    if (!response.ok) {
      console.warn(`Не удалось загрузить XML оружия: ${fileName}`);
      return null;
    }
    const xmlText = await response.text();
    const xmlDoc = parseXMLString(xmlText);
    
    // Извлекаем name (оружия)
    const itemNode = xmlDoc.querySelector('item');
    if (!itemNode) return null;
    const weaponName = itemNode.getAttribute('name') || 'unknown_weapon';

    // Извлекаем тип патрона
    const ammoParam = xmlDoc.querySelector('fireparams fire param[name="ammo_type"]');
    const ammoType = ammoParam ? ammoParam.getAttribute('value') : 'unknown_ammo';

    // Собираем support-модули
    // (примерно: все <support name="xxx"/>)
    const supportNodes = xmlDoc.querySelectorAll('sockets socket support');
    const modules = [];
    supportNodes.forEach(supp => {
      const modName = supp.getAttribute('name');
      if (modName) {
        modules.push(modName);
      }
    });

    // Определяем префикс (ar, mg, shg, smg, sr, pt, kn и т.п.)
    // Обычно можно смотреть по weaponName, например "ar01" => префикс "ar"
    // Или можно в самом XML где-то искать, но предположим, что достаточно первых букв:
    // До первой цифры выберем символы
    const prefixMatch = weaponName.match(/^[a-z]+/i);
    const prefix = prefixMatch ? prefixMatch[0].toLowerCase() : 'other';

    return {
      name: weaponName,
      ammoType,
      modules,
      prefix,
    };
  } catch (err) {
    console.error('Ошибка загрузки оружия', err);
    return null;
  }
}

// ============================================================================
//  3) Загрузка одного XML-файла и извлечение нужной инфы о скине (внешности)
// ============================================================================
async function loadSkinXML(fileName) {
  try {
    const response = await fetch(SKINS_PATH + fileName);
    if (!response.ok) {
      console.warn(`Не удалось загрузить XML внешности: ${fileName}`);
      return null;
    }
    const xmlText = await response.text();
    const xmlDoc = parseXMLString(xmlText);

    // Получаем <item name="..." class="..."> 
    // (Вопрос: вы упоминали что "classes" = "R", "M" и т.п. в атрибуте?)
    // Допустим, что атрибут называется 'classes' или 'class' — здесь придётся проверить по вашим файлам
    const itemNode = xmlDoc.querySelector('item');
    if (!itemNode) return null;

    const skinName = itemNode.getAttribute('name') || 'unknown_skin';
    const classesAttr = itemNode.getAttribute('classes') || itemNode.getAttribute('class') || '';
    
    return {
      name: skinName,
      classes: classesAttr,
    };
  } catch (err) {
    console.error('Ошибка загрузки внешности', err);
    return null;
  }
}

// ============================================================================
//  4) Функция, загружающая все XML-файлы, которые вы перечислите
//     (упрощённо: вручную список, либо сделайте отдельный fetch по списку)
// ============================================================================
async function loadAllConfigs() {
  // Здесь можно вручную задать массив имён файлов или
  // как-то динамически их получать. Для примера — захардкоженный список:
  const weaponFiles = [
    // Пример: 'ar01.xml', 'ar02.xml', 'pt35.xml', ...
    'ar01.xml',
    'ar02.xml',
    'pt35.xml',
    // добавьте другие...
  ];

  const skinFiles = [
    // Пример: 'soldier_fbs_somalia2308.xml', 'soldier_fbs_brazil01.xml', ...
    'soldier_fbs_somalia2308.xml',
    'soldier_fbs_brazil01.xml',
    // добавьте другие...
  ];

  // Загружаем оружие
  const weaponPromises = weaponFiles.map(fn => loadWeaponXML(fn));
  const weaponResults = await Promise.all(weaponPromises);
  weaponConfigs = weaponResults.filter(Boolean); // уберём null

  // Загружаем внешности
  const skinPromises = skinFiles.map(fn => loadSkinXML(fn));
  const skinResults = await Promise.all(skinPromises);
  skinConfigs = skinResults.filter(Boolean);
}

// ============================================================================
//  5) Утилита: берём массив, возвращаем случайный элемент
// ============================================================================
function getRandomElement(arr) {
  if (!arr || arr.length === 0) return null;
  const idx = Math.floor(Math.random() * arr.length);
  return arr[idx];
}

// ============================================================================
//  6) Генерация пресета (Lua-таблица)
// ============================================================================
function generatePresetForClass(chosenClass) {
  // 1) Отфильтруем оружие по нужным префиксам
  const neededPrefixes = classToPrefixes[chosenClass]; 
  // Пример: ['ar', 'pt', 'kn'] для R

  // Для каждого префикса выберем случайное оружие, если есть
  const chosenWeapons = [];

  neededPrefixes.forEach(prefix => {
    // Собираем все оружия с нужным prefix
    const possibleWeapons = weaponConfigs.filter(w => w.prefix === prefix);
    // Случайно берём одно
    const randomWep = getRandomElement(possibleWeapons);
    if (randomWep) {
      chosenWeapons.push(randomWep);
    }
  });

  // 2) Сформируем список ammo (учитывая, что для ножа патрон не нужен)
  const ammoEntries = [];
  chosenWeapons.forEach(w => {
    if (w.prefix !== 'kn') {
      // Для всех кроме ножа
      ammoEntries.push({
        name: w.ammoType,
        amount: 999
      });
    }
  });

  // 3) Собираем модули. (attachTo = имя оружия)
  //    В шаблон — все supportы, что мы вытащили из XML
  const attachments = [];
  chosenWeapons.forEach(w => {
    w.modules.forEach(m => {
      attachments.push({
        name: m,
        attachTo: w.name
      });
    });
  });

  // 4) Выбираем скин для этого класса
  //    (пропускаем те, у которых classes=="REMSH" или где не совпадает класс)
  const possibleSkins = skinConfigs.filter(skin => {
    // skin.classes может быть "R", "M", "E", "S" или "REMSH".
    // Нужно взять те, что == chosenClass, и исключить REMSH
    return (skin.classes === chosenClass) && (skin.classes !== 'REMSH');
  });
  const chosenSkin = getRandomElement(possibleSkins);
  const skinName = chosenSkin ? chosenSkin.name : 'soldier_fbs_somalia2308';

  // 5) Формируем финальную структуру
  // Здесь можно уже собирать готовый Lua-текст.
  // Либо сперва сформировать объект, потом строкой склеить.
  // Для простоты — сразу склеим строку.

  let lua = 'local inventory = {\n';
  lua += '\tarmor = {\n';
  lua += '\t\t{name = "shared_jacket_02"},\n';
  lua += '\t\t{name = "shared_pants_02"},\n';
  lua += '\t\t{name = "sniper_helmet_frontlines01"},\n';
  lua += '\t\t{name = "sniper_vest_frontlines01"},\n';
  lua += '\t\t{name = "sniper_hands_frontlines01"}, -- Перчатки\n';
  lua += '\t\t{name = "sniper_shoes_frontlines01"}, -- Ботинки\n';
  lua += `\t\t{name = "${skinName}"}, -- Скин\n`;
  lua += '\t},\n\n';
  
  lua += '\titems = {\n';
  chosenWeapons.forEach(w => {
    lua += `\t\t{name = "${w.name}", skin = ""},\n`;
  });
  lua += '\t},\n\n';

  lua += '\tattachments = {\n';
  attachments.forEach(att => {
    lua += `\t\t{name = "${att.name}", attachTo = "${att.attachTo}"},\n`;
  });
  lua += '\t},\n\n';

  lua += '\tammo = {\n';
  ammoEntries.forEach(am => {
    lua += `\t\t{name = "${am.name}", amount = ${am.amount}},\n`;
  });
  lua += '\t}\n';
  lua += '}\n\nreturn inventory\n';

  return lua;
}

// ============================================================================
//  7) Кнопки «Скопировать» и «Скачать»
// ============================================================================
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    alert('Скопировано в буфер обмена!');
  }, () => {
    alert('Не удалось скопировать :(');
  });
}

function downloadPreset(text) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = 'warface_preset.lua';
  link.click();

  URL.revokeObjectURL(url);
}

// ============================================================================
//  8) Логика нажатий
// ============================================================================
generateBtn.addEventListener('click', () => {
  const chosenClass = classSelect.value; // "R", "M", "E", "S"
  const presetLua = generatePresetForClass(chosenClass);
  presetOutput.value = presetLua;
});

copyBtn.addEventListener('click', () => {
  copyToClipboard(presetOutput.value);
});

downloadBtn.addEventListener('click', () => {
  downloadPreset(presetOutput.value);
});

// ============================================================================
//  9) При загрузке страницы - подгружаем все XML, а потом включаем кнопки
// ============================================================================
window.addEventListener('DOMContentLoaded', async () => {
  // Сначала блокируем кнопку "Сгенерировать", пока не загрузили
  generateBtn.disabled = true;
  try {
    await loadAllConfigs();
    console.log('Оружие:', weaponConfigs);
    console.log('Скины:', skinConfigs);
  } catch (e) {
    console.error(e);
    alert('Ошибка при загрузке конфигов');
  }
  // Разблокируем
  generateBtn.disabled = false;
});
