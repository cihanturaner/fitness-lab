# 12 Haftalık İleri Seviye Doğal Hipertrofi + Kuvvet Programı

- Kaynak dosya: `locked_workout_program.json`
- Kaynak SHA-256: `81a7d4bca38bb4a581d146abfc4c6b83b239e281ea4896f37addcd6a76d7b24e`
- Kaynak sürümü: 1.0.0 (FINAL_PATCHED_LOCKED, DECISION_GRADE_PASS_WITH_CAVEAT)
- fitness-lab kilitli program adaptörü tarafından deterministik olarak üretilmiştir; kaynak dosya bu paketin yanında değiştirilmeden korunur.

## Haftalık Program

- Pazartesi: Upper A (23 çalışma seti, 85–105 dk)
- Salı: Lower A (18 çalışma seti, 75–90 dk)
- Çarşamba: dinlenme
- Perşembe: Upper B (21 çalışma seti, 80–95 dk)
- Cuma: Lower B (19 çalışma seti, 75–90 dk)
- Cumartesi: dinlenme
- Pazar: dinlenme

## Uygulama Kuralları

```json
{
  "Tam, kontrollü, ağrısız ROM": true,
  "Rahat olan en uzun kas boyu": true,
  "Eksantrik süre (saniye)": "1-3",
  "Konsantrik": "güçlü ama kontrollü",
  "Varsayılan olarak uzamış pozisyonda kısmi tekrarlar": false,
  "Bileşik egzersizlerde tükeniş": "genellikle kaçınılır",
  "İzolasyon egzersizlerinde tükeniş": "seçici",
  "Yama P7′": {
    "Tükenişe izin verildiğinde sıfır RIR geçerli uygulamadır": true,
    "İlerleme kuralı": "Reçete edilen son set RIR değeri 1 ise, seti 0 RIR'a götürmek o seans için yük artırma kriterini KARŞILAMAZ."
  }
}
```

## İlerleme Kuralları

```json
{
  "Tür": "sonlu çift ilerleme",
  "Kural": "TÜM çalışma setleri reçete edilen RIR'da veya daha fazla rezervle tekrar aralığının üst sınırına ulaştığında, yükü uygulanabilir en küçük artış kadar artır.",
  "Yük artışından sonra": "Performans tekrar aralığının alt ucuna yakın bir düzeye dönmelidir.",
  "Reçete edilenden daha zor yapmak hak kazandırmaz": true,
  "Örnek": {
    "Hedef RIR": 2,
    "Gerçekleşen RIR": 0,
    "Yük artışına hak kazanır": false
  },
  "Mikro yükleme kuralı kilitli": false
}
```

## Plato / İlerleme Durması

```json
{
  "Tek kötü antrenman": "GÜRÜLTÜ",
  "Plato tanımı": "anlamlı tekrar/yük ilerlemesi olmadan yaklaşık 3 ardışık standart seans",
  "Kontrol sırası": [
    "teknik ve ROM",
    "RIR doğruluğu",
    "uyku ve stres",
    "enerji alımı ve toparlanma",
    "ağrı",
    "sistemik yorgunluk"
  ],
  "Egzersiz düzeyinde yanıt": {
    "Adım 1": "hedef RIR'da yükü tekrar aralığının alt yarısına doğru azalt",
    "Adım 2": "2-3 seans boyunca yeniden inşa et",
    "Tekrarlayan ilerleme durması": "gerekçeliyse egzersizi değiştir"
  },
  "Kas düzeyinde yanıt": {
    "Tetikleyici": "teknik/toparlanma iyiyken aynı kas için 2 veya daha fazla egzersizde ilerleme durursa",
    "Eylem": "haftada 1 doğrudan set ekle",
    "Yerleşim": "tercihen daha düşük hacimli seansa",
    "Değerlendirme süresi (hafta, yaklaşık)": 3
  },
  "Otomatik hacim artırımı": false
}
```

## Kalibrasyon

```json
{
  "Kapsam": "yalnızca alışılmamış egzersiz, kurulum veya teknik",
  "İlk seanslar": "1-2",
  "Ayarlama": "yaklaşık +1 RIR daha temkinli",
  "Zorunlu üç haftalık kalibrasyon": false
}
```

## 1–11. Haftalar

