const COURSE_DATA = {
  days: [
    {
      id: 1,
      title: "День 1",
      topics: [
        { title: "Приветствие, знакомство, регламент", url: "https://youtu.be/mElDPLvyq2k" },
        { title: "Александр Высоцкий — биография", url: "https://youtu.be/IEisBKPgzck" },
        { title: "О бизнес-бустере — программа 6 дней", url: "https://youtu.be/SLWV0-8YyPE" },
        { title: "Три роли: владелец, директор, специалист", url: "https://youtu.be/TS1ShxFT8ic" },
        { title: "Функции владельца бизнеса", url: "https://youtu.be/AP78Y6CJ66A" },
        { title: "Пять стадий развития бизнеса", url: "https://youtu.be/zxqBDzs__qg" },
        { title: "Проблемы ручного управления и почти системы", url: "https://youtu.be/KBrNhLpGOfA" },
        { title: "Примеры Nintendo, Kodak, Apple, адвайзер-борд", url: "https://youtu.be/-fnKYgaVgVU" },
        { title: "Партнерство, ошибки совладельцев", url: "https://youtu.be/FQ9TWTm7a8k" },
        { title: "Оргструктура, задание, QnA", url: "https://youtu.be/ukzQhD77DAM" },
        { title: "Практическое задание — знакомство", url: "https://youtu.be/zH6dlzet0xc" },
      ]
    },
    {
      id: 2,
      title: "День 2",
      topics: [
        { title: "Выполнение задания 2.1–2.2", url: "https://youtu.be/fTBChgSUcZo" },
        { title: "Орг. структура из 7 департаментов", url: "https://youtu.be/Cv8Jg6bOsqM" },
        { title: "Оргструктура из 21 отдела", url: "https://youtu.be/jhL3j2XK2G8" },
        { title: "Оргструктура", url: "https://youtu.be/GsdZmvYFiBo" },
        { title: "Ответы на вопросы из чата", url: "https://youtu.be/zvxRN5AZHuY" },
        { title: "Упомянутые функции", url: "https://youtu.be/11n57-yrhnk" },
        { title: "Эффективное взаимодействие", url: "https://youtu.be/8J45wsNyJ8k" },
        { title: "Недельное планирование — основные принципы", url: "https://youtu.be/uukxwgOPH_Q" },
        { title: "После найма", url: "https://youtu.be/x6Okvb45nZw" },
        { title: "Уровни планирования", url: "https://youtu.be/NOHAexbJpLU" },
        { title: "Быстрый найм и введение в должность", url: "https://youtu.be/D7KC94e8M7k" },
      ]
    },
    {
      id: 3,
      title: "День 3",
      topics: [
        { title: "Что такое метрика — Пример с типографией", url: "https://youtu.be/rS7vAZTUR5g" },
        { title: "Сложные метрики — ПР и имидж компании", url: "https://youtu.be/xGQ1TmsZEhY" },
        { title: "Польза метрик — История с Леной", url: "https://youtu.be/T76XVu_R07E" },
        { title: "Метрики и выход из операционки", url: "https://youtu.be/mReosWzlCQA" },
        { title: "Координация — Определение и примеры", url: "https://youtu.be/sIFXAlP0Cr0" },
        { title: "Управленческая и функциональная координация", url: "https://youtu.be/-SXcwIIU4K0" },
        { title: "Примеры координации в бизнесе", url: "https://youtu.be/gcsIf17fwAw" },
        { title: "Три принципа успешной координации", url: "https://youtu.be/EJHibhNIWpQ" },
        { title: "Задание 3.1 — График валового дохода", url: "https://youtu.be/GfVHWp4BFQ8" },
        { title: "Задание 3.2 — Список координаций", url: "https://youtu.be/5DLitdTg7TY" },
        { title: "QnA — Систематизация и метрики", url: "https://youtu.be/enR2bdT68iA" },
        { title: "QnA — Мотивация и зарплата", url: "https://youtu.be/Gdj5jx4laxg" },
        { title: "QnA — Метрики для разных должностей", url: "https://youtu.be/RZrKiOdT_O0" },
        { title: "QnA — Сезонность и координации", url: "https://youtu.be/eGuMgCzm8hQ" },
        { title: "QnA — Диагностика и завершение", url: "https://youtu.be/lpfSPQtzel0" },
      ]
    },
    {
      id: 4,
      title: "День 4",
      topics: [
        { title: "Введение и подготовка к практическому занятию", url: "https://youtu.be/PXgu_Eonc4I" },
        { title: "Разбор заданий по предыдущему дню", url: "https://youtu.be/R53UrQHWRBc" },
        { title: "Анализ успешных действий и ошибок — Александр", url: "https://youtu.be/Jt4BuUOs-40" },
        { title: "Сезонность и ошибки в ценообразовании", url: "https://youtu.be/2lXoeiaxZgA" },
        { title: "Неэффективные продажи — Олег", url: "https://youtu.be/EIxMlLzJ7Mk" },
        { title: "Реальные кейсы и осознания участников", url: "https://youtu.be/etKeybVwFgc" },
        { title: "Начало вебинара по маркетингу и продажам", url: "https://youtu.be/Ry_1pNc4874" },
        { title: "Как систематизировать маркетинг", url: "https://youtu.be/gRZDJ54Js6E" },
        { title: "Основы маркетинга — управление производством", url: "https://youtu.be/ZA5KNmBM8mQ" },
        { title: "Главный маркетинговый вопрос и ошибки", url: "https://youtu.be/1EVywkKt8Qk" },
        { title: "Примеры провалов в маркетинговой стратегии", url: "https://youtu.be/B65osuITLmQ" },
        { title: "Заземление — контакт с рынком", url: "https://youtu.be/Tw1GSgfFnW4" },
        { title: "Анализ конкурентов — быстрый способ", url: "https://youtu.be/fPCRuEMiI3U" },
        { title: "Описание целевой аудитории", url: "https://youtu.be/MOvUL625Bas" },
        { title: "Боли целевой аудитории — сбор информации", url: "https://youtu.be/hDDlH-WU3D8" },
      ]
    },
    {
      id: 5,
      title: "День 5",
      topics: [
        { title: "Открытие дня и знакомство с Алексеем", url: "https://youtu.be/RLYqj_LYhCc" },
        { title: "Разбор кейсов — маркетинг и продажи", url: "https://youtu.be/CDKLDbnQ0Bs" },
        { title: "Осознания участников и итоги маркетинга", url: "https://youtu.be/1QrV833SfB8" },
        { title: "Удача и цели владельца", url: "https://youtu.be/c6pD9UJkWWM" },
        { title: "Система управления финансами — Вводная", url: "https://youtu.be/2jSp_294FzE" },
        { title: "Почему владелец застревает в операционке финансов", url: "https://youtu.be/Rkva7zjYQA4" },
        { title: "Разделение счетов — основа системы", url: "https://youtu.be/7zfHU7sdIYQ" },
        { title: "Финансовая модель распределения средств", url: "https://youtu.be/CPi8D_VEVUg" },
        { title: "Еженедельное планирование и Рекомендательный совет", url: "https://youtu.be/RU-aNilvz7Q" },
        { title: "Полная прозрачность финансов для руководителей", url: "https://youtu.be/hgEwnd3a-Yo" },
        { title: "Обязанности владельца — Финансовый инструмент", url: "https://youtu.be/pzmAu5rcnyA" },
        { title: "Практическое задание и бонусы", url: "https://youtu.be/brriLW3hRy4" },
        { title: "Ответы на вопросы", url: "https://youtu.be/f106xA-OgRA" },
      ]
    },
    {
      id: 6,
      title: "День 6",
      topics: [
        { title: "Открытие дня — recap", url: "https://youtu.be/Yy5AzGeuGKg" },
        { title: "Разбор заданий по финансам", url: "https://youtu.be/s7L158K4X2o" },
        { title: "Как внедрять изменения", url: "https://youtu.be/LMHCN8sBJFY" },
        { title: "Идеология, оргсхема и метрики", url: "https://youtu.be/V3jNNrhqMLM" },
        { title: "Делегирование, найм и планирование", url: "https://youtu.be/bpM-K3gRx1E" },
        { title: "Координация и управление финансами", url: "https://youtu.be/1AsxRYn90kI" },
        { title: "Управление продажами и маркетинг", url: "https://youtu.be/aqLf1_wgMcA" },
        { title: "Ошибки внедрения", url: "https://youtu.be/7VdnEFWrlBU" },
        { title: "Платформа Бизнес Бустер", url: "https://youtu.be/X20s_iMFdUs" },
        { title: "Структура программы — 5 уровней", url: "https://youtu.be/Ddn4yUzW-EY" },
        { title: "Варианты участия и предложение", url: "https://youtu.be/8Hrh9IW7xxY" },
        { title: "Вопросы и ответы — завершение", url: "https://youtu.be/u1tVXl7eaM0" },
      ]
    },
  ],

  bonuses: [
    {
      id: "b1",
      icon: "📝",
      title: "Бонус 1 — Копирайтинг",
      desc: "Копирайтинг и маркетинг-кит",
      topics: [
        { title: "Копирайтинг и маркетинг-кит", url: "https://youtu.be/AsejKTiYFYM" }
      ]
    },
    {
      id: "b2",
      icon: "🎯",
      title: "Бонус 2 — Стратегия",
      desc: "Стратегическое планирование",
      topics: [
        { title: "Стратегическое планирование", url: "https://youtu.be/keG9VwXk0yE" }
      ]
    },
    {
      id: "b3",
      icon: "🌟",
      title: "Бонус 3 — Личный бренд",
      desc: "Личный бренд и сообщества",
      topics: [
        { title: "Личный бренд и сообщества", url: "https://youtu.be/rOscryWi75I" }
      ]
    },
  ],

  tools: [
    {
      id: "t2026",
      icon: "🛠",
      title: "Инструменты 2026",
      desc: "30 практических занятий",
      // Плейлист — открываем напрямую в YouTube
      playlistUrl: "https://www.youtube.com/playlist?list=PLuHIwD8UzKjyDvo1I992H57blcW6U2vR1",
      topics: []
    },
    {
      id: "t2025",
      icon: "📋",
      title: "Инструменты 2025",
      desc: "88 практических занятий",
      playlistUrl: "https://www.youtube.com/playlist?list=PLuHIwD8UzKjyDvo1I992H57blcW6U2vR1",
      topics: []
    },
  ]
};
