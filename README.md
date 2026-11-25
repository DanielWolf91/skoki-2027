# SKOKI 2027

Przeglądarkowa gra w skoki narciarskie z treningiem, konkursami, Pucharem Świata i Turniejem Czterech Skoczni.

[Zagraj w SKOKI 2027](https://danielwolf91.github.io/skoki-2027/)

## Uruchomienie i rozwój

Sklonuj repozytorium, zainstaluj Node.js 24 lub nowszy i uruchom polecenia w głównym katalogu projektu.

```sh
npm run setup
npm run build
npm test
```

Otwórz `work/podmuch/Podmuch-built.html` w przeglądarce, aby sprawdzić zbudowaną wersję gry. Do wydania na GitHub Pages skopiuj ten plik jako `index.html` w głównym katalogu repozytorium, a następnie zapisz zmiany na gałęzi `main`.

## Pliki projektu

- `work/podmuch/dist/index.html` zawiera interfejs, sterowanie, fizykę i reguły zawodów.
- `work/podmuch/render3d.mjs`, `conditions3d.mjs` i `broadcast3d.mjs` odpowiadają za grafikę, pogodę i oprawę transmisji.
- `work/podmuch/athlete.glb` to model 3D skoczka. Skrypt `build-athlete.py` pozwala go wygenerować ponownie za pomocą Pythona i NumPy.
- `work/skoki-site` zawiera opcjonalny serwer zapisu i migrację bazy D1. Własne wdrożenie serwera wymaga bazy D1 i zaufanej warstwy uwierzytelniania ustawiającej nagłówek tożsamości. Wersja na GitHub Pages zapisuje dane w przeglądarce.