```json
{
  "Aynı temel program": true,
  "Otomatik RIR ilerlemesi": false,
  "Otomatik tükeniş artırımı": false,
  "Otomatik set artırımı": false,
  "Takvime bağlı planlı hafifletme haftası": false
}
```

## Hafifletme Haftası (P1)

```json
{
  "Tetikleyici": {
    "Asgari anlamlı işaret sayısı": 2,
    "Süreklilik": "yaklaşık 2 seans veya 5-7 gün",
    "İşaretler": [
      "standart performansta gerileme",
      "belirgin biçimde kötüleşmiş veya dinlendirmeyen uyku/toparlanma",
      "süregelen olağan dışı kas ağrısı veya eklem/tendon tahrişi",
      "antrenmana hazır oluşta belirgin bozulma"
    ],
    "Yeni işaret politikası": "Yeni bir işaret belgelenmiş bir istisnayı gerekçelendirebilir, ancak önceden taahhüt edilmiş iki işaretten biri olarak geriye dönük sayılmaz."
  },
  "Önce kontrol et": [
    "yetersiz uyku",
    "yetersiz enerji alımı",
    "ağrı veya akut hastalık",
    "büyük dış stres"
  ],
  "Birincil etken bulunursa kural": "önce birincil etkeni düzelt; hafifletme haftası uyku veya enerji açığını düzeltmez",
  "Uygulama": {
    "Süre (gün)": 7,
    "Aynı 4 seans": true,
    "Aynı egzersizler": true,
    "Set eşlemesi": {
      "4 set →": "2 set",
      "3 set →": "2 set",
      "2 set →": "1 set"
    },
    "Önceki haftalık set sayısı": 81,
    "Hafifletme haftası set sayısı": 48,
    "Hacim azalması (%, yaklaşık)": 41,
    "Tekrar hedefi": "normal tekrar aralıklarının alt yarısı",
    "RIR": 4,
    "Tükeniş": "YOK",
    "Yük kuralı": "önceki yükü yalnızca azaltılmış tekrarlar hâlâ >=4 RIR'a izin veriyorsa koru; aksi hâlde yükü azalt"
  }
}
```

## 12. Hafta (P2)

```json
{
  "Normal hipertrofi haftası": true,
  "Performans öncesi yük azaltma": false,
  "Gerçek maksimum": false,
  "Ek test setleri": false,
  "Kıyaslama kuralı": "Kilitli belirteçlerin ilk normal çalışma setini 1. hafta başlangıç değeriyle karşılaştır.",
  "Kalibrasyon istisnası": "Belirteç 1. hafta boyunca +1 RIR kalibrasyonu altındaysa, başlangıç değeri = kalibrasyonsuz ilk standart seans.",
  "Başlangıç seansı belirlendiğinde kaydedilir": true,
  "Belirteçler": [
    {
      "Gün": "Pazartesi",
      "Egzersiz": "Smith Flat Bench Press"
    },
    {
      "Gün": "Salı",
      "Egzersiz": "Smith High-Bar Squat"
    },
    {
      "Gün": "Perşembe",
      "Egzersiz": "Neutral-Grip Lat Pulldown"
    }
  ],
  "İsteğe bağlı e1RM": {
    "Formül": "load * (1 + (reps + RIR) / 30)",
    "Kullanım": "yalnızca aynı egzersiz/makinedeki eğilim",
    "Kullanılmaz": [
      "makineler arası karşılaştırma",
      "egzersizler arası karşılaştırma",
      "fizyolojik gerçeklik"
    ]
  }
}
```

## Isınma

```json
{
  "İlk ağır egzersiz için rampa setleri": [
    2,
    4
  ],
  "Sonradan gelen ilk yeni ağır hareket paterni için rampa setleri": [
    1,
    3
  ],
  "Sonraki makine veya izolasyon egzersizleri için rampa setleri": [
    0,
    1
  ],
  "Tükeniş": false,
  "Çalışma seti sayılır": false
}
```

## Haftalık Hacim

