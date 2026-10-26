# GoVibe Mix desktop app

The same tools as the website in a desktop window, built with Electron. It works offline because the site files are bundled inside the app. Audio and video stay on your computer, exactly as on the website.

## Run it

```
cd desktop
npm install
npm start
```

`npm start` first copies the website files (one folder up) into `desktop/site`, then opens the app.

## Make an installer

```
npm run dist:win     # Windows installer and portable exe (build on Windows)
npm run dist:mac     # macOS dmg (build on a Mac)
npm run dist:linux   # AppImage and deb (build on Linux)
```

Installers are written to `desktop/dist`. Build each one on its own operating system. Unsigned apps show a warning the first time they are opened: Windows SmartScreen asks you to confirm, and macOS needs right click then Open. To remove the warning you need a code signing certificate (Windows) or an Apple Developer account (macOS), which are paid.

## How it is set up

- The site is served from a private `govibe://app/` address, which the browser engine treats as a secure origin, so AudioWorklet, workers, IndexedDB and the microphone work.
- The same Content Security Policy as the website is applied, plus `worker-src` for blob workers.
- The microphone (audio only) is allowed for the app's own pages. Camera, location and every other permission are refused.
- Links to other websites open in your normal browser.
- No Node.js access from the pages (context isolation and sandbox are on).
- The service worker is not used in the app. The files are already local.
- Your projects and library live in the app's own storage, separate from the browser version. Use the Studio and library backup ZIPs to move them between the two.

## Status

The shell is tested by loading the bundled site in the app's engine in this repository's test run when Electron is installed. Installers for Windows and macOS have not been built or tested here.
