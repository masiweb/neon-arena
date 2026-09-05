# Neon Arena Android

این پروژه یک پوسته اندروید سبک و سخت‌افزارشتاب‌داده‌شده است. فایل‌های HTML، CSS و JavaScript هنگام ساخت داخل APK قرار می‌گیرند و برنامه فقط برای API و WebSocket به مبدأ HTTPS انتخاب‌شده هنگام build متصل می‌شود.

- حداقل اندروید: 7.0 (API 24)
- جهت اجرا: افقی
- حالت نمایش: Immersive Fullscreen
- نسخه برنامه: 2.2.0
- نسخه پروتکل سرور: 7

ساخت آزمایشی:

```bash
chmod +x build-apk.sh
GAME_SERVER_ORIGIN=https://game.chanelchat.ir ./build-apk.sh
```

اگر `GAME_SERVER_ORIGIN` مشخص نشود، مقدار پیش‌فرض `https://game.chanelchat.ir` است. مبدأ باید HTTPS باشد و نباید مسیر اضافی داشته باشد.

خروجی:

```text
app/build/outputs/apk/debug/app-debug.apk
```