```json
{
  "Kesirli sayım notu": "0.5 kesirli sayım bir planlama sezgiselidir, biyolojik bir sabit değildir.",
  "Kaslar": {
    "Göğüs": {
      "Doğrudan": 10,
      "Kesirli (yaklaşık)": 10
    },
    "Latissimus (lat)": {
      "Doğrudan": 6,
      "Kesirli (yaklaşık)": 9
    },
    "Üst sırt": {
      "Doğrudan": 6,
      "Kesirli (yaklaşık)": 9
    },
    "Ön omuz": {
      "Doğrudan": 2,
      "Kesirli (yaklaşık)": 7
    },
    "Yan omuz": {
      "Doğrudan": 8,
      "Kesirli (yaklaşık)": 8
    },
    "Arka omuz": {
      "Doğrudan": 4,
      "Kesirli (yaklaşık)": 7
    },
    "Biceps": {
      "Doğrudan": 4,
      "Kesirli (yaklaşık)": 10
    },
    "Triceps": {
      "Doğrudan": 4,
      "Kesirli (yaklaşık)": 10
    },
    "Quadriceps": {
      "Doğrudan": 11,
      "Kesirli (yaklaşık)": 11
    },
    "Arka uyluk": {
      "Doğrudan": 9,
      "Kesirli (yaklaşık)": 9
    },
    "Kalça (glute)": {
      "Doğrudan": 6,
      "Kesirli (yaklaşık)": 10
    },
    "Gastroknemius": {
      "Doğrudan": 8,
      "Kesirli (yaklaşık)": 8
    },
    "Soleus": {
      "Doğrudan": 8,
      "Kesirli (yaklaşık)": 8
    },
    "Karın/Gövde": {
      "Doğrudan": 6,
      "Kesirli (yaklaşık)": 6
    },
    "Üst trapez": {
      "Doğrudan": 0,
      "Kesirli (yaklaşık)": 3
    },
    "Ön kol": {
      "Doğrudan": 0,
      "Kesirli (yaklaşık)": null
    }
  }
}
```

## Egzersiz Değişim Matrisi

```json
{
  "Smith Flat Bench Press": [
    "Barbell Bench Press",
    "Stable Chest Press"
  ],
  "Smith High-Bar Squat": [
    "Hack Squat",
    "Pendulum Squat",
    "Barbell High-Bar Squat"
  ],
  "Neutral-Grip Lat Pulldown": [
    "Fixed Pulldown",
    "Assisted Pull-Up",
    "Weighted Pull-Up"
  ],
  "Chest-Supported Row": [
    "Supported Machine Row",
    "Supported Cable Row"
  ],
  "Incline Converging Machine Press": [
    "Incline Smith Press",
    "Incline Machine Press",
    "Incline Dumbbell Press 15-35°"
  ],
  "Stable Machine Shoulder Press": [
    "Stable Smith Shoulder Press",
    "Dumbbell Shoulder Press"
  ],
  "Cable/Machine Lateral Raise": [
    "Cable Lateral Raise",
    "Machine Lateral Raise",
    "Dumbbell Lateral Raise"
  ],
  "Reverse Pec Deck": [
    "Cable Rear-Delt Fly"
  ],
  "Overhead Cable Triceps Extension": [
    "Another Stable Overhead Triceps Extension"
  ],
  "Preacher Curl": [
    "Cable Curl",
    "Preacher Curl Variant",
    "Bayesian Cable Curl"
  ],
  "Romanian Deadlift": [
    "Smith Romanian Deadlift",
    "Dumbbell Romanian Deadlift"
  ],
  "45° Leg Press": [
    "Hack Squat",
    "Pendulum Squat",
    "Belt Squat"
  ],
  "Seated Leg Curl": [
    "Another Seated/Hip-Flexed Leg Curl",
    "Lying Leg Curl (mevcut değilse veya tolere edilemiyorsa)"
  ],
  "Smith/Machine Hip Thrust": [
    "Glute Drive",
    "Smith Glute Bridge"
  ],
  "Leg Extension": [
    "Another Leg Extension Machine"
  ],
  "Standing Calf Raise": [
    "Smith Straight-Knee Calf Raise",
    "Leg-Press Straight-Knee Calf Raise"
  ],
  "Cable Crunch": [
    "Machine Abdominal Crunch"
  ],
  "Mekanik eşdeğersizlik notu": "45° Back Extension, Hip Thrust ile mekanik olarak aynı DEĞİLDİR."
}
```
